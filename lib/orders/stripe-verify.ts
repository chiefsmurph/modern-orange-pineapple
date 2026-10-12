// Stripe webhook signature check: the raw request body, the `stripe-signature`
// header and the endpoint's signing secret (STRIPE_WEBHOOK_SECRET, "whsec_…").
// Uses Stripe's own verifier (HMAC-SHA256 over "<timestamp>.<body>", timing-safe,
// rejects timestamps older than 5 minutes). Needs no API key.
import Stripe from "stripe";

export type VerifiedEvent = { id: string; type: string; data: { object: unknown } };

export function verifyStripeEvent(
  rawBody: string,
  signature: string | null | undefined,
  secret: string | undefined
): VerifiedEvent {
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  if (!signature) throw new Error("missing stripe-signature header");
  return Stripe.webhooks.constructEvent(rawBody, signature, secret) as unknown as VerifiedEvent;
}
