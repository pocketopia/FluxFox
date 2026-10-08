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
  parameters?: Record<string, unknown>;
  function?: VapiToolCallFunction;
}

interface VapiWebhookMessage {
  type?: string;
  toolCallList?: VapiToolCallItem[];
  assistant?: { id?: string; [key: string]: unknown };
  call?: {
    id?: string;
    assistantId?: string;
    assistant?: { id?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface VapiWebhookPayload {
  message?: VapiWebhookMessage;
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

/** Validates that every required booking field is present as a non-empty string. */
function extractBookAppointmentArgs(raw: Record<string, unknown> | null): BookAppointmentArgs | null {
  if (!raw) return null;

  const fields = ['customer_name', 'customer_phone', 'customer_email', 'project_type', 'date_time'] as const;
  const result: Record<string, string> = {};

  for (const field of fields) {
    const value = raw[field];
    if (typeof value !== 'string' || !value.trim()) return null;
    result[field] = value.trim();
  }

  return result as unknown as BookAppointmentArgs;
}

/** Extracts the function name from either payload shape Vapi may send. */
function extractFunctionName(item: VapiToolCallItem): string | undefined {
  return item.function?.name ?? item.name;
}

/** Extracts the raw (unparsed) function arguments from either payload shape Vapi may send. */
function extractRawArguments(item: VapiToolCallItem): string | Record<string, unknown> | undefined {
  return item.function?.arguments ?? item.parameters;
}

/** Locates the `vapi_assistant_id` regardless of where Vapi places it on the message. */
function extractAssistantId(message: VapiWebhookMessage): string | null {
  return message.assistant?.id ?? message.call?.assistantId ?? message.call?.assistant?.id ?? null;
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
 * This is deliberately fire-and-forget and never throws: telemetry must
 * never disrupt the voice response Vapi is waiting on. Any Supabase
 * client-init failure or insert error is caught and swallowed (logged to
 * the server console for operator visibility only) — no mock payload is
 * ever substituted, and a logging failure never surfaces to the caller.
 */
async function logCallTelemetry(
  assistantId: string,
  customerPhone: string | null,
  rawPayload: VapiWebhookPayload
): Promise<void> {
  try {
    const supabase = getSupabaseServiceRoleClient();
    const { error } = await supabase.from('call_logs').insert({
      assistant_id: assistantId,
      customer_phone: customerPhone,
      raw_payload: rawPayload,
    });

    if (error) {
      console.error('[FluxFox Telemetry] Failed to insert call_logs row:', error.message);
    }
  } catch (err) {
    console.error(
      '[FluxFox Telemetry] Failed to log call telemetry:',
      err instanceof Error ? err.message : 'unknown error'
    );
  }
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

  if (!message || message.type !== 'tool-calls') {
    // Any other Vapi server-message type (status-update, transcript, etc.)
    // reaching this route is informational only — acknowledge per Vapi's spec.
    return NextResponse.json({}, { status: 200 });
  }

  const toolCallList = Array.isArray(message.toolCallList) ? message.toolCallList : [];
  const bookAppointmentCall = toolCallList.find(
    (item) => extractFunctionName(item) === BOOK_APPOINTMENT_FUNCTION_NAME
  );

  if (!bookAppointmentCall || !bookAppointmentCall.id) {
    return NextResponse.json(
      { error: `No "${BOOK_APPOINTMENT_FUNCTION_NAME}" tool call was found in the payload.` },
      { status: 400 }
    );
  }

  const toolCallId = bookAppointmentCall.id;

  const assistantId = extractAssistantId(message);
  if (!assistantId) {
    return NextResponse.json({ error: 'No assistant id was found on the webhook payload.' }, { status: 400 });
  }

  const args = extractBookAppointmentArgs(parseFunctionArguments(extractRawArguments(bookAppointmentCall)));

  if (!args) {
    const results: ToolCallResult[] = [
      {
        toolCallId,
        result:
          'I was missing some required booking details (customer name, phone, email, project type, or date/time). The appointment was not booked.',
      },
    ];
    return NextResponse.json({ results }, { status: 200 });
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

  if (!timeRange) {
    const results: ToolCallResult[] = [
      {
        toolCallId,
        result: 'System error: Date format invalid. Ask the user to clarify the date and time.',
      },
    ];
    await logCallTelemetry(assistantId, args.customer_phone, payload);
    return NextResponse.json({ results }, { status: 200 });
  }

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to initialize the Supabase Service Role client.' },
      { status: 500 }
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('google_refresh_token')
    .eq('vapi_assistant_id', assistantId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { error: `Failed to query public.users for assistant ${assistantId}: ${profileError.message}` },
      { status: 500 }
    );
  }

  if (!profile) {
    return NextResponse.json(
      { error: `No FluxFox user was found with vapi_assistant_id "${assistantId}".` },
      { status: 404 }
    );
  }

  const refreshToken = profile.google_refresh_token as string | null;

  let calendar;
  try {
    calendar = await getGoogleCalendarClientFromRefreshToken(refreshToken);
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to initialize the Google Calendar client.' }, { status: 500 });
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

    await logCallTelemetry(assistantId, args.customer_phone, payload);
    return NextResponse.json({ results }, { status: 200 });
  } catch (err) {
    const results: ToolCallResult[] = [
      {
        toolCallId,
        result: `I ran into an error while booking the appointment on the calendar: ${
          err instanceof Error ? err.message : 'unknown Google Calendar error'
        }. Please try again or contact the business directly.`,
      },
    ];
    return NextResponse.json({ results }, { status: 200 });
  }
}

