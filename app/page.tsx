// The home page. The page itself is the client component in ./HomePage.tsx; this
// server part only reads the Founding 50 count from Stripe (lib/founding50.ts) so
// the line is in the HTML from the first paint. The page stays static for
// everyone and is rebuilt at most every 5 minutes (Next revalidate), so the
// count is at most ~5 minutes old and Stripe sees one read per rebuild.
import HomePage from "./HomePage";
import JsonLd from "@/components/JsonLd";
import { homeJsonLd } from "@/lib/structured-data";
import { FOUNDING50_REVALIDATE, founding50Line, lookupFounding50 } from "@/lib/founding50";

// Next wants a literal here: keep it equal to FOUNDING50_REVALIDATE (test/founding50.test.ts checks).
export const revalidate = 300;

export default async function Page() {
  const lookup = await lookupFounding50({ init: { next: { revalidate: FOUNDING50_REVALIDATE } } });
  if (lookup.kind === "unreachable") console.warn(`[founding50] Stripe lookup failed (${lookup.why}); the line shows without the count`);
  return (
    <>
      {/* who MOP is, for search engines and AI answers (lib/structured-data.ts) */}
      <JsonLd data={homeJsonLd()} />
      <HomePage founding50={founding50Line(lookup)} />
    </>
  );
}
