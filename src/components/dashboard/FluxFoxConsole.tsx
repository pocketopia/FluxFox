'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Flame,
  Loader2,
  PhoneCall,
  Sparkles,
  Wrench,
  Home,
  Zap,
  Thermometer,
  Trees,
  KeyRound,
  PaintBucket,
  Bug,
  HardHat,
  Hammer,
  ArrowRight,
  PartyPopper,
  PhoneOutgoing,
} from 'lucide-react';

export interface FluxFoxConsoleProps {
  /** The user's live `vapi_assistant_id` from public.users, or null if not yet deployed. */
  vapiAssistantId: string | null;
  /** The user's live `twilio_phone_number` from public.users, or null if not yet provisioned. */
  twilioPhoneNumber: string | null;
}

interface IndustryOption {
  value: string;
  label: string;
  icon: typeof Wrench;
}

const INDUSTRY_OPTIONS: IndustryOption[] = [
  { value: 'plumber', label: 'Plumbing', icon: Wrench },
  { value: 'roofer', label: 'Roofing', icon: Home },
  { value: 'electrician', label: 'Electrical', icon: Zap },
  { value: 'hvac', label: 'HVAC', icon: Thermometer },
  { value: 'landscaper', label: 'Landscaping', icon: Trees },
  { value: 'locksmith', label: 'Locksmith', icon: KeyRound },
  { value: 'painter', label: 'Painting', icon: PaintBucket },
  { value: 'pest_control', label: 'Pest Control', icon: Bug },
  { value: 'general_contractor', label: 'General Contracting', icon: HardHat },
  { value: 'handyman', label: 'Handyman', icon: Hammer },
];

/** Formats a raw E.164 US number (+1XXXXXXXXXX) into (XXX) XXX-XXXX for display. */
function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const tenDigit = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (tenDigit.length !== 10) return raw;
  return `(${tenDigit.slice(0, 3)}) ${tenDigit.slice(3, 6)}-${tenDigit.slice(6)}`;
}

/** Flux's circular cyber-fox avatar, reused across every onboarding step. */
function FluxAvatar() {
  return (
    <div className="w-11 h-11 shrink-0 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center p-0.5 shadow-lg shadow-amber-500/20 ring-1 ring-amber-400/40">
      <div className="w-full h-full bg-zinc-950 rounded-[9px] flex items-center justify-center">
        <Flame className="w-5 h-5 text-amber-400" />
      </div>
    </div>
  );
}

/** A premium speech bubble with a left-pointing tail, styled for the cyber dashboard theme. */
function FluxBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex-1 min-w-0">
      <div className="absolute -left-2 top-4 w-3 h-3 bg-zinc-950/90 border-l border-b border-zinc-800 rotate-45" />
      <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl rounded-tl-sm px-4 py-3.5 text-sm text-zinc-200 leading-relaxed shadow-lg">
        {children}
      </div>
    </div>
  );
}

/**
 * FluxFoxConsole — the guided, mascot-led onboarding wizard.
 *
 * Renders one of three live states derived strictly from the database
 * props passed down by the dashboard server component:
 *   0. No `vapiAssistantId`               → choose industry, deploy AI
 *   1. `vapiAssistantId`, no phone number → claim a business line
 *   2. Both present                        → fully active, test-call ready
 *
 * STRATEGIC PIVOT (App Store IAP compliance): the Stripe subscription
 * blocker that previously gated step 0 behind a web-based paywall has been
 * removed. Onboarding now starts directly at step 0 for every signed-in
 * user. Monetization moves to a future in-app purchase flow (Apple/Google
 * IAP), which will be re-introduced at step 2 once the assistant and
 * phone number are live — see the "Test Call (Demo)" placeholder below,
 * reserved for that upcoming paywall.
 *
 * No client-side state ever fabricates a deployed assistant or phone
 * number; success only advances the UI after the corresponding API call
 * returns 200, and the page is refreshed so the server re-reads the true
 * database state.
 */
export default function FluxFoxConsole({ vapiAssistantId, twilioPhoneNumber }: FluxFoxConsoleProps) {
  const router = useRouter();

  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [areaCode, setAreaCode] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const step: 0 | 1 | 2 = !vapiAssistantId ? 0 : !twilioPhoneNumber ? 1 : 2;

  async function handleDeployAssistant() {
    if (!selectedIndustry || isDeploying) return;
    setErrorMessage(null);
    setIsDeploying(true);

    try {
      const res = await fetch('/api/assistant/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry: selectedIndustry }),
      });

      const data = (await res.json().catch(() => null)) as { error?: string } | null;

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to deploy your AI receptionist. Please try again.');
      }

      router.refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong deploying your assistant.');
    } finally {
      setIsDeploying(false);
    }
  }

  async function handleClaimNumber() {
    if (isProvisioning) return;

    if (!/^\d{3}$/.test(areaCode.trim())) {
      setErrorMessage('Enter a valid 3-digit area code (e.g. 415).');
      return;
    }

    setErrorMessage(null);
    setIsProvisioning(true);

    try {
      const res = await fetch('/api/phone/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ areaCode: areaCode.trim() }),
      });

      const data = (await res.json().catch(() => null)) as { error?: string } | null;

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to claim your business line. Please try again.');
      }

      router.refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong claiming your number.');
    } finally {
      setIsProvisioning(false);
    }
  }

  return (
    <section
      id="fluxfox-console"
      className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-6 sm:p-8 pb-safe-bottom relative overflow-hidden shadow-2xl backdrop-blur-xl mb-10"
    >
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-500 via-orange-400 to-cyan-500" />

      <div className="flex items-start gap-4">
        <FluxAvatar />

        {step === 0 && (
          <FluxBubble>
            <p className="font-semibold text-white mb-1">Hey, I&rsquo;m Flux! 🦊</p>
            <p>Let&rsquo;s get your AI receptionist online. What industry are you in?</p>
          </FluxBubble>
        )}

        {step === 1 && (
          <FluxBubble>
            <p className="font-semibold text-white mb-1">Awesome! Your AI is ready. ✅</p>
            <p>What area code should we buy for your new business line?</p>
          </FluxBubble>
        )}

        {step === 2 && twilioPhoneNumber && (
          <FluxBubble>
            <p className="font-semibold text-white mb-1 flex items-center gap-1.5">
              You did it! Your AI receptionist is live! <PartyPopper className="w-4 h-4 text-amber-400" />
            </p>
            <p>
              Calls to{' '}
              <span className="text-amber-400 font-semibold">{formatPhoneNumber(twilioPhoneNumber)}</span> are now
              answered by your AI, 24/7 — booking real appointments straight to your calendar while you focus on the
              job. Give it a try below.
            </p>
          </FluxBubble>
        )}
      </div>

      {errorMessage && (
        <div
          id="fluxfox-console-error"
          className="mt-5 ml-0 sm:ml-[60px] p-3 bg-red-950/50 border border-red-800/80 rounded-lg text-xs text-red-200"
        >
          {errorMessage}
        </div>
      )}

      {step === 0 && (
        <div className="mt-5 ml-0 sm:ml-[60px]">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
            {INDUSTRY_OPTIONS.map(({ value, label, icon: Icon }) => {
              const isSelected = selectedIndustry === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSelectedIndustry(value)}
                  disabled={isDeploying}
                  className={`flex flex-col items-center justify-center gap-1.5 min-h-[44px] px-2 py-3 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                    isSelected
                      ? 'bg-amber-500/15 border-amber-500/60 text-amber-300'
                      : 'bg-zinc-950/70 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              );
            })}
          </div>

          <button
            id="deploy-ai-button"
            type="button"
            onClick={handleDeployAssistant}
            disabled={!selectedIndustry || isDeploying}
            className="w-full sm:w-auto min-h-[44px] flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-semibold px-6 py-3 rounded-lg shadow-lg shadow-amber-500/25 transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isDeploying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Deploying your AI...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Deploy AI
              </>
            )}
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="mt-5 ml-0 sm:ml-[60px] flex flex-col sm:flex-row items-stretch sm:items-center gap-3 scroll-mt-24">
          <input
            id="area-code-input"
            type="text"
            inputMode="numeric"
            maxLength={3}
            placeholder="415"
            value={areaCode}
            onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
            disabled={isProvisioning}
            className="w-full sm:w-28 min-h-[44px] bg-zinc-950/70 border border-zinc-800 rounded-lg px-4 py-3 text-center text-lg font-semibold tracking-widest text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 disabled:opacity-60 scroll-mt-24"
          />

          <button
            id="claim-number-button"
            type="button"
            onClick={handleClaimNumber}
            disabled={areaCode.length !== 3 || isProvisioning}
            className="min-h-[44px] flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-semibold px-6 py-3 rounded-lg shadow-lg shadow-amber-500/25 transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isProvisioning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Claiming your number...
              </>
            ) : (
              <>
                <PhoneCall className="w-4 h-4" />
                Claim Number
              </>
            )}
          </button>
        </div>
      )}

      {step === 2 && twilioPhoneNumber && (
        <div className="mt-5 ml-0 sm:ml-[60px] space-y-4">
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <ArrowRight className="w-3.5 h-3.5" />
            <span>Share this number with customers, or forward your existing business line to it.</span>
          </div>

          {/*
            "Test Call (Demo)" — reserved slot for the future App Store /
            Play Store in-app purchase paywall (Day 8's Stripe web paywall
            was rolled back for IAP compliance). For now this simply lets
            the owner dial their own live AI receptionist number to hear it
            in action; it performs a real `tel:` call, never a simulated one.
          */}
          <div
            id="test-call-demo"
            className="p-4 rounded-lg bg-zinc-950/70 border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
                <PhoneOutgoing className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Test Call (Demo)</p>
                <p className="text-xs text-zinc-400">Hear your AI receptionist answer live, right now.</p>
              </div>
            </div>

            <a
              id="test-call-button"
              href={`tel:${twilioPhoneNumber}`}
              className="min-h-[44px] flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 font-semibold px-5 py-2.5 rounded-lg transition-colors cursor-pointer text-sm"
            >
              <PhoneCall className="w-4 h-4" />
              Call {formatPhoneNumber(twilioPhoneNumber)}
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
