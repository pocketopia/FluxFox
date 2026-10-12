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
  ArrowLeft,
  PartyPopper,
  PhoneOutgoing,
  PhoneForwarded,
  Rocket,
  Building2,
  Wand2,
  PencilLine,
  ThumbsUp,
  CircleAlert,
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
 * STRATEGIC PIVOT (App Store IAP compliance): this wizard never gates on
 * `subscription_status` — onboarding always starts at step 0 for every
 * signed-in user, so the core product experience is reachable without a
 * paywall. Monetization instead lives in the dashboard's Billing section
 * (`SubscribeButton`, see `src/app/dashboard/page.tsx`), which triggers
 * native Apple IAP inside the mobile WebView (`mobile/App.tsx` +
 * `/api/apple/verify-receipt`) or Stripe Checkout in a standard browser.
 *
 * No client-side state ever fabricates a deployed assistant or phone
 * number; success only advances the UI after the corresponding API call
 * returns 200, and the page is refreshed so the server re-reads the true
 * database state.
 */
/**
 * The assistant creation sub-wizard's internal phases (only relevant while
 * `step === 0`, i.e. no assistant has been deployed yet):
 *   industry     — choose a trade vertical (unchanged from before)
 *   company      — NEW: enter the business's display name
 *   choice       — NEW: Path A (auto-generate) vs Path B (write it myself)
 *   auto-review  — Path A: review the AI-generated prompt; "I like it!" or "Edit"
 *   manual-write — Path B: write the system prompt from scratch
 *   ready        — final review before the real "Deploy AI" network call
 */
type SetupPhase = 'industry' | 'company' | 'choice' | 'auto-review' | 'manual-write' | 'ready';

/**
 * The phone-number step's internal path (only relevant while `step === 1`,
 * i.e. an assistant has been deployed but no number has been provisioned
 * yet):
 *   choice   — NEW: big, clear fork between getting a new line vs. forwarding
 *   new      — Path A: "Get a New Business Line" — shows the area code input
 *   existing — Path B: "Use My Existing Number" — explains the background VA
 *              number they'll forward calls to, then still collects an area
 *              code for that background number (the API always purchases a
 *              real Twilio number to bind the assistant to).
 */
type PhoneNumberPath = 'choice' | 'new' | 'existing';

export default function FluxFoxConsole({ vapiAssistantId, twilioPhoneNumber }: FluxFoxConsoleProps) {
  const router = useRouter();

  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [areaCode, setAreaCode] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // --- Phone number step state (two-path choice: new line vs. forward existing) ---
  const [phoneNumberPath, setPhoneNumberPath] = useState<PhoneNumberPath>('choice');

  // --- Assistant creation wizard state (Company Name step + two-path prompt setup) ---
  const [setupPhase, setSetupPhase] = useState<SetupPhase>('industry');
  const [companyName, setCompanyName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);

  const step: 0 | 1 | 2 = !vapiAssistantId ? 0 : !twilioPhoneNumber ? 1 : 2;

  function handleIndustryContinue() {
    if (!selectedIndustry) return;
    setErrorMessage(null);
    setSetupPhase('company');
  }

  function handleCompanyContinue() {
    if (!companyName.trim()) return;
    setErrorMessage(null);
    setSetupPhase('choice');
  }

  /** Path A: ask the server to auto-generate a prompt tailored to this company name + trade. */
  async function handleChooseAutoGenerate() {
    if (!selectedIndustry || isGeneratingPrompt) return;
    setErrorMessage(null);
    setIsGeneratingPrompt(true);

    try {
      const res = await fetch('/api/assistant/suggest-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry: selectedIndustry, companyName: companyName.trim() }),
      });

      const data = (await res.json().catch(() => null)) as { systemPrompt?: string; error?: string } | null;

      if (!res.ok || !data?.systemPrompt) {
        throw new Error(data?.error || 'Failed to generate a suggested prompt. Please try again.');
      }

      setSystemPrompt(data.systemPrompt);
      setIsEditingPrompt(false);
      setSetupPhase('auto-review');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong generating your prompt.');
    } finally {
      setIsGeneratingPrompt(false);
    }
  }

  /** Path B: skip generation entirely and let the user write the prompt from scratch. */
  function handleChooseManual() {
    setErrorMessage(null);
    setSystemPrompt('');
    setSetupPhase('manual-write');
  }

  /** Path A — "I like it!": accept the auto-generated prompt verbatim. */
  function handleAcceptGeneratedPrompt() {
    setIsEditingPrompt(false);
    setSetupPhase('ready');
  }

  /** Path A — "Edit": switch the reviewed prompt into an editable textarea in place. */
  function handleEditGeneratedPrompt() {
    setIsEditingPrompt(true);
  }

  /** Path A — confirms the edited prompt and proceeds to the final review step. */
  function handleSaveEditedPrompt() {
    if (!systemPrompt.trim()) return;
    setIsEditingPrompt(false);
    setSetupPhase('ready');
  }

  /** Path B — confirms the manually-written prompt and proceeds to the final review step. */
  function handleManualContinue() {
    if (!systemPrompt.trim()) return;
    setSetupPhase('ready');
  }

  async function handleDeployAssistant() {
    if (!selectedIndustry || isDeploying) return;
    setErrorMessage(null);
    setIsDeploying(true);

    try {
      const res = await fetch('/api/assistant/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry: selectedIndustry,
          companyName: companyName.trim(),
          systemPrompt: systemPrompt.trim() || undefined,
        }),
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

        {step === 0 && setupPhase === 'industry' && (
          <FluxBubble>
            <p className="font-semibold text-white mb-1">Hey, I&rsquo;m Flux! 🦊</p>
            <p>Let&rsquo;s get your AI receptionist online. What industry are you in?</p>
          </FluxBubble>
        )}

        {step === 0 && setupPhase === 'company' && (
          <FluxBubble>
            <p className="font-semibold text-white mb-1">Nice choice! 👍</p>
            <p>What&rsquo;s your company name? I&rsquo;ll use it to personalize how your AI answers the phone.</p>
          </FluxBubble>
        )}

        {step === 0 && setupPhase === 'choice' && (
          <FluxBubble>
            <p className="font-semibold text-white mb-1">Got it, {companyName || 'there'}! 🎯</p>
            <p>How would you like to set up your AI&rsquo;s prompt and behavior?</p>
          </FluxBubble>
        )}

        {step === 0 && setupPhase === 'auto-review' && (
          <FluxBubble>
            <p className="font-semibold text-white mb-1">Here&rsquo;s what I came up with! ✨</p>
            <p>Take a look at the prompt below — like it as-is, or tweak it to match your voice.</p>
          </FluxBubble>
        )}

        {step === 0 && setupPhase === 'manual-write' && (
          <FluxBubble>
            <p className="font-semibold text-white mb-1">You&rsquo;re the boss! ✍️</p>
            <p>Write the system prompt that defines how your AI receptionist should behave.</p>
          </FluxBubble>
        )}

        {step === 0 && setupPhase === 'ready' && (
          <FluxBubble>
            <p className="font-semibold text-white mb-1">Looking good! 🚀</p>
            <p>Everything&rsquo;s set — deploy your AI receptionist whenever you&rsquo;re ready.</p>
          </FluxBubble>
        )}

        {step === 1 && phoneNumberPath === 'choice' && (
          <FluxBubble>
            <p className="font-semibold text-white mb-1">Awesome! Your AI is ready. ✅</p>
            <p>Last step — how do you want customers to reach it?</p>
          </FluxBubble>
        )}

        {step === 1 && phoneNumberPath === 'new' && (
          <FluxBubble>
            <p className="font-semibold text-white mb-1">New Business Line 📞</p>
            <p>What area code should we buy for your brand-new business number?</p>
          </FluxBubble>
        )}

        {step === 1 && phoneNumberPath === 'existing' && (
          <FluxBubble>
            <p className="font-semibold text-white mb-1">Forwarding Your Existing Number ↪️</p>
            <p>
              We&rsquo;ll still provision a background AI number for your assistant to answer on — you just forward
              your current business number to it. What area code should that background number be in?
            </p>
          </FluxBubble>
        )}

        {step === 2 && twilioPhoneNumber && (
          <FluxBubble>
            <p className="font-semibold text-white mb-1 flex items-center gap-1.5">
              You did it! Your AI receptionist is live! <PartyPopper className="w-4 h-4 text-amber-400" />
            </p>
            <p>
              Calls to your new number are now answered by your AI, 24/7 — booking real appointments straight to your
              calendar while you focus on the job. Give it a try below.
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

      {step === 0 && setupPhase === 'industry' && (
        <div className="mt-5 ml-0 sm:ml-[60px]">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
            {INDUSTRY_OPTIONS.map(({ value, label, icon: Icon }) => {
              const isSelected = selectedIndustry === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSelectedIndustry(value)}
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
            id="industry-continue-button"
            type="button"
            onClick={handleIndustryContinue}
            disabled={!selectedIndustry}
            className="w-full sm:w-auto min-h-[44px] flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-semibold px-6 py-3 rounded-lg shadow-lg shadow-amber-500/25 transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
            Continue
          </button>
        </div>
      )}

      {/* NEW: Company Name step — collects the business's display name before any prompt is generated. */}
      {step === 0 && setupPhase === 'company' && (
        <div className="mt-5 ml-0 sm:ml-[60px]">
          <label htmlFor="company-name-input" className="block text-xs font-medium text-zinc-400 mb-2">
            Company name
          </label>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1">
              <Building2 className="w-4 h-4 text-zinc-600 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="company-name-input"
                type="text"
                autoComplete="organization"
                placeholder="Ridgeline Plumbing Co."
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full min-h-[44px] bg-zinc-950/70 border border-zinc-800 rounded-lg pl-10 pr-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50"
              />
            </div>

            <button
              id="company-name-continue-button"
              type="button"
              onClick={handleCompanyContinue}
              disabled={!companyName.trim()}
              className="min-h-[44px] flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-semibold px-6 py-3 rounded-lg shadow-lg shadow-amber-500/25 transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              Continue
            </button>
          </div>

          <button
            id="company-name-back-button"
            type="button"
            onClick={() => setSetupPhase('industry')}
            className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
        </div>
      )}

      {/* NEW: two-path prompt/behavior setup — Path A (auto-generate) vs Path B (write it myself). */}
      {step === 0 && setupPhase === 'choice' && (
        <div className="mt-5 ml-0 sm:ml-[60px] grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            id="path-auto-generate-button"
            type="button"
            onClick={handleChooseAutoGenerate}
            disabled={isGeneratingPrompt}
            className="flex flex-col items-start gap-2 p-4 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15 text-left transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400">
              {isGeneratingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">
                {isGeneratingPrompt ? 'Generating your prompt…' : 'Let the AI write it for me'}
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                Flux auto-generates a custom prompt based on &ldquo;{companyName}&rdquo; and your trade. You can
                still tweak it afterward.
              </p>
            </div>
          </button>

          <button
            id="path-manual-button"
            type="button"
            onClick={handleChooseManual}
            disabled={isGeneratingPrompt}
            className="flex flex-col items-start gap-2 p-4 rounded-lg border border-zinc-800 bg-zinc-950/70 hover:border-zinc-700 text-left transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <PencilLine className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">I&rsquo;ll write it myself</p>
              <p className="text-xs text-zinc-400 mt-0.5">
                Start from a blank slate and fully customize your AI&rsquo;s behavior and prompt.
              </p>
            </div>
          </button>

          <button
            id="choice-back-button"
            type="button"
            onClick={() => setSetupPhase('company')}
            className="sm:col-span-2 flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer w-fit"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
        </div>
      )}

      {/* Path A review — "I like it!" or "Edit" (or save the edit, once editing). */}
      {step === 0 && setupPhase === 'auto-review' && (
        <div className="mt-5 ml-0 sm:ml-[60px] space-y-4">
          {isEditingPrompt ? (
            <textarea
              id="auto-generated-prompt-textarea"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={10}
              className="w-full bg-zinc-950/70 border border-amber-500/40 rounded-lg px-4 py-3 text-xs text-zinc-200 leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 font-mono"
            />
          ) : (
            <div
              id="auto-generated-prompt-preview"
              className="w-full max-h-72 overflow-y-auto bg-zinc-950/70 border border-zinc-800 rounded-lg px-4 py-3 text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap font-mono"
            >
              {systemPrompt}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            {isEditingPrompt ? (
              <button
                id="save-edited-prompt-button"
                type="button"
                onClick={handleSaveEditedPrompt}
                disabled={!systemPrompt.trim()}
                className="flex-1 min-h-[44px] flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-semibold px-6 py-3 rounded-lg shadow-lg shadow-amber-500/25 transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <ThumbsUp className="w-4 h-4" />
                Save Changes
              </button>
            ) : (
              <>
                <button
                  id="accept-generated-prompt-button"
                  type="button"
                  onClick={handleAcceptGeneratedPrompt}
                  className="flex-1 min-h-[44px] flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-semibold px-6 py-3 rounded-lg shadow-lg shadow-amber-500/25 transition-all active:scale-[0.99] cursor-pointer"
                >
                  <ThumbsUp className="w-4 h-4" />
                  I like it!
                </button>
                <button
                  id="edit-generated-prompt-button"
                  type="button"
                  onClick={handleEditGeneratedPrompt}
                  className="flex-1 min-h-[44px] flex items-center justify-center gap-2 border border-zinc-800 hover:border-zinc-700 text-zinc-200 font-semibold px-6 py-3 rounded-lg transition-all cursor-pointer"
                >
                  <PencilLine className="w-4 h-4" />
                  Edit
                </button>
              </>
            )}
          </div>

          <button
            id="auto-review-back-button"
            type="button"
            onClick={() => setSetupPhase('choice')}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
        </div>
      )}

      {/* Path B — write the system prompt from scratch. */}
      {step === 0 && setupPhase === 'manual-write' && (
        <div className="mt-5 ml-0 sm:ml-[60px] space-y-4">
          <textarea
            id="manual-prompt-textarea"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={10}
            placeholder={`You are the AI phone receptionist for ${companyName || 'your business'}. You handle inbound calls to schedule, reschedule, and confirm service appointments...`}
            className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg px-4 py-3 text-xs text-zinc-200 leading-relaxed placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 font-mono"
          />

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              id="manual-prompt-continue-button"
              type="button"
              onClick={handleManualContinue}
              disabled={!systemPrompt.trim()}
              className="flex-1 min-h-[44px] flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-semibold px-6 py-3 rounded-lg shadow-lg shadow-amber-500/25 transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              Continue
            </button>
          </div>

          <button
            id="manual-write-back-button"
            type="button"
            onClick={() => setSetupPhase('choice')}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
        </div>
      )}

      {/* Final review — real "Deploy AI" network call, unchanged behavior from before. */}
      {step === 0 && setupPhase === 'ready' && (
        <div className="mt-5 ml-0 sm:ml-[60px] space-y-4">
          <div
            id="ready-to-deploy-summary"
            className="p-4 rounded-lg bg-zinc-950/70 border border-zinc-800 flex items-start gap-3"
          >
            <CircleAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-zinc-400">
              Ready to deploy <span className="text-zinc-200 font-semibold">{companyName}</span>&rsquo;s AI
              receptionist with your configured prompt.
            </p>
          </div>

          <button
            id="deploy-ai-button"
            type="button"
            onClick={handleDeployAssistant}
            disabled={isDeploying}
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

          <button
            id="ready-back-button"
            type="button"
            onClick={() => setSetupPhase('choice')}
            disabled={isDeploying}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
        </div>
      )}

      {/*
        NEW: massive, unmissable two-path fork for the phone number step.
        Path A ("Get a New Business Line") reveals the area code input to
        buy a fresh Twilio/Vapi number outright. Path B ("Use My Existing
        Number") makes clear we still provision a background VA number
        behind the scenes — the owner forwards their current business line
        to it rather than handing out a brand-new number to customers.
      */}
      {step === 1 && phoneNumberPath === 'choice' && (
        <div className="mt-5 ml-0 sm:ml-[60px] grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            id="phone-path-new-button"
            type="button"
            onClick={() => {
              setErrorMessage(null);
              setPhoneNumberPath('new');
            }}
            className="flex flex-col items-start gap-3 p-6 rounded-xl border-2 border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/15 hover:border-amber-400 text-left transition-all cursor-pointer"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Rocket className="w-6 h-6" />
            </div>
            <div>
              <p className="text-lg font-bold text-white">Get a New Business Line</p>
              <p className="text-sm text-zinc-400 mt-1">
                We&rsquo;ll buy you a brand-new phone number in any area code you want. Hand it out to customers
                right away.
              </p>
            </div>
          </button>

          <button
            id="phone-path-existing-button"
            type="button"
            onClick={() => {
              setErrorMessage(null);
              setPhoneNumberPath('existing');
            }}
            className="flex flex-col items-start gap-3 p-6 rounded-xl border-2 border-zinc-800 bg-zinc-950/70 hover:border-cyan-500/50 hover:bg-cyan-500/5 text-left transition-all cursor-pointer"
          >
            <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <PhoneForwarded className="w-6 h-6" />
            </div>
            <div>
              <p className="text-lg font-bold text-white">Use My Existing Number</p>
              <p className="text-sm text-zinc-400 mt-1">
                Keep the number you already advertise. We&rsquo;ll still provision a background AI line for you to
                forward your calls to.
              </p>
            </div>
          </button>
        </div>
      )}

      {step === 1 && phoneNumberPath === 'existing' && (
        <div
          id="existing-number-explainer"
          className="mt-5 ml-0 sm:ml-[60px] p-4 rounded-lg bg-cyan-500/5 border border-cyan-500/30 flex items-start gap-3"
        >
          <CircleAlert className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <p className="text-xs text-zinc-300 leading-relaxed">
            Your customers keep dialing the number they already know. We&rsquo;ll provision a dedicated background
            number for your AI receptionist below — once it&rsquo;s live, just set up call forwarding from your
            existing number to it (your phone carrier can usually do this in a couple of minutes) and every call
            will reach your AI automatically.
          </p>
        </div>
      )}

      {step === 1 && (phoneNumberPath === 'new' || phoneNumberPath === 'existing') && (
        <div className="mt-5 ml-0 sm:ml-[60px] space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 scroll-mt-24">
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
                  {phoneNumberPath === 'existing' ? 'Provision Background Number' : 'Claim Number'}
                </>
              )}
            </button>
          </div>

          <button
            id="phone-path-back-button"
            type="button"
            onClick={() => {
              setErrorMessage(null);
              setPhoneNumberPath('choice');
            }}
            disabled={isProvisioning}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
        </div>
      )}

      {step === 2 && twilioPhoneNumber && (
        <div className="mt-5 ml-0 sm:ml-[60px] space-y-4">
          {/*
            HUGE, undeniably clear display of the live number — this is the
            single number the owner needs to know (to hand to customers, or
            to forward their existing line to), so it's rendered far larger
            than any other text in the console.
          */}
          <div
            id="twilio-phone-number-display"
            className="p-6 rounded-xl bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 border-2 border-emerald-500/40 text-center"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
              Your AI Receptionist&rsquo;s Live Number
            </p>
            <p className="text-4xl sm:text-5xl font-black tracking-tight text-white break-all [font-variant-numeric:tabular-nums]">
              {formatPhoneNumber(twilioPhoneNumber)}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <ArrowRight className="w-3.5 h-3.5" />
            <span>Share this number with customers, or forward your existing business line to it.</span>
          </div>

          {/*
            "Test Call (Demo)" lets the owner dial their own live AI
            receptionist number to hear it in action; it performs a real
            `tel:` call, never a simulated one. Monetization is handled
            separately by the Billing section's SubscribeButton (see
            src/app/dashboard/page.tsx), not gated behind this step.
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
