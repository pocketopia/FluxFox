'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail, AlertCircle, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    // TODO: replace with real authentication once the backend is wired up.
    if (email === 'twiztedimages@live.com' && password === '@Deadman88') {
      router.push('/onboarding');
    } else {
      setError('Invalid credentials');
    }

    setIsLoading(false);
  };

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
              disabled={isLoading}
              className="w-full relative group overflow-hidden bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-semibold py-3.5 px-6 rounded-lg transition-all duration-200 shadow-lg shadow-amber-500/25 active:scale-[0.99] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              <span className="font-bold tracking-tight text-sm sm:text-base">
                {isLoading ? 'Signing in...' : 'Sign In'}
              </span>
              {!isLoading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

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
