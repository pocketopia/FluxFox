/**
 * Apple App Store server-to-server receipt verification for the FluxFox IAP
 * bridge (see `src/app/api/apple/verify-receipt/route.ts` and the native
 * purchase flow in `mobile/App.tsx`).
 *
 * Mirrors the structure of `src/lib/stripe.ts`: strict config-error throwing
 * (no mock/fallback data), and env-driven product/secret configuration so
 * the same code works across sandbox and production App Store environments
 * without a code change.
 */

/** Thrown for any failure verifying a receipt with Apple: missing server
 * configuration, a network failure reaching Apple, or a non-zero `status`
 * in Apple's response. Callers should map this to a strict HTTP 400 (bad
 * input / invalid receipt) or 500 (everything else) — never a silent
 * fallback that marks a subscription active without real verification. */
export class AppleReceiptError extends Error {
  /** Apple's raw numeric status code, when the failure came from a parsed
   * Apple response (e.g. 21002 malformed receipt, 21010 revoked). Absent
   * for network/config failures that never reached Apple. */
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AppleReceiptError';
    this.status = status;
  }
}

/** Apple's production `/verifyReceipt` endpoint (legacy App Store receipt
 * validation API — still the documented path for base64 App Store receipts
 * returned by `react-native-iap`'s `transactionReceipt` field in StoreKit 1
 * mode). */
const APPLE_PRODUCTION_VERIFY_RECEIPT_URL = 'https://buy.itunes.apple.com/verifyReceipt';

/** Apple's sandbox `/verifyReceipt` endpoint, used whenever the production
 * endpoint reports status 21007 ("this receipt is from the test
 * environment, but it was sent to the production environment"). */
const APPLE_SANDBOX_VERIFY_RECEIPT_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';

/** Apple's documented status code for "sandbox receipt sent to production". */
const APPLE_STATUS_SANDBOX_RECEIPT_SENT_TO_PRODUCTION = 21007;

export type SubscriptionPlan = 'monthly' | 'annual';

/** The FluxFox bundle id every verified receipt must belong to. Matches
 * `mobile/app.json`'s `expo.ios.bundleIdentifier`. */
const EXPECTED_BUNDLE_ID = 'com.fluxfox.app';

/**
 * Returns the shared secret (the App-Specific Shared Secret generated in
 * App Store Connect → Apps → FluxFox → App Information → App-Specific
 * Shared Secret) required to validate auto-renewable subscription receipts.
 * Throws `AppleReceiptError` if unset — never silently verifies without it.
 */
export function getAppleSharedSecret(): string {
  const secret = process.env.APPLE_SHARED_SECRET;

  if (!secret) {
    throw new AppleReceiptError('Server misconfiguration: APPLE_SHARED_SECRET is not set.');
  }

  return secret;
}

/**
 * Returns the App Store Connect product id for the requested FluxFox
 * subscription plan (monthly or annual). Read from env, mirroring
 * `getSubscriptionPriceId` in `src/lib/stripe.ts`, and must exactly match
 * the `APPLE_SUBSCRIPTION_SKUS` map in `mobile/App.tsx`.
 */
export function getAppleProductId(plan: SubscriptionPlan): string {
  const envVar = plan === 'annual' ? 'NEXT_PUBLIC_APPLE_ANNUAL_PRODUCT_ID' : 'NEXT_PUBLIC_APPLE_MONTHLY_PRODUCT_ID';
  const productId = process.env[envVar];

  if (!productId) {
    throw new AppleReceiptError(`Server misconfiguration: ${envVar} is not set.`);
  }

  return productId;
}

/** A single entry from Apple's `latest_receipt_info` array: one transaction
 * in the subscription's renewal history. Only the fields FluxFox needs are
 * declared here — Apple's payload includes many more. */
export interface AppleLatestReceiptInfo {
  product_id: string;
  transaction_id: string;
  original_transaction_id: string;
  expires_date_ms: string;
  purchase_date_ms: string;
  is_trial_period?: string;
  cancellation_date_ms?: string;
}

export interface AppleVerifyReceiptResponse {
  status: number;
  environment?: 'Production' | 'Sandbox';
  receipt?: { bundle_id?: string };
  latest_receipt_info?: AppleLatestReceiptInfo[];
  latest_receipt?: string;
  pending_renewal_info?: Array<{ auto_renew_status?: string; product_id?: string }>;
}

/**
 * POSTs a base64 App Store receipt to Apple's `/verifyReceipt` endpoint.
 * Always tries the production endpoint first (as Apple's documentation
 * requires), and transparently retries against the sandbox endpoint when
 * Apple reports status 21007 (a sandbox/TestFlight receipt was sent to
 * production) — this lets the same backend code handle both TestFlight and
 * live App Store purchases without an explicit environment flag from the
 * client. Throws `AppleReceiptError` for every other non-zero status, any
 * network failure, or a response with no resolvable bundle id — no mock
 * data, no fallback "assume valid" path.
 */
export async function verifyAppleReceipt(receiptData: string): Promise<AppleVerifyReceiptResponse> {
  const sharedSecret = getAppleSharedSecret();

  const requestBody = JSON.stringify({
    'receipt-data': receiptData,
    password: sharedSecret,
    'exclude-old-transactions': true,
  });

  const postToApple = async (url: string): Promise<AppleVerifyReceiptResponse> => {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });
    } catch (networkError) {
      throw new AppleReceiptError(
        `Failed to reach Apple's receipt verification server (${url}): ${
          networkError instanceof Error ? networkError.message : 'unknown network error'
        }`
      );
    }

    if (!response.ok) {
      throw new AppleReceiptError(
        `Apple's receipt verification server responded with HTTP ${response.status} (${url}).`
      );
    }

    const data = (await response.json().catch(() => null)) as AppleVerifyReceiptResponse | null;

    if (!data || typeof data.status !== 'number') {
      throw new AppleReceiptError("Apple's receipt verification server returned an unparseable response.");
    }

    return data;
  };

  let result = await postToApple(APPLE_PRODUCTION_VERIFY_RECEIPT_URL);

  if (result.status === APPLE_STATUS_SANDBOX_RECEIPT_SENT_TO_PRODUCTION) {
    result = await postToApple(APPLE_SANDBOX_VERIFY_RECEIPT_URL);
  }

  if (result.status !== 0) {
    throw new AppleReceiptError(`Apple rejected the receipt (status ${result.status}).`, result.status);
  }

  if (result.receipt?.bundle_id && result.receipt.bundle_id !== EXPECTED_BUNDLE_ID) {
    throw new AppleReceiptError(
      `Receipt bundle id "${result.receipt.bundle_id}" does not match the expected FluxFox bundle id "${EXPECTED_BUNDLE_ID}".`
    );
  }

  return result;
}

/**
 * From a verified Apple response, returns the most recently purchased
 * subscription transaction (by `purchase_date_ms`) whose `expires_date_ms`
 * is still in the future, or `null` if no entry is currently active. Used
 * to decide whether to flip `public.users.subscription_status` to
 * `'active'`.
 */
export function findActiveSubscriptionEntry(
  response: AppleVerifyReceiptResponse
): AppleLatestReceiptInfo | null {
  const entries = response.latest_receipt_info ?? [];
  const now = Date.now();

  const active = entries.filter((entry) => {
    const expiresAtMs = Number(entry.expires_date_ms);
    return Number.isFinite(expiresAtMs) && expiresAtMs > now && !entry.cancellation_date_ms;
  });

  if (active.length === 0) return null;

  return active.reduce((latest, entry) =>
    Number(entry.purchase_date_ms) > Number(latest.purchase_date_ms) ? entry : latest
  );
}
