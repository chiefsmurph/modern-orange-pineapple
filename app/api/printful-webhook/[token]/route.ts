// Printful webhook: https://mopclothing.com/api/printful-webhook/<PRINTFUL_WEBHOOK_TOKEN>
// Event: package_shipped (everything else is acknowledged and ignored).
// A wrong token gets a 404. The payload is never trusted: the order is re-fetched
// from Printful and the customer gets a "your order has shipped" email through
// Resend, once per package (lib/orders/printful-shipped.ts). Nothing here touches
// checkout or the Stripe webhook; a missing MOP_RESEND_API_KEY just skips the email.
import { NextRequest, NextResponse } from "next/server";
import { handlePrintfulWebhook } from "@/lib/orders/printful-shipped";
import { shipmentLedger } from "@/lib/orders/shipments";
import { dataDir } from "@/lib/orders/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.text();
  try {
    const dir = dataDir();
    const result = await handlePrintfulWebhook(token, body, {
      env: process.env,
      fetch: (url, init) => fetch(url, init),
      now: () => new Date(),
      log: (msg) => console.log(msg),
      dir,
      ledger: shipmentLedger(dir),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    // e.g. the data dir can't be read: Printful retries later.
    console.error(`[shipping] Printful webhook failed: ${(err as Error).stack ?? err}`);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
