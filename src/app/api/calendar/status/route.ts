import { NextResponse } from 'next/server';
import { getGoogleCalendarClient, GoogleAuthError } from '@/lib/google';

export const dynamic = 'force-dynamic';

interface CalendarStatusResponse {
  connected: true;
  calendarId: string;
  summary: string;
  timeZone: string;
}

interface ApiErrorResponse {
  error: string;
}

/**
 * Narrow, duck-typed check for Gaxios/Google API error shapes without
 * importing the (nested, non-hoisted) `gaxios` package directly.
 */
function extractGoogleApiStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null) {
    const maybeStatus = (err as { code?: unknown; status?: unknown }).code;
    if (typeof maybeStatus === 'number') return maybeStatus;

    const response = (err as { response?: { status?: unknown } }).response;
    if (response && typeof response.status === 'number') return response.status;
  }
  return undefined;
}

/**
 * GET /api/calendar/status
 *
 * Verifies that the current Supabase-authenticated user has a working,
 * authorized connection to Google Calendar by fetching their primary
 * calendar's live metadata. No mock data, no fallback calendar: any
 * failure mode returns a strict JSON error with an appropriate status.
 */
export async function GET(): Promise<NextResponse<CalendarStatusResponse | ApiErrorResponse>> {
  let calendar;

  try {
    calendar = await getGoogleCalendarClient();
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Failed to initialize the Google Calendar client.' },
      { status: 500 }
    );
  }

  try {
    const { data } = await calendar.calendars.get({ calendarId: 'primary' });

    if (!data.id) {
      return NextResponse.json(
        { error: 'Google Calendar returned an empty response for the primary calendar.' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        connected: true,
        calendarId: data.id,
        summary: data.summary ?? '',
        timeZone: data.timeZone ?? '',
      },
      { status: 200 }
    );
  } catch (err) {
    const status = extractGoogleApiStatus(err);

    if (status === 401 || status === 403) {
      return NextResponse.json(
        { error: 'Google rejected the stored credentials. Please reconnect your Google Calendar.' },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to reach the Google Calendar API.' },
      { status: 500 }
    );
  }
}
