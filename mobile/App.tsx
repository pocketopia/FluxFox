import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Alert, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import {
  endConnection,
  finishTransaction,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestSubscription,
  type Purchase,
  type PurchaseError,
} from 'react-native-iap';

// Production FluxFox web app URL. Override for local/staging builds via the
// EXPO_PUBLIC_WEBAPP_URL environment variable (see .env.example).
const WEBAPP_URL =
  process.env.EXPO_PUBLIC_WEBAPP_URL ?? 'https://fluxfox.app';

// Apple App Store Connect product (SKU) ids for the FluxFox auto-renewable
// subscription group. These must exactly match the Product IDs configured
// in App Store Connect under the FluxFox subscription group.
const APPLE_SUBSCRIPTION_SKUS: Record<'monthly' | 'annual', string> = {
  monthly: 'com.fluxfox.app.subscription.monthly',
  annual: 'com.fluxfox.app.subscription.annual',
};

// Locks the viewport to disable pinch-to-zoom and double-tap scaling so the
// wrapped web app feels indistinguishable from a native screen.
const DISABLE_ZOOM_SCRIPT = `
  (function () {
    const meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content =
      'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no';
    document.getElementsByTagName('head')[0].appendChild(meta);
  })();
  true;
`;

/** The shape of a `window.ReactNativeWebView.postMessage(...)` payload sent up
 * from the FluxFox web app's Subscribe button (see
 * `src/components/dashboard/FluxFoxConsole.tsx`). `supabaseAccessToken` is
 * required so the backend receipt-verification endpoint can resolve which
 * Supabase user to mark `subscription_status = 'active'` for. */
interface PurchaseBridgeMessage {
  type: 'PURCHASE';
  plan: 'monthly' | 'annual';
  supabaseAccessToken: string;
}

function isPurchaseBridgeMessage(value: unknown): value is PurchaseBridgeMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'PURCHASE' &&
    ((value as { plan?: unknown }).plan === 'monthly' ||
      (value as { plan?: unknown }).plan === 'annual') &&
    typeof (value as { supabaseAccessToken?: unknown }).supabaseAccessToken === 'string'
  );
}

/** Posts a JSON-serializable result back down into the web app's own
 * `window.postMessage` listener so the page can react (e.g. show a success
 * toast or refresh the dashboard) once the native purchase settles. */
function postResultToWebView(webViewRef: React.RefObject<WebView | null>, payload: unknown) {
  const script = `
    (function () {
      window.postMessage(${JSON.stringify(JSON.stringify(payload))}, '*');
    })();
    true;
  `;
  webViewRef.current?.injectJavaScript(script);
}

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [verifyingReceipt, setVerifyingReceipt] = useState(false);
  const pendingPlanRef = useRef<{ plan: 'monthly' | 'annual'; supabaseAccessToken: string } | null>(
    null
  );

  // Establish the native App Store / Play Store billing connection once on
  // mount, and tear it down on unmount. Required by react-native-iap before
  // any purchase can be requested.
  useEffect(() => {
    initConnection().catch((err) => {
      console.error('[FluxFox IAP] Failed to initialize the store connection:', err);
    });

    return () => {
      endConnection();
    };
  }, []);

  const verifyReceiptWithBackend = useCallback(
    async (purchase: Purchase, supabaseAccessToken: string, plan: 'monthly' | 'annual') => {
      setVerifyingReceipt(true);
      try {
        const response = await fetch(`${WEBAPP_URL}/api/apple/verify-receipt`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${supabaseAccessToken}`,
          },
          body: JSON.stringify({
            receiptData: purchase.transactionReceipt,
            productId: purchase.productId,
            plan,
          }),
        });

        const data = (await response.json().catch(() => null)) as { error?: string } | null;

        if (!response.ok) {
          throw new Error(data?.error || 'Apple receipt verification failed.');
        }

        // Only finish (acknowledge) the StoreKit transaction once our own
        // backend has confirmed the receipt is valid and the subscription
        // was activated — never before, so a dropped network request never
        // silently loses the purchase.
        await finishTransaction({ purchase });

        postResultToWebView(webViewRef, { type: 'PURCHASE_RESULT', success: true, plan });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to verify your Apple purchase.';
        postResultToWebView(webViewRef, { type: 'PURCHASE_RESULT', success: false, error: message });
        Alert.alert('Purchase Verification Failed', message);
      } finally {
        setVerifyingReceipt(false);
      }
    },
    []
  );

  // Register the native purchase listeners once. `pendingPlanRef` tracks the
  // most recent plan requested via the WebView bridge so the (plan-agnostic)
  // `purchaseUpdatedListener` callback knows which plan just completed.
  useEffect(() => {
    const updatedSub = purchaseUpdatedListener(async (purchase: Purchase) => {
      const pending = pendingPlanRef.current;
      if (!pending) return;
      pendingPlanRef.current = null;
      await verifyReceiptWithBackend(purchase, pending.supabaseAccessToken, pending.plan);
    });

    const errorSub = purchaseErrorListener((error: PurchaseError) => {
      pendingPlanRef.current = null;
      setVerifyingReceipt(false);
      postResultToWebView(webViewRef, { type: 'PURCHASE_RESULT', success: false, error: error.message });
      Alert.alert('Purchase Failed', error.message);
    });

    return () => {
      updatedSub.remove();
      errorSub.remove();
    };
  }, [verifyReceiptWithBackend]);

  const handleWebViewMessage = useCallback((event: WebViewMessageEvent) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (!isPurchaseBridgeMessage(parsed)) return;

    const sku = APPLE_SUBSCRIPTION_SKUS[parsed.plan];
    pendingPlanRef.current = { plan: parsed.plan, supabaseAccessToken: parsed.supabaseAccessToken };

    requestSubscription({ sku }).catch((err) => {
      pendingPlanRef.current = null;
      const message = err instanceof Error ? err.message : 'Failed to start the Apple purchase flow.';
      postResultToWebView(webViewRef, { type: 'PURCHASE_RESULT', success: false, error: message });
      Alert.alert('Purchase Failed', message);
    });
  }, []);

  void verifyingReceipt; // reserved for a future native loading overlay

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        <WebView
          ref={webViewRef}
          source={{ uri: WEBAPP_URL }}
          style={styles.webview}
          injectedJavaScript={DISABLE_ZOOM_SCRIPT}
          onMessage={handleWebViewMessage}
          applicationNameForUserAgent="FluxFoxMobileApp"
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          allowsBackForwardNavigationGestures
          decelerationRate="normal"
          originWhitelist={['https://*']}
          setSupportMultipleWindows={false}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const ZINC_950 = '#09090b';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: ZINC_950,
  },
  webview: {
    flex: 1,
    backgroundColor: ZINC_950,
  },
});
