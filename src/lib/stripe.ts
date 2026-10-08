import Stripe from 'stripe';

/**
 * Pinned to the exact API version shipped with the installed `stripe`
 * package (see node_modules/stripe/esm/apiVersion.js) so the SDK's
 * TypeScript types always match the live API surface Stripe returns.
 */
const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-08-26.dahlia';

/**
 * Thrown for any failure while interacting with the Stripe API: missing
 * server configuration, invalid input, a network failure reaching Stripe,
 * or a non-2xx response from the Stripe REST API. Callers should map this
 * to a strict HTTP 400 (bad input) or 500 (everything else) — never a
 * silent fallback.
 */
export class StripeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeConfigError';
  }
}

let cachedClient: Stripe | null = null;

/**
 * Lazily initializes and caches a single server-side Stripe client using
 * `STRIPE_SECRET_KEY`. Never falls back to a hardcoded/test key: a missing
 * env var throws `StripeConfigError` so the caller can return a strict
 * HTTP 500 rather than silently degrading into a broken checkout flow.
 */
export function getStripeClient(): Stripe {
  if (cachedClient) return cachedClient;

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new StripeConfigError('Server misconfiguration: STRIPE_SECRET_KEY is not set.');
  }

  cachedClient = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
  });

  return cachedClient;
}

/**
 * Returns the live Stripe Price id for the FluxFox $99/mo subscription
 * plan. Read from env rather than hardcoded so the same code works across
 * Stripe test mode and live mode without a code change. Throws
 * `StripeConfigError` if unset — never falls back to a fabricated price id.
 */
export function getSubscriptionPriceId(): string {
  const priceId = process.env.STRIPE_SUBSCRIPTION_PRICE_ID;

  if (!priceId) {
    throw new StripeConfigError('Server misconfiguration: STRIPE_SUBSCRIPTION_PRICE_ID is not set.');
  }

  return priceId;
}

/**
 * Returns the signing secret used to verify inbound Stripe webhook
 * payloads (`whsec_...`). Throws `StripeConfigError` if unset so the
 * webhook route never processes an unverified event.
 */
export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    throw new StripeConfigError('Server misconfiguration: STRIPE_WEBHOOK_SECRET is not set.');
  }

  return secret;
}
