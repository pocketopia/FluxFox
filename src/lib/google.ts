import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';
import { createClient } from '@/utils/supabase/server';

/**
 * Thrown when an authenticated Google Calendar client cannot be constructed
 * for the current user (missing session, missing/invalid refresh token, or
 * a Supabase lookup failure). Callers should map this to an HTTP 401.
 */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

/**
 * Strips whitespace/newlines and any surrounding single or double quotes
 * that commonly sneak into pasted Vercel env vars, which otherwise cause
 * Google's `invalid_client` error. Returns '' for null/undefined input.
 */
function sanitizeCredential(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/^["']|["']$/g, '');
}

/**
 * Builds a fully authorized `calendar_v3.Calendar` client from a raw Google
 * OAuth refresh token, bypassing any Supabase session/cookie lookup. This is
 * the primitive used both by the user-session flow below and by
 * server-to-server callers (e.g. the Vapi webhook route) that already have
 * the target user's `google_refresh_token` in hand from a Service Role
 * database query. Performs zero mocking/fallback: a missing token or missing
 * env credentials throws `GoogleAuthError`.
 */
export async function getGoogleCalendarClientFromRefreshToken(
  refreshToken: string | null | undefined
): Promise<calendar_v3.Calendar> {
  const clientId = sanitizeCredential(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = sanitizeCredential(process.env.GOOGLE_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    throw new GoogleAuthError(
      'Server misconfiguration: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set.'
    );
  }

  const cleanRefreshToken = sanitizeCredential(refreshToken);

  if (!cleanRefreshToken) {
    throw new GoogleAuthError(
      'No Google refresh token on file. The user must connect their Google Calendar to continue.'
    );
  }

  const oauth2Client = new google.auth.OAuth2({
    clientId,
    clientSecret,
  });

  oauth2Client.setCredentials({ refresh_token: cleanRefreshToken });

  // Force the refresh-token exchange now so a bad Client ID/secret or a
  // revoked token surfaces here with a precise diagnostic (including the
  // first 8 chars of the Client ID Vercel is actually reading), rather than
  // as an opaque failure later inside `events.insert`.
  try {
    await oauth2Client.getAccessToken();
  } catch (err) {
    throw new GoogleAuthError(
      `Google token refresh failed (client_id starts with "${clientId.slice(0, 8)}", length ${clientId.length}): ${
        err instanceof Error ? err.message : 'unknown error'
      }`
    );
  }

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * Builds a fully authorized `calendar_v3.Calendar` client for the currently
 * signed-in Supabase user by exchanging their stored Google refresh token
 * for a live OAuth2 client. Performs zero mocking/fallback: any failure
 * mode (no session, no token row, missing env credentials) throws
 * `GoogleAuthError` so the caller can return a strict, unambiguous error.
 */
export async function getGoogleCalendarClient(): Promise<calendar_v3.Calendar> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    throw new GoogleAuthError(err instanceof Error ? err.message : 'Failed to initialize the Supabase client.');
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new GoogleAuthError('No authenticated Supabase session was found.');
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('google_refresh_token')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    throw new GoogleAuthError(
      `Failed to load Google credentials for user ${user.id}: ${profileError?.message ?? 'no profile row found'}.`
    );
  }

  return getGoogleCalendarClientFromRefreshToken(profile.google_refresh_token as string | null);
}

// ---------------------------------------------------------------------------
// Phase 3 — real-time conflict detection, open-slot search, local-time helpers
// (pure Intl, no extra dependency)
// ---------------------------------------------------------------------------

/** Timezone used for business hours and spoken times when none can be derived. Never UTC. */
export const DEFAULT_BUSINESS_TIMEZONE = 'America/Los_Angeles';

/** Every appointment occupies one 1-hour block. */
export const APPOINTMENT_SLOT_MINUTES = 60;
const SLOT_MS = APPOINTMENT_SLOT_MINUTES * 60 * 1000;
const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 17;
/**
 * The scan is chronological from the requested day, so the first 3 open slots
 * normally fall within the requested day + next 2 business days. It only
 * reaches further (up to this many extra business days) when those days are
 * too full to yield 3 slots, so the caller always gets options.
 */
const MAX_EXTRA_BUSINESS_DAYS = 7;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

interface CalendarDay {
  y: number;
  m: number;
  d: number;
}

export interface BusyInterval {
  start: number;
  end: number;
}

/** True if `timeZone` is a valid IANA identifier this runtime understands. */
export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function getZonedParts(timeZone: string, utcMs: number): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset (ms) of `timeZone` from UTC at the instant `utcMs` (negative west of Greenwich), DST-aware. */
function tzOffsetMs(timeZone: string, utcMs: number): number {
  const p = getZonedParts(timeZone, utcMs);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

/** Converts a wall-clock time in `timeZone` to a UTC epoch (ms), correcting across DST transitions. */
export function zonedTimeToUtcMs(timeZone: string, y: number, m: number, d: number, hour: number, minute = 0): number {
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const first = guess - tzOffsetMs(timeZone, guess);
  return guess - tzOffsetMs(timeZone, first);
}

/** Formats an instant as a strict ISO-8601 timestamp with the zone's UTC offset, e.g. 2026-03-14T15:00:00-07:00. */
export function toOffsetIso(utcMs: number, timeZone: string): string {
  const p = getZonedParts(timeZone, utcMs);
  const offsetMin = Math.round(tzOffsetMs(timeZone, utcMs) / 60000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Natural spoken local time, e.g. "Friday, March 14 at 3:00 PM PDT". */
export function formatLocalTime(utcMs: number, timeZone: string): string {
  return new Date(utcMs).toLocaleString('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function addDays(day: CalendarDay, n: number): CalendarDay {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function isWeekday(day: CalendarDay): boolean {
  const wd = new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
  return wd !== 0 && wd !== 6;
}


/**
 * Lists every non-cancelled, blocking event on the user's primary calendar
 * that touches `[windowStartMs, windowEndMs)`, as busy intervals (epoch ms).
 * Recurring events are expanded (`singleEvents`); cancelled events and events
 * marked "free" (transparent) are ignored; all-day events block the whole day.
 * Throws on a Calendar API failure — the caller must NOT book blindly then.
 */
export async function getBusyIntervals(
  calendar: calendar_v3.Calendar,
  windowStartMs: number,
  windowEndMs: number
): Promise<BusyInterval[]> {
  const busy: BusyInterval[] = [];
  let pageToken: string | undefined;

  do {
    const { data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date(windowStartMs).toISOString(),
      timeMax: new Date(windowEndMs).toISOString(),
      singleEvents: true,
      showDeleted: false,
      maxResults: 250,
      pageToken,
    });

    for (const event of data.items ?? []) {
      if (event.status === 'cancelled' || event.transparency === 'transparent') continue;

      const startRaw = event.start?.dateTime ?? event.start?.date;
      const endRaw = event.end?.dateTime ?? event.end?.date;
      if (!startRaw || !endRaw) continue;

      const start = new Date(startRaw).getTime();
      const end = new Date(endRaw).getTime();
      if (Number.isNaN(start) || Number.isNaN(end)) continue;

      busy.push({ start, end });
    }

    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);

  return busy;
}

/** True when the 1-hour block starting at `startMs` overlaps any busy interval (half-open `[start, start + 60 min)`). */
export function slotConflicts(busy: BusyInterval[], startMs: number): boolean {
  const endMs = startMs + SLOT_MS;
  return busy.some((b) => startMs < b.end && endMs > b.start);
}

/**
 * Real-time conflict check for a requested appointment. Returns whether the
 * `[start, start + 60 min)` window overlaps an existing event on the
 * primary calendar.
 */
export async function isSlotBooked(calendar: calendar_v3.Calendar, startMs: number): Promise<boolean> {
  const busy = await getBusyIntervals(calendar, startMs, startMs + SLOT_MS);
  return slotConflicts(busy, startMs);
}

/**
 * Finds up to `count` open 1-hour slots during business hours
 * (9:00 AM – 5:00 PM `timeZone`, weekdays) on the requested day and the next
 * 2 business days. If fewer than `count` are open it keeps scanning forward
 * (up to a week) so the caller always gets options. Slots in the past, or
 * equal to the requested time, are never offered. Returns epoch-ms starts.
 */
export async function findOpenSlots(
  calendar: calendar_v3.Calendar,
  requestedStartMs: number,
  timeZone: string,
  count = 3
): Promise<number[]> {
  const requested = getZonedParts(timeZone, requestedStartMs);
  const firstDay: CalendarDay = { y: requested.year, m: requested.month, d: requested.day };

  // One calendar read covering the whole scan window.
  const windowStart = zonedTimeToUtcMs(timeZone, firstDay.y, firstDay.m, firstDay.d, 0);
  const lastDay = addDays(firstDay, 14);
  const windowEnd = zonedTimeToUtcMs(timeZone, lastDay.y, lastDay.m, lastDay.d, 23, 59);
  const busy = await getBusyIntervals(calendar, windowStart, windowEnd);

  const now = Date.now();
  const found: number[] = [];
  let businessDaysAfterFirst = 0;
  let cursor = firstDay;

  for (let i = 0; i < 14 && found.length < count; i += 1, cursor = addDays(cursor, 1)) {
    if (!isWeekday(cursor)) continue;

    const isFirst = cursor.y === firstDay.y && cursor.m === firstDay.m && cursor.d === firstDay.d;
    if (!isFirst) businessDaysAfterFirst += 1;
    if (businessDaysAfterFirst > MAX_EXTRA_BUSINESS_DAYS) break;

    for (let hour = BUSINESS_START_HOUR; hour + APPOINTMENT_SLOT_MINUTES / 60 <= BUSINESS_END_HOUR; hour += 1) {
      const slotStart = zonedTimeToUtcMs(timeZone, cursor.y, cursor.m, cursor.d, hour);
      if (slotStart <= now || slotStart === requestedStartMs) continue;
      if (slotConflicts(busy, slotStart)) continue;

      found.push(slotStart);
      if (found.length >= count) break;
    }
  }

  return found;
}

