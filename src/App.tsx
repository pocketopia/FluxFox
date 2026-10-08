import { Flame, ArrowRight, ShieldCheck, Calendar, PhoneCall, CreditCard } from 'lucide-react';

/**
 * Day 8: this file previously rendered a fully simulated onboarding demo
 * with a fabricated operator session, a fake OAuth login timer, and a fake
 * calendar-dispatch timer — none of which touched any real API. All of
 * that mock state and every `setTimeout`-driven fake network call have
 * been removed per the Day 8 sanitization pass.
 *
 * The real, live product lives in the Next.js App Router tree:
 *   /login      -> src/app/login/page.tsx      (real Supabase Google OAuth)
 *   /dashboard  -> src/app/dashboard/page.tsx   (real DB-backed onboarding)
 *
 * This component is the static Vite SPA entry point and now does nothing
 * more than link to the real login flow — zero mock data, zero simulated
 * network calls.
 */
export default function App() {
  return (
    <div
      id="fluxfox-root"
      className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center px-4 py-12 font-sans selection:bg-amber-500/30 selection:text-amber-200 relative overflow-hidden"
    >
      <div
        className="absolute inset-0 bg-[linear-gradient(to_right,#27272a15_1px,transparent_1px),linear-gradient(to_bottom,#27272a15_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"
        aria-hidden="true"
      />

      <div className="relative z-10 max-w-md w-full text-center">
        <div className="mx-auto w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center p-0.5 shadow-lg shadow-amber-500/20 ring-1 ring-amber-400/40 mb-6">
          <div className="w-full h-full bg-zinc-950 rounded-[10px] flex items-center justify-center">
            <Flame className="w-7 h-7 text-amber-400" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">FluxFox</h1>
        <p className="text-zinc-400 text-sm mb-8">
          The AI phone receptionist that books appointments straight to your
          Google Calendar &mdash; 24/7, no missed leads.
        </p>

        <div className="space-y-3 mb-8 text-left">
          <div className="flex items-center gap-3 text-sm text-zinc-300 bg-zinc-900/70 border border-zinc-800 rounded-lg px-4 py-3">
            <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Secure Google sign-in with real Supabase sessions</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-zinc-300 bg-zinc-900/70 border border-zinc-800 rounded-lg px-4 py-3">
            <PhoneCall className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>A live Vapi AI receptionist bound to a real Twilio number</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-zinc-300 bg-zinc-900/70 border border-zinc-800 rounded-lg px-4 py-3">
            <Calendar className="w-4 h-4 text-orange-400 shrink-0" />
            <span>Appointments booked directly onto your Google Calendar</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-zinc-300 bg-zinc-900/70 border border-zinc-800 rounded-lg px-4 py-3">
            <CreditCard className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>$99/mo subscription, billed securely through Stripe</span>
          </div>
        </div>

        <a
          id="app-login-link"
          href="/login"
          className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-semibold py-3.5 px-6 rounded-lg transition-all duration-200 shadow-lg shadow-amber-500/25 active:scale-[0.99] cursor-pointer"
        >
          Sign in to your dashboard
          <ArrowRight className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}
