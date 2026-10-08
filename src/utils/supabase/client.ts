import { createBrowserClient } from '@supabase/ssr';

/**
 * Creates a Supabase client for browser/Client Component usage (the
 * counterpart to `src/utils/supabase/server.ts`). Session state is persisted
 * via cookies (not localStorage) so the same session is readable by Server
 * Components, Server Actions, and Route Handlers.
 *
 * Used by the onboarding wizard's one-click "Sign in with Google" button
 * (`src/components/onboarding/OnboardingWizard.tsx`) to kick off the OAuth
 * redirect via `supabase.auth.signInWithOAuth`.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  );
}
