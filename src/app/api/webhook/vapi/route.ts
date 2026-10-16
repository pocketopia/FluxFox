import { NextResponse } from 'next/server';
import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import {
  DEFAULT_BUSINESS_TIMEZONE,
  findOpenSlots,
  formatLocalTime,
  getGoogleCalendarClientFromRefreshToken,
  GoogleAuthError,
  isSlotBooked,
  isValidTimeZone,
  toOffsetIso,
} from '@/lib/google';
import { getTimezoneFromAreaCode } from '@/utils/timezone';

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
  /** True when a call_logs row for this same call already existed, so no duplicate was inserted. */
  telemetryDuplicateSkipped?: boolean;
  bookingError?: string;
}

interface TelemetryOutcome {
  logged: boolean;
  error?: string;
  duplicateSkipped?: boolean;
}

/** A second `call_logs` row for the same assistant within this window is treated as the same call. */
const DUPLICATE_CALL_WINDOW_MS = 2 * 60 * 1000;

/**
 * Normalizes a phone number to E.164 (`+1XXXXXXXXXX` for US/Canada).
 * Accepts `+`-prefixed numbers as-is (digits only), 10-digit national
 * numbers, and 11-digit numbers starting with 1. Returns null when the
 * input is empty or can't be confidently normalized.
 */
function normalizeToE164(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (trimmed.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;

  return null;
}

/** A tool call flattened from any of Vapi's payload shapes. */
interface NormalizedToolCall {
  id?: string;
  name?: string;
  args: Record<string, unknown> | null;
}

type AppointmentType = 'in_person' | 'callback';

interface BookAppointmentArgs {
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  project_type: string;
  date_time: string;
  /** Defaults to "callback" if the model omits/garbles it (older assistants have no such field). */
  appointment_type: AppointmentType;
  /** Street address for in-person appointments; falls back to the business's saved address. */
  appointment_address: string | null;
}

/** The 5 original required fields; `appointment_type` / `appointment_address` are validated separately. */
type RequiredBookingField = 'customer_name' | 'customer_phone' | 'customer_email' | 'project_type' | 'date_time';

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
const BOOKING_FIELD_ALIASES: Record<RequiredBookingField, string> = {
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
  const fields = Object.keys(BOOKING_FIELD_ALIASES) as RequiredBookingField[];

  if (!raw) return { args: null, missing: fields };

  const result: Partial<Record<RequiredBookingField, string>> = {};
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

  const rawType = (
    coerceArgString(raw.appointment_type) ??
    coerceArgString(raw.appointmentType) ??
    ''
  )
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const appointmentType: AppointmentType = rawType === 'in_person' || rawType === 'inperson' ? 'in_person' : 'callback';

  return {
    args: {
      ...(result as Record<RequiredBookingField, string>),
      appointment_type: appointmentType,
      appointment_address:
        coerceArgString(raw.appointment_address) ?? coerceArgString(raw.appointmentAddress),
    },
    missing: [],
  };
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

    // Duplicate guard: one phone call can fire a `tool-calls` event AND an
    // `end-of-call-report`. Skip the insert if this call is already logged,
    // matched by Vapi call id; when the payload has no call id, fall back to
    // "same assistant + same caller within the last 2 minutes".
    const callId = rawPayload.message?.call?.id ?? rawPayload.call?.id ?? null;

    let duplicateQuery = supabase.from('call_logs').select('id').eq('assistant_id', assistantId).limit(1);

    if (callId) {
      duplicateQuery = duplicateQuery.eq('raw_payload->message->call->>id', callId);
    } else if (customerPhone) {
      duplicateQuery = duplicateQuery
        .eq('customer_phone', customerPhone)
        .gte('created_at', new Date(Date.now() - DUPLICATE_CALL_WINDOW_MS).toISOString());
    }

    if (callId || customerPhone) {
      const { data: existing, error: lookupError } = await duplicateQuery;

      // A failed lookup must not block logging — fall through and insert.
      if (lookupError) {
        console.error('[FluxFox Telemetry] Duplicate lookup failed, inserting anyway:', lookupError.message);
      } else if (existing && existing.length > 0) {
        return { logged: true, duplicateSkipped: true };
      }
    }

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

/**
 * `end-of-call-report` handler: preserves the full transcript / summary /
 * recording alongside the booking telemetry. If a `call_logs` row already
 * exists for this call (matched by Vapi call id, else same assistant + caller
 * within `DUPLICATE_CALL_WINDOW_MS`), its `raw_payload` is UPDATED — the
 * original booking `tool-calls` payload is kept and the report is merged in
 * under `end_of_call_report` (plus top-level `transcript` / `summary` /
 * `recordingUrl` / `endedReason` for easy reads). With no match, a new row is
 * inserted as before. Never throws.
 */
async function logEndOfCallReport(
  assistantId: string,
  customerPhone: string | null,
  payload: VapiWebhookPayload
): Promise<TelemetryOutcome> {
  try {
    const supabase = getSupabaseServiceRoleClient();
    const message = payload.message as VapiWebhookMessage | undefined;
    const callId = message?.call?.id ?? payload.call?.id ?? null;

    let lookup = supabase
      .from('call_logs')
      .select('id, raw_payload')
      .eq('assistant_id', assistantId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (callId) {
      lookup = lookup.eq('raw_payload->message->call->>id', callId);
    } else if (customerPhone) {
      lookup = lookup
        .eq('customer_phone', customerPhone)
        .gte('created_at', new Date(Date.now() - DUPLICATE_CALL_WINDOW_MS).toISOString());
    } else {
      return await insertCallLog(assistantId, customerPhone, payload);
    }

    const { data: existing, error: lookupError } = await lookup;
    if (lookupError) {
      console.error('[FluxFox Telemetry] end-of-call lookup failed, inserting instead:', lookupError.message);
      return await insertCallLog(assistantId, customerPhone, payload);
    }

    const row = existing?.[0];
    if (!row) return await insertCallLog(assistantId, customerPhone, payload);

    const report = (message ?? {}) as Record<string, unknown>;
    const artifact = (report.artifact ?? {}) as Record<string, unknown>;
    const analysis = (report.analysis ?? {}) as Record<string, unknown>;

    const merged = {
      ...((row.raw_payload as Record<string, unknown> | null) ?? {}),
      end_of_call_report: payload,
      transcript: report.transcript ?? artifact.transcript ?? null,
      summary: report.summary ?? analysis.summary ?? null,
      recordingUrl: report.recordingUrl ?? artifact.recordingUrl ?? null,
      endedReason: report.endedReason ?? null,
    };

    const { error: updateError } = await supabase.from('call_logs').update({ raw_payload: merged }).eq('id', row.id);
    if (updateError) {
      console.error('[FluxFox Telemetry] Failed to update call_logs row:', updateError.message);
      return { logged: false, error: `call_logs update failed: ${updateError.message}` };
    }

    return { logged: true, duplicateSkipped: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown error';
    console.error('[FluxFox Telemetry] Failed to log end-of-call report:', reason);
    return { logged: false, error: reason };
  }
}

async function insertCallLog(
  assistantId: string,
  customerPhone: string | null,
  payload: VapiWebhookPayload
): Promise<TelemetryOutcome> {
  const supabase = getSupabaseServiceRoleClient();
  const { error } = await supabase
    .from('call_logs')
    .insert({ assistant_id: assistantId, customer_phone: customerPhone, raw_payload: payload });
  if (error) {
    console.error('[FluxFox Telemetry] Failed to insert call_logs row:', error.message);
    return { logged: false, error: `call_logs insert failed: ${error.message}` };
  }
  return { logged: true };
}

/**
 * Local timezone for the business: derived from the area code of its Twilio
 * line (same mapping `/api/phone/provision` uses to stamp the assistant), and
 * validated. Falls back to `America/Los_Angeles` — never UTC.
 */
function resolveBusinessTimeZone(twilioPhoneNumber: string | null): string {
  const digits = (twilioPhoneNumber ?? '').replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (national.length === 10) {
    const mapped = getTimezoneFromAreaCode(national.slice(0, 3));
    if (isValidTimeZone(mapped)) return mapped;
  }
  return DEFAULT_BUSINESS_TIMEZONE;
}

/** Builds the `diagnostics` response field from a telemetry outcome and optional booking error. */
function buildDiagnostics(telemetry: TelemetryOutcome, bookingError?: string): WebhookDiagnostics {
  return {
    telemetryLogged: telemetry.logged,
    ...(telemetry.duplicateSkipped ? { telemetryDuplicateSkipped: true } : {}),
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
      ? await logEndOfCallReport(
          assistantId,
          normalizeToE164(message.call?.customer?.number ?? payload.call?.customer?.number),
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
  // Prefer the real caller ID Vapi reports; fall back to the number the
  // caller dictated. Always stored as E.164 so formats stay consistent.
  const telemetry = await logCallTelemetry(
    assistantId,
    normalizeToE164(message.call?.customer?.number ?? payload.call?.customer?.number) ??
      normalizeToE164(args?.customer_phone),
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
    .select('google_refresh_token, business_address, twilio_phone_number')
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

  // Local timezone for business hours + spoken times: the timezone of the
  // business line's area code (never UTC), else America/Los_Angeles.
  const timeZone = resolveBusinessTimeZone(profile.twilio_phone_number as string | null);

  const businessAddress = ((profile.business_address as string | null) ?? '').trim();
  const isInPerson = args.appointment_type === 'in_person';
  // In-person: the address the caller confirmed, else the business's saved address.
  const appointmentAddress = isInPerson ? args.appointment_address?.trim() || businessAddress || '' : '';

  if (isInPerson && !appointmentAddress) {
    return failBooking(
      'For an in-person appointment I need the street address where it will take place. Ask the caller for that address, confirm it, then book again.',
      'appointment_type is in_person but no appointment_address was provided and the business has no saved address.'
    );
  }

  const appointmentTypeLabel = isInPerson ? 'In-Person' : 'Phone Callback';
  const startMs = new Date(timeRange.start).getTime();

  try {
    // REAL-TIME CONFLICT CHECK: never double-book. If the requested
    // [start, start + 60 min) window overlaps any non-cancelled event, offer
    // 3 open business-hour alternatives instead of inserting.
    if (await isSlotBooked(calendar, startMs)) {
      const alternatives = await findOpenSlots(calendar, startMs, timeZone, 3);
      const requestedSpoken = formatLocalTime(startMs, timeZone);

      const spoken =
        alternatives.length > 0
          ? `That time (${requestedSpoken}) is already booked, so I did not book it. These times are open: ` +
            `${alternatives.map((ms, i) => `${i + 1}) ${formatLocalTime(ms, timeZone)}`).join('; ')}. ` +
            `Politely tell the caller that time is unavailable, offer these alternatives, ask which works best, then call book_appointment again with the time they choose (as an ISO-8601 timestamp with the ${timeZone} UTC offset).`
          : `That time (${requestedSpoken}) is already booked and no open business-hour slots were found in the next several days. Politely apologize, tell the caller the business will follow up, and do not book.`;

      console.info('[FluxFox Booking] Slot conflict', { requested: timeRange.start, alternatives: alternatives.length });
      const results: ToolCallResult[] = [{ toolCallId, result: spoken }];
      return NextResponse.json({ results, diagnostics: buildDiagnostics(telemetry) }, { status: 200 });
    }

    const { data: event } = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: `${appointmentTypeLabel}: ${args.project_type} — ${args.customer_name} (${args.customer_phone})`,
        ...(isInPerson ? { location: appointmentAddress } : {}),
        description:
          `Booked via FluxFox AI receptionist.\n` +
          `Appointment type: ${appointmentTypeLabel}\n` +
          `Customer: ${args.customer_name}\n` +
          `Phone: ${args.customer_phone}\n` +
          `Email: ${args.customer_email}\n` +
          `Project type: ${args.project_type}\n` +
          (isInPerson
            ? `Appointment address: ${appointmentAddress}`
            : `Callback: call ${args.customer_name} at ${args.customer_phone}` +
              (businessAddress ? `\nBusiness address: ${businessAddress}` : '')),
        start: { dateTime: timeRange.start, timeZone },
        end: { dateTime: timeRange.end, timeZone },
        attendees: [{ email: args.customer_email, displayName: args.customer_name }],
      },
    });

    const spokenTime = formatLocalTime(startMs, timeZone);

    const results: ToolCallResult[] = [
      {
        toolCallId,
        result:
          `You're all set, ${args.customer_name}! Your ${appointmentTypeLabel} ${args.project_type} appointment is confirmed for ` +
          `${spokenTime}.` +
          (isInPerson ? ` It will take place at ${appointmentAddress}.` : ` We will call you at ${args.customer_phone}.`) +
          ` A calendar invite has been sent to ${args.customer_email}.` +
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

