'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Flame,
  Building2,
  Hash,
  ChevronDown,
  Loader2,
  CalendarCheck2,
  CircleAlert,
  CheckCircle2,
  ArrowLeft,
  Rocket,
  PartyPopper,
} from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import DemoAudioPlayer from './DemoAudioPlayer';

const TOTAL_STEPS = 3;

/**
 * Same ten trade verticals `src/lib/vapi.ts`'s `INDUSTRY_LABELS` resolves a
 * spoken-word label for. Kept as plain `value`/`label` pairs here (no icons)
 * since Step 1 renders them in a native `<select>` for maximum
 * accessibility/familiarity for non-technical field workers on mobile.
 */
const TRADE_OPTIONS: { value: string; label: string }[] = [
  { value: 'plumber', label: 'Plumbing' },
  { value: 'roofer', label: 'Roofing' },
  { value: 'electrician', label: 'Electrical' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'landscaper', label: 'Landscaping' },
  { value: 'locksmith', label: 'Locksmith' },
  { value: 'painter', label: 'Painting' },
  { value: 'pest_control', label: 'Pest Control' },
  { value: 'general_contractor', label: 'General Contracting' },
  { value: 'handyman', label: 'Handyman' },
];

/**
 * Sandbox fallback US area code used to silently provision a Twilio number
 * when the optional Step 1 area code field is left blank. Keeps the V1
 * "free sandbox" flow fully frictionless (zero required fields beyond
 * business name + trade) while every user still gets a real, working phone
 * number — they can swap it for a local number later from the dashboard.
 */
const DEFAULT_AREA_CODE = '415';

const DRAFT_STORAGE_KEY = 'fluxfox-onboarding-draft-v1';

interface OnboardingDraft {
  businessName: string;
  trade: string;
  areaCode: string;
  calendarConnected: boolean;
}

const EMPTY_DRAFT: OnboardingDraft = {
  businessName: '',
  trade: '',
  areaCode: '',
  calendarConnected: false,
};

/** Reads the persisted wizard draft, surviving the full-page Google OAuth redirect round trip. */
function loadDraft(): OnboardingDraft {
  if (typeof window === 'undefined') return EMPTY_DRAFT;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw) as Partial<OnboardingDraft>;
    return {
      businessName: typeof parsed.businessName === 'string' ? parsed.businessName : '',
      trade: typeof parsed.trade === 'string' ? parsed.trade : '',
      areaCode: typeof parsed.areaCode === 'string' ? parsed.areaCode : '',
      calendarConnected: parsed.calendarConnected === true,
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

function saveDraft(draft: OnboardingDraft) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Private browsing / storage quota — the wizard still works within a
    // single page lifetime, it just won't survive the OAuth redirect.
  }
}

/** Google's official four-color "G" mark. lucide-react ships no Google logo, so this is a small hand-built glyph. */
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

/**
 * OnboardingWizard — the Day 14 frictionless 3-step onboarding flow for
 * non-technical field workers:
 *   1. The Persona   — business name + trade dropdown
 *   2. The Calendar  — one-click "Continue with Google" OAuth (no manual
 *      calendar id entry)
 *   3. The Magic     — listen to a live demo, then deploy
 *
 * Strips the previous 6-step wizard and its Stripe/$99-per-month paywall
 * entirely (Apple App Store Guideline 3.1.1 compliance — see
 * src/app/dashboard and src/components/dashboard/FluxFoxConsole.tsx for the
 * same rollback). V1 ships as a free sandbox; no payment screen exists
 * anywhere in this flow.
 *
 * "Deploy Assistant" silently calls the existing, unmodified
 * `/api/assistant/deploy` and `/api/phone/provision` server routes — no API
 * key or third-party credential is ever read, stored, or rendered
 * client-side.
 */
export default function OnboardingWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const hasHydratedDraft = useRef(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [businessName, setBusinessName] = useState('');
  const [trade, setTrade] = useState('');
  const [areaCode, setAreaCode] = useState('');
  const [calendarConnected, setCalendarConnected] = useState(false);

  const [isConnectingCalendar, setIsConnectingCalendar] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [phoneWarning, setPhoneWarning] = useState<string | null>(null);

  // Hydrate from sessionStorage once on mount, then fold in the OAuth
  // callback's `?calendar=connected|error` result (see /auth/callback).
  useEffect(() => {
    if (hasHydratedDraft.current) return;
    hasHydratedDraft.current = true;

    const draft = loadDraft();
    setBusinessName(draft.businessName);
    setTrade(draft.trade);
    setAreaCode(draft.areaCode);

    const calendarResult = searchParams.get('calendar');

    if (calendarResult === 'connected') {
      setCalendarConnected(true);
      setStep(3);
      saveDraft({ ...draft, calendarConnected: true });
    } else if (calendarResult === 'error') {
      setCalendarConnected(draft.calendarConnected);
      setStep(2);
      setCalendarError('Google sign-in was cancelled or failed. Please try again.');
    } else if (draft.calendarConnected) {
      setCalendarConnected(true);
      setStep(3);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persist(partial: Partial<OnboardingDraft>) {
    const next: OnboardingDraft = {
      businessName,
      trade,
      areaCode,
      calendarConnected,
      ...partial,
    };
    saveDraft(next);
  }

  function handleContinueFromPersona() {
    if (!businessName.trim() || !trade) return;
    persist({});
    setStep(2);
  }

  async function handleConnectGoogle() {
    setCalendarError(null);
    setIsConnectingCalendar(true);
    persist({});

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
          // Calendar Events scope only — matches the privacy policy's
          // documented Google data handling and the offline refresh token
          // src/lib/google.ts expects on public.users.google_refresh_token.
          scopes: 'https://www.googleapis.com/auth/calendar.events',
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) {
        setCalendarError(error.message);
        setIsConnectingCalendar(false);
      }
      // On success the browser navigates to Google immediately; no further
      // client code runs until the user lands back on /auth/callback.
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : 'Failed to start Google sign-in.');
      setIsConnectingCalendar(false);
    }
  }

  async function handleDeployAssistant() {
    if (isDeploying) return;
    setDeployError(null);
    setPhoneWarning(null);
    setIsDeploying(true);

    try {
      const deployRes = await fetch('/api/assistant/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry: trade, businessName: businessName.trim() }),
      });
      const deployData = (await deployRes.json().catch(() => null)) as { error?: string } | null;

      if (!deployRes.ok) {
        throw new Error(deployData?.error || 'Failed to deploy your AI receptionist. Please try again.');
      }

      // Phone provisioning is best-effort: the assistant is already live at
      // this point, and the dashboard's FluxFoxConsole offers a retry for
      // claiming a number, so a failure here never blocks the redirect.
      const resolvedAreaCode = /^\d{3}$/.test(areaCode.trim()) ? areaCode.trim() : DEFAULT_AREA_CODE;

      try {
        const phoneRes = await fetch('/api/phone/provision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ areaCode: resolvedAreaCode }),
        });
        const phoneData = (await phoneRes.json().catch(() => null)) as { error?: string } | null;

        if (!phoneRes.ok) {
          setPhoneWarning(
            phoneData?.error ||
              'Your AI receptionist is live, but claiming a phone number failed. You can claim one from your dashboard.'
          );
        }
      } catch {
        setPhoneWarning(
          'Your AI receptionist is live, but claiming a phone number failed. You can claim one from your dashboard.'
        );
      }

      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      }

      router.push('/dashboard');
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : 'Something went wrong deploying your assistant.');
      setIsDeploying(false);
    }
  }

  return (
    <main
      id="fluxfox-onboarding-root"
      className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center px-4 py-12 relative overflow-hidden font-sans selection:bg-amber-500/30 selection:text-amber-200"
    >
      {/* Cyber Grid Background */}
      <div
        className="absolute inset-0 bg-[linear-gradient(to_right,#27272a15_1px,transparent_1px),linear-gradient(to_bottom,#27272a15_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none"
        aria-hidden="true"
      />

      <div className="relative w-full max-w-lg z-10">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center p-0.5 shadow-lg shadow-amber-500/20 ring-1 ring-amber-400/40 mb-4">
            <div className="w-full h-full bg-zinc-950 rounded-[10px] flex items-center justify-center">
              <Flame className="w-6 h-6 text-amber-400" />
            </div>
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">Let&rsquo;s get you live</h1>
          <p className="mt-1 text-sm text-zinc-500">Three quick steps. No credit card, no paperwork.</p>
        </div>

        {/* Step Progress */}
        <div id="onboarding-progress" className="mb-8">
          <div className="flex items-center justify-between mb-2 text-[11px] font-semibold tracking-wide">
            {(['Persona', 'Calendar', 'Magic'] as const).map((label, idx) => {
              const stepNumber = (idx + 1) as 1 | 2 | 3;
              const isComplete = stepNumber < step;
              const isActive = stepNumber === step;
              return (
                <div key={label} className="flex-1 flex flex-col items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all ${
                      isComplete
                        ? 'bg-amber-500 border-amber-500 text-zinc-950'
                        : isActive
                          ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                          : 'border-zinc-800 text-zinc-600 bg-zinc-900/70'
                    }`}
                  >
                    {isComplete ? <CheckCircle2 className="w-4 h-4" /> : stepNumber}
                  </div>
                  <span className={isActive || isComplete ? 'text-zinc-300' : 'text-zinc-600'}>{label}</span>
                </div>
              );
            })}
          </div>
          <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-300"
              style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>

        {/* Card */}
        <div
          id="onboarding-card"
          className="bg-zinc-900/95 border border-zinc-800/90 rounded-xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl relative"
        >
          <div className="absolute top-0 left-8 right-8 h-[2px] bg-gradient-to-r from-transparent via-amber-500 to-transparent opacity-80" />

          {/* Step 1 — The Persona */}
          {step === 1 && (
            <div id="step-persona">
              <h2 className="text-lg font-bold text-white tracking-tight mb-1">Tell us about your business</h2>
              <p className="text-sm text-zinc-500 mb-6">This shapes how your AI receptionist introduces itself.</p>

              <div className="space-y-4">
                <div>
                  <label htmlFor="business-name" className="block text-xs font-semibold text-zinc-400 mb-1.5 tracking-wide">
                    Business Name
                  </label>
                  <div className="relative">
                    <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                      id="business-name"
                      name="businessName"
                      type="text"
                      autoComplete="organization"
                      required
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="Ridgeline Plumbing Co."
                      className="w-full min-h-[44px] bg-zinc-950/70 border border-zinc-800 rounded-lg py-3 pl-10 pr-4 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="trade-select" className="block text-xs font-semibold text-zinc-400 mb-1.5 tracking-wide">
                    Trade
                  </label>
                  <div className="relative">
                    <select
                      id="trade-select"
                      name="trade"
                      required
                      value={trade}
                      onChange={(e) => setTrade(e.target.value)}
                      className="w-full min-h-[44px] appearance-none bg-zinc-950/70 border border-zinc-800 rounded-lg py-3 pl-4 pr-10 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all cursor-pointer"
                    >
                      <option value="" disabled>
                        Select your trade&hellip;
                      </option>
                      {TRADE_OPTIONS.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label htmlFor="area-code" className="block text-xs font-semibold text-zinc-400 mb-1.5 tracking-wide">
                    Area Code <span className="text-zinc-600 font-normal">(optional)</span>
                  </label>
                  <div className="relative">
                    <Hash className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                      id="area-code"
                      name="areaCode"
                      type="text"
                      inputMode="numeric"
                      maxLength={3}
                      value={areaCode}
                      onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                      placeholder="415"
                      className="w-full min-h-[44px] bg-zinc-950/70 border border-zinc-800 rounded-lg py-3 pl-10 pr-4 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-600">
                    For your new business phone number. We&rsquo;ll pick one for you if you skip this.
                  </p>
                </div>
              </div>

              <button
                id="persona-continue-button"
                type="button"
                onClick={handleContinueFromPersona}
                disabled={!businessName.trim() || !trade}
                className="mt-7 w-full min-h-[44px] flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-semibold py-3.5 px-6 rounded-lg transition-all duration-200 shadow-lg shadow-amber-500/25 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                Continue
              </button>
            </div>
          )}

          {/* Step 2 — The Calendar */}
          {step === 2 && (
            <div id="step-calendar">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <CalendarCheck2 className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-bold text-white tracking-tight">Connect your calendar</h2>
              </div>
              <p className="text-sm text-zinc-500 mb-6 mt-2">
                One click. Your AI receptionist books real appointments straight onto this calendar — no manual setup.
              </p>

              {calendarError && (
                <div
                  id="calendar-error-banner"
                  className="mb-5 p-3.5 bg-red-950/50 border border-red-800/80 rounded-lg text-xs text-red-200 flex items-start gap-2.5"
                >
                  <CircleAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{calendarError}</span>
                </div>
              )}

              <button
                id="connect-google-button"
                type="button"
                onClick={handleConnectGoogle}
                disabled={isConnectingCalendar}
                className="w-full min-h-[56px] flex items-center justify-center gap-3 bg-white hover:bg-zinc-100 text-zinc-900 font-semibold py-4 px-6 rounded-lg transition-all duration-200 shadow-lg active:scale-[0.99] disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer text-base"
              >
                {isConnectingCalendar ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Redirecting to Google&hellip;
                  </>
                ) : (
                  <>
                    <GoogleGlyph />
                    Continue with Google
                  </>
                )}
              </button>

              <p className="mt-4 text-center text-[11px] text-zinc-500">
                We only request calendar booking access &bull; Revoke anytime from your Google Account
              </p>

              <button
                id="step-2-back-button"
                type="button"
                onClick={() => setStep(1)}
                disabled={isConnectingCalendar}
                className="mt-6 w-full flex items-center justify-center gap-2 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-semibold py-3 px-6 rounded-lg transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            </div>
          )}

          {/* Step 3 — The Magic */}
          {step === 3 && (
            <div id="step-magic">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <PartyPopper className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-bold text-white tracking-tight">Hear it in action</h2>
              </div>
              <p className="text-sm text-zinc-500 mb-6 mt-2">
                This is exactly what your customers will hear when they call{' '}
                <span className="text-zinc-300 font-medium">{businessName || 'your business'}</span>.
              </p>

              <DemoAudioPlayer src="/audio/flux-demo-call.m4a" label="Listen to Demo" />

              <div className="mt-5 flex items-center gap-2 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Google Calendar connected</span>
              </div>

              {deployError && (
                <div
                  id="deploy-error-banner"
                  className="mt-5 p-3.5 bg-red-950/50 border border-red-800/80 rounded-lg text-xs text-red-200 flex items-start gap-2.5"
                >
                  <CircleAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{deployError}</span>
                </div>
              )}

              {phoneWarning && (
                <div
                  id="phone-warning-banner"
                  className="mt-5 p-3.5 bg-amber-950/40 border border-amber-800/60 rounded-lg text-xs text-amber-200 flex items-start gap-2.5"
                >
                  <CircleAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>{phoneWarning}</span>
                </div>
              )}

              <button
                id="deploy-assistant-button"
                type="button"
                onClick={handleDeployAssistant}
                disabled={isDeploying}
                className="mt-7 w-full min-h-[56px] flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-bold py-4 px-6 rounded-lg transition-all duration-200 shadow-lg shadow-amber-500/25 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer text-base"
              >
                {isDeploying ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Deploying your AI receptionist&hellip;
                  </>
                ) : (
                  <>
                    <Rocket className="w-5 h-5" />
                    Sounds Great! Deploy Assistant
                  </>
                )}
              </button>

              <button
                id="step-3-back-button"
                type="button"
                onClick={() => setStep(2)}
                disabled={isDeploying}
                className="mt-3 w-full flex items-center justify-center gap-2 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-semibold py-3 px-6 rounded-lg transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-zinc-500">
          FluxFox &bull; Free sandbox &bull; No credit card required
        </p>
      </div>
    </main>
  );
}
