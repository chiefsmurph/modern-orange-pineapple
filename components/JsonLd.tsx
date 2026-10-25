import { jsonLdScript } from "@/lib/structured-data";

// A schema.org JSON-LD block (lib/structured-data.ts), rendered on the server.
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }} />;
}
