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
