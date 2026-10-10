import { NextResponse } from 'next/server';
import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import {
  AppleReceiptError,
  findActiveSubscriptionEntry,
  getAppleProductId,
  verifyAppleReceipt,
  type SubscriptionPlan,
} from '@/lib/apple';

export const dynamic = 'force-dynamic';

/**
 * DAY 14 SCHEMA NOTE — reuses the Day 8 Stripe paywall columns on
 * public.users (see the migration comment in
 * src/app/api/stripe/checkout/route.ts):
 *
 *   subscription_status text default 'inactive'
 *
 * This route additionally persists the Apple-specific identifiers needed to
 * reconcile future renewals/refunds:
 *
 *   alter table public.users
 *     add column if not exists apple_original_transaction_id text,
 *     add column if not exists apple_product_id text;
 *
 *   comment on column public.users.apple_original_transaction_id is
 *     'The App Store original_transaction_id for this user''s active auto-renewable subscription (see /api/apple/verify-receipt).';
 *   comment on column public.users.apple_product_id is
 *     'The App Store Connect product id (SKU) for this user''s active subscription plan (see /api/apple/verify-receipt).';
 */

interface ApiErrorResponse {
  error: string;
}

interface VerifyReceiptSuccessResponse {
  status: 'active';
  plan: SubscriptionPlan;
  expiresAt: string;
}

interface VerifyReceiptRequestBody {
  receiptData?: string;
  productId?: string;
  plan?: string;
}

/** Builds a fresh Supabase Service Role client, bypassing RLS for this
 * server-to-server write (the request originates from the native mobile
 * app, not a browser session with cookies). */
function getSupabaseServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Server misconfiguration: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.');
  }

  return createServiceRoleClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * POST /api/apple/verify-receipt
 *
 * Called by the native FluxFox iOS app (`mobile/App.tsx`) immediately after
 * `react-native-iap`'s `purchaseUpdatedListener` fires. Authenticates the
 * caller via the Supabase access token issued to the signed-in web session
 * (forwarded from the WebView bridge as a bearer token, since the native
 * app has no cookie-based session), validates the Apple receipt against
 * Apple's production servers (falling back to sandbox on status 21007), and
 * — only once Apple confirms a currently-active subscription entry for the
 * configured FluxFox product id — flips that user's
 * `public.users.subscription_status` to `'active'` via the Supabase Service
 * Role key.
 *
 * No mock data, no fallback activation: every failure mode (missing/invalid
 * auth, missing receipt, a receipt Apple rejects, or a receipt with no
 * currently-active FluxFox subscription entry) returns a strict JSON error
 * and never touches `subscription_status`.
 */
export async function POST(
  request: Request
): Promise<NextResponse<VerifyReceiptSuccessResponse | ApiErrorResponse>> {
  const authHeader = request.headers.get('authorization');
  const accessToken = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice('bearer '.length).trim()
    : null;

  if (!accessToken) {
    return NextResponse.json(
      { error: 'Missing or malformed "Authorization: Bearer <supabase_access_token>" header.' },
      { status: 401 }
    );
  }

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to initialize the Supabase Service Role client.' },
      { status: 500 }
    );
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);

  if (authError || !user) {
    return NextResponse.json({ error: 'No valid Supabase session was found for the provided access token.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as VerifyReceiptRequestBody | null;
  const receiptData = body?.receiptData;
  const plan: SubscriptionPlan = body?.plan === 'annual' ? 'annual' : 'monthly';

  if (!receiptData || typeof receiptData !== 'string') {
    return NextResponse.json({ error: 'A base64 "receiptData" field is required.' }, { status: 400 });
  }

  let appleResponse;
  try {
    appleResponse = await verifyAppleReceipt(receiptData);
  } catch (err) {
    if (err instanceof AppleReceiptError) {
      return NextResponse.json({ error: err.message }, { status: err.status ? 400 : 500 });
    }
    return NextResponse.json({ error: 'Failed to verify the receipt with Apple.' }, { status: 500 });
  }

  const activeEntry = findActiveSubscriptionEntry(appleResponse);

  if (!activeEntry) {
    return NextResponse.json(
      { error: 'Apple verified the receipt, but it contains no currently-active FluxFox subscription.' },
      { status: 400 }
    );
  }

  // Resolve the real plan from Apple's own product_id (never trust the
  // client-sent `plan` beyond using it as a fallback label) so the dashboard
  // and Supabase always reflect what Apple actually billed the customer for.
  let resolvedPlan: SubscriptionPlan = plan;
  try {
    if (activeEntry.product_id === getAppleProductId('annual')) {
      resolvedPlan = 'annual';
    } else if (activeEntry.product_id === getAppleProductId('monthly')) {
      resolvedPlan = 'monthly';
    } else {
      return NextResponse.json(
        { error: `Verified receipt product id "${activeEntry.product_id}" does not match a known FluxFox subscription plan.` },
        { status: 400 }
      );
    }
  } catch (err) {
    if (err instanceof AppleReceiptError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Failed to resolve the configured Apple product ids.' }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({
      subscription_status: 'active',
      apple_original_transaction_id: activeEntry.original_transaction_id,
      apple_product_id: activeEntry.product_id,
    })
    .eq('id', user.id);

  if (updateError) {
    return NextResponse.json(
      { error: `Failed to update public.users for ${user.id}: ${updateError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      status: 'active',
      plan: resolvedPlan,
      expiresAt: new Date(Number(activeEntry.expires_date_ms)).toISOString(),
    },
    { status: 200 }
  );
}
