// POST /api/bag-checkout: the shopping bag (/bag) -> one Stripe Checkout session.
// The bag sends only variant ids (the same ids as the feeds and /meta-checkout)
// and quantities; prices, options and suppliers come from the catalog here, by
// the same code as /meta-checkout and the product page's checkout.
import type Stripe from "stripe";
import { cartSessionParams, SITE_ORIGIN } from "./checkout.ts";
import { MAX_LINES, MAX_QTY, resolveMetaCart, type Skipped } from "./meta-checkout.ts";

export type BagCheckoutResult =
  | { status: 200; body: { url: string } ; log: string; value: number; lines: number; items: number }
  | { status: 400 | 409; body: { error: string; unavailable?: string[] }; log: string };

/** The request body -> bag lines, or why it's unusable. */
export function parseBagBody(body: unknown): { lines: { id: string; qty: number }[] } | { error: string } {
  const raw = (body as { lines?: unknown })?.lines;
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Your bag is empty." };
  if (raw.length > MAX_LINES) return { error: `A bag holds up to ${MAX_LINES} different items.` };
  const qtys = new Map<string, number>();
  for (const l of raw) {
    const id = typeof l?.id === "string" ? l.id.trim().toLowerCase() : "";
    const qty = l?.qty;
    if (!/^[a-z0-9-]{1,64}$/.test(id) || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY)
      return { error: "Something in your bag isn't right. Please refresh the page." };
    qtys.set(id, Math.min(MAX_QTY, (qtys.get(id) ?? 0) + qty));
  }
  return { lines: Array.from(qtys, ([id, qty]) => ({ id, qty })) };
}

export async function bagCheckout(
  body: unknown,
  {
    stripe,
    env = process.env,
    origin = SITE_ORIGIN,
  }: {
    stripe: () => { checkout: { sessions: { create(p: Stripe.Checkout.SessionCreateParams): Promise<{ id: string; url: string | null }> } } };
    env?: Record<string, string | undefined>;
    origin?: string;
  }
): Promise<BagCheckoutResult> {
  const parsed = parseBagBody(body);
  if ("error" in parsed) return { status: 400, body: { error: parsed.error }, log: `bad request: ${parsed.error}` };
  const { priced, skipped } = resolveMetaCart(parsed.lines, env);
  // Anything the catalog no longer sells: say so and let the customer decide (the bag drops them).
  if (skipped.length) {
    const ids = skipped.map((s: Skipped) => s.id);
    return {
      status: 409,
      body: { error: "Some items in your bag are no longer available.", unavailable: ids },
      log: `unavailable: ${skipped.map((s) => `${s.id} (${s.reason})`).join(", ")}`,
    };
  }
  const params = cartSessionParams(priced, {
    origin,
    metadata: { mop_source: JSON.stringify({ via: "bag" }) },
    successPath: "/bag?status=success",
    cancelPath: "/bag",
  });
  const session = await stripe().checkout.sessions.create(params);
  if (!session.url) throw new Error(`session ${session.id} has no url`);
  const items = priced.reduce((n, p) => n + p.item.qty, 0);
  const valueCents = priced.reduce((n, p) => n + p.item.unitAmount * p.item.qty, 0);
  return {
    status: 200,
    body: { url: session.url },
    log: `${priced.map((p) => `${p.item.qty} x ${p.item.slug} (${Object.values(p.item.opts).join(" / ")})`).join("; ")} $${(valueCents / 100).toFixed(2)}`,
    value: valueCents / 100,
    lines: priced.length,
    items,
  };
}
