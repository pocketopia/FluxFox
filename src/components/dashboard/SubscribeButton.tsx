'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Loader2 } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

export type SubscriptionPlan = 'monthly' | 'annual';

export interface SubscribeButtonProps {
  plan: SubscriptionPlan;
  label: string;
}

/** The distinct User-Agent token `mobile/App.tsx` appends via the WebView's
 * `applicationNameForUserAgent` prop. Used to detect when FluxFox is running
 * inside the native iOS/Android wrapper rather than a standard browser. */
const MOBILE_WEBVIEW_UA_TOKEN = 'FluxFoxMobileApp';

/** The shape of the `{ type: 'PURCHASE_RESULT', ... }` message
 * `mobile/App.tsx` posts back into the page via `injectJavaScript` once the
 * native Apple IAP purchase (and backend receipt verification) settles. */
interface PurchaseResultMessage {
  type: 'PURCHASE_RESULT';
  success: boolean;
  plan?: SubscriptionPlan;
  error?: string;
}

function isPurchaseResultMessage(value: unknown): value is PurchaseResultMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'PURCHASE_RESULT' &&
    typeof (value as { success?: unknown }).success === 'boolean'
  );
}

/** True when FluxFox is rendering inside the native Expo WebView wrapper
 * (see `mobile/App.tsx`), detected via the injected
 * `applicationNameForUserAgent` token rather than feature-sniffing, since
 * `window.ReactNativeWebView` is only injected after the page mounts. */
function isRunningInFluxFoxWebView(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.userAgent.includes(MOBILE_WEBVIEW_UA_TOKEN);
}

/**
 * The FluxFox "Subscribe" call to action. Detects whether it is rendering
 * inside the native iOS/Android WebView wrapper (`mobile/App.tsx`) or a
 * standard web browser, and routes the user down the App Store–compliant
 * path for each:
 *
 *   - Native WebView: `postMessage`s `{ type: 'PURCHASE', plan,
 *     supabaseAccessToken }` up to the native app, which triggers Apple's
 *     native In-App Purchase sheet (StoreKit) and POSTs the resulting
 *     receipt to `/api/apple/verify-receipt`.
 *   - Standard browser: POSTs to the existing `/api/stripe/checkout` route
 *     and redirects to the returned hosted Stripe Checkout URL.
 */
export default function SubscribeButton({ plan, label }: SubscribeButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isWebView, setIsWebView] = useState(false);

  useEffect(() => {
    setIsWebView(isRunningInFluxFoxWebView());
  }, []);

  // Listen for the native app's PURCHASE_RESULT reply (see
  // `postResultToWebView` in `mobile/App.tsx`), which arrives as a standard
  // `window.postMessage` event once the native purchase + receipt
  // verification round-trip completes.
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      let parsed: unknown = event.data;
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          return;
        }
      }

      if (!isPurchaseResultMessage(parsed)) return;

      setIsSubmitting(false);

      if (parsed.success) {
        setErrorMessage(null);
        router.refresh();
      } else {
        setErrorMessage(parsed.error || 'Your Apple purchase could not be completed.');
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [router]);

  const handleAppleIAPSubscribe = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('Please sign in again before subscribing.');
    }

    const webView = (
      window as unknown as {
        ReactNativeWebView?: { postMessage: (message: string) => void };
      }
    ).ReactNativeWebView;

    if (!webView) {
      throw new Error('The native purchase bridge is unavailable. Please restart the app.');
    }

    webView.postMessage(
      JSON.stringify({ type: 'PURCHASE', plan, supabaseAccessToken: session.access_token })
    );
  }, [plan]);

  const handleStripeCheckoutSubscribe = useCallback(async () => {
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });

    const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;

    if (!res.ok || !data?.url) {
      throw new Error(data?.error || 'Failed to start checkout. Please try again.');
    }

    window.location.href = data.url;
  }, [plan]);

  async function handleSubscribe() {
    if (isSubmitting) return;
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      if (isWebView) {
        await handleAppleIAPSubscribe();
        // isSubmitting is cleared by the PURCHASE_RESULT listener above once
        // the native round-trip completes.
      } else {
        await handleStripeCheckoutSubscribe();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong starting checkout.');
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        id={`subscribe-button-${plan}`}
        type="button"
        onClick={handleSubscribe}
        disabled={isSubmitting}
        className="min-h-[44px] flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-semibold px-5 py-2.5 rounded-lg shadow-lg shadow-amber-500/25 transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-sm"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <CreditCard className="w-4 h-4" />
            {label}
          </>
        )}
      </button>
      {errorMessage && <p className="text-xs text-red-400 text-right max-w-xs">{errorMessage}</p>}
    </div>
  );
}
