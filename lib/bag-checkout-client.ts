// The browser side of the bag checkout: POST the bag's ids + quantities, go to
// Stripe. Items the server says are no longer sold are dropped from the bag.
import { bagCount, removeLine, writeBag, type BagLine, lineView } from "./bag.ts";
import { track } from "./umami.ts";

export async function startBagCheckout(lines: BagLine[]): Promise<{ error?: string }> {
  const value = lines.reduce((n, l) => n + (lineView(l)?.unitPrice ?? 0) * l.qty, 0);
  // Never awaited and a no-op when Umami is blocked: checkout never waits on analytics.
  track("bag-checkout", { lines: lines.length, items: bagCount(lines), value });
  try {
    const r = await fetch("/api/bag-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines: lines.map(({ id, qty }) => ({ id, qty })) }),
    });
    const data = (await r.json().catch(() => ({}))) as { url?: string; error?: string; unavailable?: string[] };
    if (r.ok && data.url) {
      window.location.href = data.url;
      return {};
    }
    if (r.status === 409 && data.unavailable?.length) {
      let left = lines;
      for (const id of data.unavailable) left = removeLine(left, id);
      writeBag(left);
      const names = lines.filter((l) => data.unavailable!.includes(l.id)).map((l) => lineView(l)?.title ?? l.t ?? "An item");
      return { error: `Removed from your bag (no longer available): ${names.join(", ")}. Check your bag and try again.` };
    }
    return { error: data.error ?? "Sorry, checkout didn't open. Please try again." };
  } catch {
    return { error: "Sorry, checkout didn't open. Please check your connection and try again." };
  }
}
