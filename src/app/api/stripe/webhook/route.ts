import { NextResponse } from 'next/server';
import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { getStripeClient, getWebhookSecret, StripeConfigError } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * DAY 8 SCHEMA REQUIREMENT — public.users must already have both:
 *   stripe_customer_id text
 *   subscription_status text default 'inactive'
 * (see the migration comment in /api/stripe/checkout/route.ts)
 *
 * This route reads/writes both columns via the Supabase Service Role key,
 * which bypasses Row Level Security since the request originates from
 * Stripe's servers and carries no end-user session/cookies.
 */

interface ApiErrorResponse {
  error: string;
}

/** Builds a fresh Supabase Service Role client, bypassing RLS for server-to-server writes. */
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
 * Extracts the customer's billing email from a completed Checkout Session,
 * preferring the Stripe Customer object's email (most reliable, since it
 * reflects whatever the customer entered/confirmed at checkout) and
 * falling back to the session's own `customer_email`/`customer_details`
 * fields. Returns null if no email can be resolved from real Stripe data.
 */
function extractCustomerEmail(
  session: Stripe.Checkout.Session,
  customer: Stripe.Customer | Stripe.DeletedCustomer | null
): string | null {
  if (customer && customer.deleted !== true && 'email' in customer && typeof customer.email === 'string' && customer.email) {
    return customer.email;
  }
  if (session.customer_details?.email) return session.customer_details.email;
  if (session.customer_email) return session.customer_email;
  return null;
}

/**
 * POST /api/stripe/webhook
 *
 * Verifies the inbound Stripe webhook signature against the raw request
 * body using `STRIPE_WEBHOOK_SECRET`. On a verified `checkout.session.completed`
 * event, resolves the paying customer's email, uses the Supabase Service
 * Role key to bypass RLS, and marks that `public.users` row
 * `subscription_status = 'active'` while persisting `stripe_customer_id`.
 *
 * No mock data, no fallback activation: an invalid/missing signature is a
 * strict HTTP 400, and any downstream failure (Stripe client init, DB
 * lookup, DB update) is a strict HTTP 500 — the event is never silently
 * treated as processed.
 */
export async function POST(request: Request): Promise<NextResponse<{ received: true } | ApiErrorResponse>> {
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing the "stripe-signature" header.' }, { status: 400 });
  }

  const rawBody = await request.text();

  let stripe;
  let webhookSecret: string;
  try {
    stripe = getStripeClient();
    webhookSecret = getWebhookSecret();
  } catch (err) {
    if (err instanceof StripeConfigError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Failed to initialize the Stripe client.' }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    return NextResponse.json(
      {
        error: `Stripe webhook signature verification failed: ${
          err instanceof Error ? err.message : 'unknown verification error'
        }`,
      },
      { status: 400 }
    );
  }

  if (event.type !== 'checkout.session.completed') {
    // Acknowledge every other event type without side effects so Stripe
    // does not retry it as a delivery failure.
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  let customer: Stripe.Customer | Stripe.DeletedCustomer | null = null;
  if (typeof session.customer === 'string') {
    try {
      customer = await stripe.customers.retrieve(session.customer);
    } catch (err) {
      return NextResponse.json(
        {
          error: `Failed to retrieve the Stripe customer ${session.customer}: ${
            err instanceof Error ? err.message : 'unknown Stripe error'
          }`,
        },
        { status: 500 }
      );
    }
  } else if (session.customer && typeof session.customer === 'object') {
    customer = session.customer as Stripe.Customer;
  }

  const customerEmail = extractCustomerEmail(session, customer);
  const stripeCustomerId = typeof session.customer === 'string' ? session.customer : customer?.id ?? null;

  if (!customerEmail) {
    return NextResponse.json(
      { error: 'checkout.session.completed did not include a resolvable customer email.' },
      { status: 400 }
    );
  }

  if (!stripeCustomerId) {
    return NextResponse.json(
      { error: 'checkout.session.completed did not include a Stripe customer id.' },
      { status: 400 }
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

  const { data: updatedRows, error: updateError } = await supabase
    .from('users')
    .update({
      subscription_status: 'active',
      stripe_customer_id: stripeCustomerId,
    })
    .eq('email', customerEmail)
    .select('id');

  if (updateError) {
    return NextResponse.json(
      { error: `Failed to update public.users for ${customerEmail}: ${updateError.message}` },
      { status: 500 }
    );
  }

  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json(
      { error: `No FluxFox user was found with email "${customerEmail}".` },
      { status: 404 }
    );
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
