import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * `public.users.subscription_status` values that unlock live business
 * functionality. `/api/stripe/webhook` and `/api/apple/verify-receipt` both
 * write `'active'` the moment a paid subscription OR a 7-day free trial is
 * confirmed; `'trialing'` is accepted defensively for future webhook states.
 */
const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'];

/** True when a `subscription_status` value grants access to live business functions. */
export function isSubscriptionActive(status: string | null | undefined): boolean {
  return typeof status === 'string' && ACTIVE_SUBSCRIPTION_STATUSES.includes(status);
}

/**
 * Server-side paywall gate for every route that touches LIVE business
 * infrastructure (Vapi assistant deployment, Twilio number provisioning /
 * forwarding, saving production routing). Returns `null` when the user has an
 * active subscription or free trial, otherwise a ready-to-return HTTP 402
 * response. The interactive Test Demo is deliberately NOT gated by this.
 */
export async function requireActiveSubscription(
  supabase: SupabaseClient,
  userId: string
): Promise<NextResponse<{ error: string; code: 'SUBSCRIPTION_REQUIRED' }> | null> {
  const { data: profile, error } = await supabase
    .from('users')
    .select('subscription_status')
    .eq('id', userId)
    .single();

  if (error) {
    return NextResponse.json(
      {
        error: `Failed to verify your subscription: ${error.message}`,
        code: 'SUBSCRIPTION_REQUIRED' as const,
      },
      { status: 402 }
    );
  }

  if (!isSubscriptionActive(profile?.subscription_status as string | null | undefined)) {
    return NextResponse.json(
      {
        error:
          'An active subscription or 7-day free trial is required to go live. Start your free trial from the Billing section of your dashboard.',
        code: 'SUBSCRIPTION_REQUIRED' as const,
      },
      { status: 402 }
    );
  }

  return null;
}
