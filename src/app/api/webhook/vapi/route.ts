import { NextResponse } from 'next/server';
import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { getGoogleCalendarClientFromRefreshToken, GoogleAuthError } from '@/lib/google';

export const dynamic = 'force-dynamic';

/**
 * DAY 6 SCHEMA REQUIREMENT — public.users must already have both:
 *   vapi_assistant_id text     (see /api/assistant/deploy)
 *   google_refresh_token text  (see /app/auth/callback)
 * This route reads both columns via the Supabase Service Role key, which
 * bypasses Row Level Security since the request originates from Vapi's
 * servers and carries no end-user session/cookies.
 */

const BOOK_APPOINTMENT_FUNCTION_NAME = 'book_appointment';
/** Every booked appointment defaults to a 1-hour block on the calendar. */
const DEFAULT_EVENT_DURATION_MINUTES = 60;

// ---------------------------------------------------------------------------
// Vapi payload shapes (duck-typed; Vapi's real runtime payload is a superset
// of its published SDK types, so we read defensively rather than trusting a
// single exact shape).
// ---------------------------------------------------------------------------

interface VapiToolCallFunction {
  name?: string;
  /** Vapi sends this as a JSON-serialized string per its official SDK types. */
  arguments?: string | Record<string, unknown>;
}

interface VapiToolCallItem {
  id?: string;
  type?: string;
  /** Some Vapi payload variants place the function name/args flat on the item. */
  name?: string;
  arguments?: string | Record<string, unknown>;
  parameters?: Record<string, unknown>;
  function?: VapiToolCallFunction;
  /** `toolWithToolCallList` entries nest the actual call here (the outer `function` is the tool definition). */
  toolCall?: VapiToolCallItem;
}

interface VapiCallInfo {
  id?: string;
  assistantId?: string;
  assistant?: { id?: string };
  customer?: { number?: string };
  [key: string]: unknown;
}

interface VapiWebhookMessage {
  type?: string;
  toolCalls?: VapiToolCallItem[];
  toolCallList?: VapiToolCallItem[];
  toolWithToolCallList?: VapiToolCallItem[];
  assistant?: { id?: string; [key: string]: unknown };
  call?: VapiCallInfo;
  [key: string]: unknown;
}

interface VapiWebhookPayload {
  message?: VapiWebhookMessage;
  /** Some Vapi payload variants also expose these at the body's top level. */
  assistant?: { id?: string; [key: string]: unknown };
  call?: VapiCallInfo;
}

/**
 * Surfaced on every `tool-calls` / `end-of-call-report` JSON response so
 * operators can see exactly why telemetry or booking failed (Vapi ignores
 * unknown top-level keys, so this never affects the voice flow).
 */
interface WebhookDiagnostics {
  telemetryLogged: boolean;
  telemetryError?: string;
  bookingError?: string;
}

interface TelemetryOutcome {
  logged: boolean;
  error?: string;
}

/** A tool call flattened from any of Vapi's payload shapes. */
interface NormalizedToolCall {
  id?: string;
  name?: string;
  args: Record<string, unknown> | null;
}

interface BookAppointmentArgs {
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  project_type: string;
  date_time: string;
}

interface ToolCallResult {
  toolCallId: string;
  result: string;
}

/** Parses a tool call's `arguments`/`parameters`, whether string-encoded or already an object. */
function parseFunctionArguments(
  raw: string | Record<string, unknown> | undefined
): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Converts a string/number argument value into a trimmed non-empty string, else null. */
function coerceArgString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** Snake_case booking field -> its camelCase alias the model occasionally emits. */
const BOOKING_FIELD_ALIASES: Record<keyof BookAppointmentArgs, string> = {
  customer_name: 'customerName',
  customer_phone: 'customerPhone',
  customer_email: 'customerEmail',
  project_type: 'projectType',
  date_time: 'dateTime',
};

/**
 * Validates that every required booking field is present as a non-empty
 * string (accepting a camelCase alias for each). Returns either the clean
 * args or the exact list of missing fields for diagnostics.
 */
function extractBookAppointmentArgs(
  raw: Record<string, unknown> | null
): { args: BookAppointmentArgs; missing: [] } | { args: null; missing: string[] } {
  const fields = Object.keys(BOOKING_FIELD_ALIASES) as (keyof BookAppointmentArgs)[];

  if (!raw) return { args: null, missing: fields };

  const result: Partial<BookAppointmentArgs> = {};
  const missing: string[] = [];

  for (const field of fields) {
    const value = coerceArgString(raw[field]) ?? coerceArgString(raw[BOOKING_FIELD_ALIASES[field]]);
    if (value) {
      result[field] = value;
    } else {
      missing.push(field);
    }
  }

  if (missing.length > 0) return { args: null, missing };
  return { args: result as BookAppointmentArgs, missing: [] };
}

/**
 * Flattens every tool call Vapi may send — across `message.toolCalls`,
 * `message.toolCallList`, and `message.toolWithToolCallList` — into one
 * list, normalizing the id / function name / arguments wherever they live:
 *   - `tc.function.{name,arguments}`            (arguments string OR object)
 *   - `tc.toolCall.function.{name,arguments}`   (toolWithToolCallList)
 *   - `tc.name` / `tc.arguments` / `tc.parameters` (flat variants)
 */
function collectToolCalls(message: VapiWebhookMessage): NormalizedToolCall[] {
  const lists = [message.toolCalls, message.toolCallList, message.toolWithToolCallList];
  const normalized: NormalizedToolCall[] = [];

  for (const list of lists) {
    if (!Array.isArray(list)) continue;

    for (const item of list) {
      if (!item || typeof item !== 'object') continue;

      // For `toolWithToolCallList`, the outer `function` is the tool
      // *definition* (no arguments); the real call lives under `toolCall`.
      const inner = item.toolCall;

      const rawArguments =
        inner?.function?.arguments ??
        item.function?.arguments ??
        inner?.arguments ??
        inner?.parameters ??
        item.arguments ??
        item.parameters;

      normalized.push({
        id: inner?.id ?? item.id,
        name: inner?.function?.name ?? item.function?.name ?? inner?.name ?? item.name,
        args: parseFunctionArguments(rawArguments),
      });
    }
  }

  return normalized;
}

/**
 * Locates the `vapi_assistant_id` wherever Vapi places it: the message
 * (`assistant.id`, `call.assistantId`, `call.assistant.id`) or the body's
 * top level (`assistant.id`, `call.assistantId`).
 */
function extractAssistantId(message: VapiWebhookMessage | undefined, body: VapiWebhookPayload): string | null {
  return (
    message?.assistant?.id ||
    message?.call?.assistantId ||
    message?.call?.assistant?.id ||
    body.assistant?.id ||
    body.call?.assistantId ||
    body.call?.assistant?.id ||
    null
  );
}

/**
 * Instantiates a Supabase client authenticated with the Service Role key,
 * bypassing RLS. Vapi calls this route server-to-server with no user
 * cookies/session, so the standard `@/utils/supabase/server` cookie-based
 * client cannot be used here.
 */
function getSupabaseServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Server misconfiguration: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.');
  }

  return createServiceRoleClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * DAY 10 TELEMETRY: best-effort insert of a `public.call_logs` row
 * capturing this webhook invocation — the live assistant id, the caller's
 * phone number (when available from the real `book_appointment` args),
 * and the entire raw incoming Vapi payload verbatim.
 *
 * This never throws: telemetry must never disrupt the voice response
 * Vapi is waiting on. Any Supabase client-init failure or insert error is
 * caught, logged to the server console, and RETURNED as
 * `{ logged: false, error }` so the route can surface it in the response's
 * `diagnostics` field — no mock payload is ever substituted.
 */
async function logCallTelemetry(
  assistantId: string,
  customerPhone: string | null,
  rawPayload: VapiWebhookPayload
): Promise<TelemetryOutcome> {
  try {
    const supabase = getSupabaseServiceRoleClient();
    const { error } = await supabase.from('call_logs').insert({
      assistant_id: assistantId,
      customer_phone: customerPhone,
      raw_payload: rawPayload,
    });

    if (error) {
      console.error('[FluxFox Telemetry] Failed to insert call_logs row:', error.message);
      return { logged: false, error: `call_logs insert failed: ${error.message}` };
    }

    return { logged: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown error';
    console.error('[FluxFox Telemetry] Failed to log call telemetry:', reason);
    return { logged: false, error: reason };
  }
}

/** Builds the `diagnostics` response field from a telemetry outcome and optional booking error. */
function buildDiagnostics(telemetry: TelemetryOutcome, bookingError?: string): WebhookDiagnostics {
  return {
    telemetryLogged: telemetry.logged,
    ...(telemetry.error ? { telemetryError: telemetry.error } : {}),
    ...(bookingError ? { bookingError } : {}),
  };
}

/**
 * Strict ISO-8601 timestamp with a mandatory timezone designator (either a
 * literal "Z" or a numeric UTC offset like "+05:30"/"-08:00"). Rejects bare
 * date-only strings, natural language, and any timestamp missing a
 * timezone designator — the model is instructed to always include one, so
 * an omission is treated as a hallucinated/malformed value rather than
 * leniently guessed at.
 */
const STRICT_ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Builds the Google Calendar `event.start`/`event.end` block from a strict
 * ISO-8601 date_time. Returns null (never throws) for anything that fails
 * strict format validation or resolves to an invalid calendar date, so the
 * caller can degrade gracefully into a spoken clarification request
 * instead of a hard failure — the AI assistant can hallucinate malformed
 * dates and this must never crash the webhook.
 */
function buildEventTimeRange(dateTimeIso: string): { start: string; end: string } | null {
  if (!STRICT_ISO_8601_PATTERN.test(dateTimeIso)) return null;

  const startDate = new Date(dateTimeIso);
  if (Number.isNaN(startDate.getTime())) return null;

  const endDate = new Date(startDate.getTime() + DEFAULT_EVENT_DURATION_MINUTES * 60 * 1000);
  return { start: startDate.toISOString(), end: endDate.toISOString() };
}

/**
 * POST /api/webhook/vapi
 *
 * The Master Webhook Router: Vapi's server URL for `tool-calls` events.
 * When the deployed assistant collects all booking details and calls
 * `book_appointment`, this route:
 *   1. Authenticates via the Supabase Service Role key (no user session).
 *   2. Extracts the booking arguments and the assistant id from the payload.
 *   3. Looks up the FluxFox user whose `vapi_assistant_id` matches.
 *   4. Exchanges that user's stored `google_refresh_token` for a live
 *      Google Calendar client and inserts the real event.
 *   5. Responds with the exact `{ results: [...] }` shape Vapi requires so
 *      the assistant can speak a confirmation (or failure) out loud.
 *
 * No mock data, no fallback calendar insertion: every failure mode is a
 * real, surfaced error.
 *
 * DAY 10 TELEMETRY: immediately before returning the final 200 OK to Vapi
 * for both a successful booking and the Day 9 hallucinated-date fallback,
 * a best-effort `public.call_logs` row is inserted via the Service Role
 * client (see `logCallTelemetry`). This never blocks or fails the voice
 * response — any telemetry error is caught and swallowed.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let payload: VapiWebhookPayload;
  try {
    payload = (await request.json()) as VapiWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const message = payload.message;
  const assistantId = extractAssistantId(message, payload);

  // Every finished call (booked or not) is logged so it shows up in the
  // dashboard's Recent Calls table. Vapi only needs a 200 acknowledgement
  // for this message type; `diagnostics` reports whether the insert worked.
  if (message?.type === 'end-of-call-report') {
    const telemetry: TelemetryOutcome = assistantId
      ? await logCallTelemetry(
          assistantId,
          message.call?.customer?.number ?? payload.call?.customer?.number ?? null,
          payload
        )
      : { logged: false, error: 'end-of-call-report had no assistant id; call_logs row skipped.' };

    if (telemetry.error) console.error('[FluxFox Telemetry]', telemetry.error);
    return NextResponse.json({ diagnostics: buildDiagnostics(telemetry) }, { status: 200 });
  }

  if (!message || message.type !== 'tool-calls') {
    // Any other Vapi server-message type (status-update, transcript, etc.)
    // reaching this route is informational only — acknowledge per Vapi's spec.
    return NextResponse.json({}, { status: 200 });
  }

  const bookAppointmentCall = collectToolCalls(message).find((tc) => tc.name === BOOK_APPOINTMENT_FUNCTION_NAME);

  if (!bookAppointmentCall || !bookAppointmentCall.id) {
    const reason = `No "${BOOK_APPOINTMENT_FUNCTION_NAME}" tool call (with an id) was found in message.toolCalls / toolCallList / toolWithToolCallList.`;
    return NextResponse.json(
      {
        error: reason,
        diagnostics: buildDiagnostics({ logged: false, error: 'Skipped: no book_appointment tool call.' }, reason),
      },
      { status: 400 }
    );
  }

  const toolCallId = bookAppointmentCall.id;

  if (!assistantId) {
    const reason =
      'No assistant id was found (checked message.assistant.id, message.call.assistantId, body.assistant.id, body.call.assistantId).';
    return NextResponse.json(
      {
        error: reason,
        diagnostics: buildDiagnostics({ logged: false, error: 'Skipped: no assistant id.' }, reason),
      },
      { status: 400 }
    );
  }

  const { args, missing } = extractBookAppointmentArgs(bookAppointmentCall.args);

  // Telemetry is recorded once per tool-call invocation, before any booking
  // branch, so `diagnostics` always reports it — even when booking fails.
  const telemetry = await logCallTelemetry(
    assistantId,
    args?.customer_phone ?? message.call?.customer?.number ?? payload.call?.customer?.number ?? null,
    payload
  );

  if (!args) {
    const bookingError = `Missing or empty booking arguments: ${missing.join(', ')}.`;
    const results: ToolCallResult[] = [
      {
        toolCallId,
        result:
          'I was missing some required booking details (customer name, phone, email, project type, or date/time). The appointment was not booked.',
      },
    ];
    return NextResponse.json({ results, diagnostics: buildDiagnostics(telemetry, bookingError) }, { status: 200 });
  }

  // DAY 9 EDGE CASE: the model can hallucinate a malformed/ambiguous
  // date_time (wrong format, missing timezone designator, garbage text).
  // This must never surface as a 400/500 — Vapi expects a 200 tool-call
  // result it can speak back to the caller so the conversation can
  // recover gracefully instead of the call silently failing.
  let timeRange: { start: string; end: string } | null;
  try {
    timeRange = buildEventTimeRange(args.date_time);
  } catch {
    timeRange = null;
  }

  /**
   * Every booking failure below is returned as a 200 `results` entry Vapi
   * can speak to the caller, plus the exact technical reason under
   * `diagnostics.bookingError` — nothing is swallowed.
   */
  const failBooking = (spoken: string, bookingError: string): NextResponse => {
    console.error('[FluxFox Booking]', bookingError);
    const results: ToolCallResult[] = [{ toolCallId, result: spoken }];
    return NextResponse.json({ results, diagnostics: buildDiagnostics(telemetry, bookingError) }, { status: 200 });
  };

  const BOOKING_UNAVAILABLE_SPOKEN =
    'I was unable to reach the business calendar to book that appointment. Please try again or contact the business directly.';

  if (!timeRange) {
    return failBooking(
      'System error: Date format invalid. Ask the user to clarify the date and time.',
      `date_time "${args.date_time}" is not a strict ISO-8601 timestamp with a timezone designator (Z or +/-HH:MM).`
    );
  }

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (err) {
    return failBooking(
      BOOKING_UNAVAILABLE_SPOKEN,
      err instanceof Error ? err.message : 'Failed to initialize the Supabase Service Role client.'
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('google_refresh_token')
    .eq('vapi_assistant_id', assistantId)
    .maybeSingle();

  if (profileError) {
    return failBooking(
      BOOKING_UNAVAILABLE_SPOKEN,
      `Failed to query public.users for assistant ${assistantId}: ${profileError.message}`
    );
  }

  if (!profile) {
    return failBooking(
      BOOKING_UNAVAILABLE_SPOKEN,
      `No FluxFox user was found with vapi_assistant_id "${assistantId}". Redeploy/relink the assistant so public.users.vapi_assistant_id matches.`
    );
  }

  const refreshToken = profile.google_refresh_token as string | null;

  let calendar;
  try {
    calendar = await getGoogleCalendarClientFromRefreshToken(refreshToken);
  } catch (err) {
    return failBooking(
      BOOKING_UNAVAILABLE_SPOKEN,
      err instanceof GoogleAuthError
        ? err.message
        : `Failed to initialize the Google Calendar client: ${err instanceof Error ? err.message : 'unknown error'}`
    );
  }

  try {
    const { data: event } = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: `${args.project_type} — ${args.customer_name}`,
        description:
          `Booked via FluxFox AI receptionist.\n` +
          `Customer: ${args.customer_name}\n` +
          `Phone: ${args.customer_phone}\n` +
          `Email: ${args.customer_email}\n` +
          `Project type: ${args.project_type}`,
        start: { dateTime: timeRange.start },
        end: { dateTime: timeRange.end },
        attendees: [{ email: args.customer_email, displayName: args.customer_name }],
      },
    });

    const spokenTime = new Date(args.date_time).toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    const results: ToolCallResult[] = [
      {
        toolCallId,
        result:
          `You're all set, ${args.customer_name}! Your ${args.project_type} appointment is confirmed for ` +
          `${spokenTime}. A calendar invite has been sent to ${args.customer_email}.` +
          (event.htmlLink ? ` (${event.htmlLink})` : ''),
      },
    ];

    return NextResponse.json({ results, diagnostics: buildDiagnostics(telemetry) }, { status: 200 });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown Google Calendar error';
    return failBooking(
      `I ran into an error while booking the appointment on the calendar: ${reason}. Please try again or contact the business directly.`,
      `Google Calendar events.insert failed (e.g. invalid_grant = expired/revoked refresh token, or GOOGLE_CLIENT_ID/SECRET mismatch): ${reason}`
    );
  }
}

