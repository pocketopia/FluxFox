import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getStripeClient, getSubscriptionPriceId, StripeConfigError, type SubscriptionPlan } from '@/lib/stripe';

/** Every FluxFox subscription (monthly or annual) includes a 7-day free trial. */
const TRIAL_PERIOD_DAYS = 7;

export const dynamic = 'force-dynamic';

/**
 * DAY 8 SCHEMA MIGRATION — run against Supabase (PostgreSQL 15+):
 *
 *   alter table public.users
 *     add column if not exists stripe_customer_id text,
 *     add column if not exists subscription_status text default 'inactive';
 *
 *   comment on column public.users.stripe_customer_id is
 *     'The Stripe Customer id created for this user (see /api/stripe/checkout and /api/stripe/webhook).';
 *   comment on column public.users.subscription_status is
 *     'The FluxFox subscription state for this user: ''inactive'' | ''active'' (set to ''active'' only by /api/stripe/webhook on checkout.session.completed).';
 */

interface ApiErrorResponse {
  error: string;
}

interface CheckoutSuccessResponse {
  url: string;
}

/**
 * POST /api/stripe/checkout
 *
 * Validates the current Supabase session, then creates a live Stripe
 * Checkout Session in `subscription` mode for the FluxFox $99/mo plan and
 * returns its hosted checkout URL. No mock data, no fallback URL: any
 * failure mode returns a strict JSON error with an appropriate status
 * (401 for auth, 500 for Stripe/config failures).
 */
export async function POST(request: Request): Promise<NextResponse<CheckoutSuccessResponse | ApiErrorResponse>> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user || !user.email) {
    return NextResponse.json({ error: 'No authenticated Supabase session was found.' }, { status: 401 });
  }

  const origin = new URL(request.url).origin;

  let requestedPlan: SubscriptionPlan = 'monthly';
  try {
    const body = (await request.json().catch(() => null)) as { plan?: string } | null;
    if (body?.plan === 'annual') requestedPlan = 'annual';
  } catch {
    requestedPlan = 'monthly';
  }

  let stripe;
  let priceId: string;
  try {
    stripe = getStripeClient();
    priceId = getSubscriptionPriceId(requestedPlan);
  } catch (err) {
    if (err instanceof StripeConfigError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Failed to initialize the Stripe client.' }, { status: 500 });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: user.email,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: TRIAL_PERIOD_DAYS,
      },
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/dashboard?checkout=cancelled`,
      metadata: {
        supabase_user_id: user.id,
        plan: requestedPlan,
      },
    });

    if (!session.url) {
      return NextResponse.json(
        { error: 'Stripe created the Checkout Session but returned no redirect URL.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to create the Stripe Checkout Session: ${
          err instanceof Error ? err.message : 'unknown Stripe error'
        }`,
      },
      { status: 500 }
    );
  }
}
