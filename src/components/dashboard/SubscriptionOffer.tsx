import { CheckCircle2, ShieldCheck } from 'lucide-react';
import SubscribeButton from '@/components/dashboard/SubscribeButton';

/** Every FluxFox plan (monthly AND annual) starts with this free trial. */
export const FREE_TRIAL_DAYS = 7;

/**
 * The FluxFox paywall offer. Shows BOTH the Monthly and Annual plans with the
 * 7-day free trial and the auto-renewal disclosure required by Apple App
 * Store Review Guideline 3.1.2 (trial length, what happens when it ends, the
 * billing period, how to cancel, and links to the Terms & Privacy Policy).
 *
 * The exact localized price is shown by Apple's native purchase sheet (iOS)
 * or Stripe Checkout (web) before the user confirms.
 */
export default function SubscriptionOffer() {
  return (
    <div id="subscription-offer" className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-4 rounded-lg bg-zinc-950/70 border border-zinc-800 flex flex-col gap-3">
          <div>
            <p className="text-sm font-bold text-white">FluxFox Pro — Monthly</p>
            <p className="text-xs text-amber-400 font-semibold mt-0.5">{FREE_TRIAL_DAYS}-Day Free Trial</p>
            <p className="text-[11px] text-zinc-500 mt-1">Then renews monthly until cancelled.</p>
          </div>
          <SubscribeButton plan="monthly" label={`Start ${FREE_TRIAL_DAYS}-Day Free Trial`} />
        </div>

        <div className="p-4 rounded-lg bg-zinc-950/70 border border-amber-500/40 flex flex-col gap-3">
          <div>
            <p className="text-sm font-bold text-white">
              FluxFox Pro — Annual <span className="text-emerald-400 text-xs font-semibold ml-1">Save 20%</span>
            </p>
            <p className="text-xs text-amber-400 font-semibold mt-0.5">{FREE_TRIAL_DAYS}-Day Free Trial</p>
            <p className="text-[11px] text-zinc-500 mt-1">Then renews yearly until cancelled.</p>
          </div>
          <SubscribeButton plan="annual" label={`Start ${FREE_TRIAL_DAYS}-Day Free Trial`} />
        </div>
      </div>

      <ul className="space-y-1.5 text-xs text-zinc-300">
        <li className="flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
          <span>Your live AI receptionist, business phone number, and call forwarding.</span>
        </li>
        <li className="flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
          <span>Try the demo above for free — no subscription needed to hear FluxFox in action.</span>
        </li>
      </ul>

      <div
        id="auto-renewal-terms"
        className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800 flex items-start gap-2.5"
      >
        <ShieldCheck className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Try FluxFox free for {FREE_TRIAL_DAYS} days on either plan. After the {FREE_TRIAL_DAYS}-day free trial, your
          subscription automatically renews at the price shown at checkout (monthly or annually, per the plan you
          choose) unless you cancel at least 24 hours before the trial or current period ends. Payment is charged to
          your Apple ID account at confirmation of purchase (or to your card via Stripe on the web). Your account is
          charged for renewal within 24 hours before the end of the current period. Manage or cancel anytime in your
          device&rsquo;s Settings &rarr; Apple ID &rarr; Subscriptions (or from your Stripe receipt on the web). Any
          unused portion of a free trial is forfeited when you purchase a subscription. By subscribing you agree to
          our{' '}
          <a href="/terms" className="text-amber-400 underline">
            Terms of Use
          </a>{' '}
          and{' '}
          <a href="/privacy" className="text-amber-400 underline">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}
