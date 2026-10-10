'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

/** Google's official four-color "G" mark (matches `OnboardingWizard.tsx`'s glyph). */
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47c-.28 1.5-1.13 2.78-2.4 3.63v3.02h3.88c2.27-2.09 3.57-5.17 3.57-8.84z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3.02c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.11C3.24 21.3 7.29 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28V6.61H1.26A11.97 11.97 0 0 0 0 12c0 1.93.46 3.76 1.26 5.39z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.35.6 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.29 0 3.24 2.7 1.26 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Real Supabase email/password sign-in (`@supabase/ssr`'s browser client,
   * same as `OnboardingWizard.tsx`'s Google flow). Session state is
   * persisted via cookies, so the resulting session is immediately visible
   * to `/dashboard`'s server-side `supabase.auth.getUser()` guard. Requires
   * a user already provisioned in Supabase Auth (e.g. via the Google OAuth
   * flow below, or invited from the Supabase dashboard) — there is no
   * self-serve email/password sign-up screen in this app.
   */
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setIsLoading(false);
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in. Please try again.');
      setIsLoading(false);
    }
  };

  /**
   * Real Google OAuth sign-in, identical pattern to
   * `OnboardingWizard.tsx`'s "Continue with Google" button: requests the
   * Calendar Events scope with an offline refresh token so
   * `/auth/callback` can persist it to `public.users.google_refresh_token`.
   * Lands returning users straight on `/dashboard`, where `FluxFoxConsole`
   * picks up onboarding (deploy assistant / claim number) if not already
   * complete.
   */
  async function handleGoogleSignIn() {
    setError(null);
    setIsGoogleLoading(true);

    try {
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
          scopes: 'https://www.googleapis.com/auth/calendar.events',
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (oauthError) {
        setError(oauthError.message);
        setIsGoogleLoading(false);
      }
      // On success the browser navigates to Google immediately; no further
      // client code runs until the user lands back on /auth/callback.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Google sign-in.');
      setIsGoogleLoading(false);
    }
  }

  return (
    <main
      id="fluxfox-login-root"
      className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden font-sans selection:bg-amber-500/30 selection:text-amber-200"
    >
      {/* Cyber Grid Background */}
      <div
        className="absolute inset-0 bg-[linear-gradient(to_right,#27272a15_1px,transparent_1px),linear-gradient(to_bottom,#27272a15_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none"
        aria-hidden="true"
      />

      {/* Cyber Glow Accents */}
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none"
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md z-10">
        {/* Terminal Header Badge */}
        <div className="flex items-center justify-between px-3 py-1.5 mb-4 text-xs bg-zinc-900/90 border border-zinc-800 rounded-md text-zinc-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-zinc-300 font-semibold tracking-wide">Secure Sign In</span>
          </div>
        </div>

        {/* Main Authentication Card */}
        <div
          id="fluxfox-login-card"
          className="bg-zinc-900/95 border border-zinc-800/90 rounded-xl p-8 shadow-2xl backdrop-blur-xl relative"
        >
          {/* Neon Top Edge Accent */}
          <div className="absolute top-0 left-8 right-8 h-[2px] bg-gradient-to-r from-transparent via-amber-500 to-transparent opacity-80" />

          {/* Logo & Brand Identity */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/25 mb-4">
              <span className="text-zinc-950 font-black text-xl">F</span>
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-zinc-500">Sign in to your FluxFox account</p>
          </div>

          {/* Error Banner */}
          {error && (
            <div
              id="login-error-banner"
              className="mb-6 p-3.5 bg-red-950/50 border border-red-800/80 rounded-lg text-xs text-red-200 flex items-start gap-2.5 font-mono"
            >
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-300">Sign-In Failed</p>
                <p className="mt-0.5 text-zinc-300">{error}</p>
              </div>
            </div>
          )}

          {/* Email / Password Form */}
          <form id="login-form" onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold text-zinc-400 mb-1.5 tracking-wide"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@business.com"
                  className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg py-3 pl-10 pr-4 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold text-zinc-400 mb-1.5 tracking-wide"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg py-3 pl-10 pr-4 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
                />
              </div>
            </div>

            {/* Primary CTA */}
            <button
              id="login-submit-button"
              type="submit"
              disabled={isLoading || isGoogleLoading}
              className="w-full relative group overflow-hidden bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-semibold py-3.5 px-6 rounded-lg transition-all duration-200 shadow-lg shadow-amber-500/25 active:scale-[0.99] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              <span className="font-bold tracking-tight text-sm sm:text-base">
                {isLoading ? 'Signing in...' : 'Sign In'}
              </span>
              {!isLoading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-zinc-800" />
            <span className="text-[11px] text-zinc-500 tracking-wide">OR</span>
            <div className="flex-1 h-px bg-zinc-800" />
          </div>

          {/* Google OAuth — the same real Supabase flow used by the onboarding
              wizard's "Continue with Google" button (OnboardingWizard.tsx),
              so a returning user can sign in and land straight on /dashboard. */}
          <button
            id="login-google-button"
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isLoading || isGoogleLoading}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-zinc-100 text-zinc-900 font-semibold py-3.5 px-6 rounded-lg transition-all duration-200 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {isGoogleLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <GoogleGlyph />
            )}
            <span className="text-sm sm:text-base">
              {isGoogleLoading ? 'Redirecting to Google...' : 'Continue with Google'}
            </span>
          </button>

          <p className="mt-5 text-center text-[11px] text-zinc-500">
            Bank-level encryption &bull; Your data is always private
          </p>
        </div>

        {/* Trust Footer */}
        <div className="mt-8 text-center text-xs text-zinc-500">
          <span>Trusted by small businesses to never miss a lead</span>
        </div>
      </div>
    </main>
  );
}
