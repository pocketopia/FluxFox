import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /auth/callback
 *
 * Completes the Supabase PKCE OAuth flow kicked off by the onboarding
 * wizard's "Continue with Google" button
 * (`src/components/onboarding/OnboardingWizard.tsx`). Google redirects the
 * browser here with a one-time `?code=...`, which is exchanged for a real
 * Supabase session via `exchangeCodeForSession`. The resulting session's
 * `provider_refresh_token` (Google's offline refresh token, requested with
 * `access_type=offline&prompt=consent` and the Calendar Events scope) is
 * persisted to `public.users.google_refresh_token` so
 * `src/lib/google.ts#getGoogleCalendarClient` can mint a live Calendar API
 * client for this user later — exactly the column the Day 1 schema
 * (`supabase.sql`) and the Vapi booking webhook already expect.
 *
 * No mock session, no fallback redirect on failure: any missing code or
 * exchange error sends the user back to onboarding Step 2 with
 * `?calendar=error` so the wizard can surface a real error message.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') ?? '/onboarding';

  if (!code) {
    return NextResponse.redirect(`${requestUrl.origin}${next}?calendar=error`);
  }

  const supabase = await createClient();

  const {
    data: { session },
    error: exchangeError,
  } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !session?.user) {
    return NextResponse.redirect(`${requestUrl.origin}${next}?calendar=error`);
  }

  const providerRefreshToken = session.provider_refresh_token;

  if (providerRefreshToken) {
    const { error: updateError } = await supabase
      .from('users')
      .update({ google_refresh_token: providerRefreshToken })
      .eq('id', session.user.id);

    if (updateError) {
      return NextResponse.redirect(`${requestUrl.origin}${next}?calendar=error`);
    }
  }

  return NextResponse.redirect(`${requestUrl.origin}${next}?calendar=connected`);
}
