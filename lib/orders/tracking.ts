// Tracking links for the "your order has shipped" email.
//
// Printful sends its own tracking_url, which is used when it's https. Yoycol
// gives only numbers (lib/orders/yoycol-tracking.ts), so the link is built here:
// a number whose pattern names its carrier (UPS 1Z…, YunExpress YT…, USPS 92–95…
// / 420<zip>… / ..US) gets that carrier's page; a carrier name (Printful's
// "USPS", Yoycol's carrier/lpName) decides the ambiguous ones (12- or 15-digit
// FedEx, 10-digit DHL); anything else goes to 17track, which detects the carrier
// itself.

export type CarrierId = "usps" | "ups" | "fedex" | "dhl" | "yunexpress";

export const carrierNames: Record<CarrierId, string> = {
  usps: "USPS",
  ups: "UPS",
  fedex: "FedEx",
  dhl: "DHL",
  yunexpress: "YunExpress",
};

const carrierUrls: Record<CarrierId, (n: string) => string> = {
  usps: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`,
  ups: (n) => `https://www.ups.com/track?tracknum=${n}`,
  fedex: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
  dhl: (n) => `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${n}&submit=1`,
  yunexpress: (n) => `https://www.yuntrack.com/parcelTracking?id=${n}`,
};

export const seventeenTrackUrl = (n: string) => `https://t.17track.net/en#nums=${encodeURIComponent(n)}`;

/** "9400 1118 9922 …" -> "940011189922…"; anything that isn't a plausible tracking number -> "". */
export const cleanTrackingNumber = (raw: unknown) => {
  if (typeof raw !== "string" && typeof raw !== "number") return "";
  const s = String(raw).replace(/[\s-]+/g, "").toUpperCase();
  return /^[A-Z0-9]{6,40}$/.test(s) && !/^0+$/.test(s) ? s : "";
};

/** The carrier a free-text name or code means: "USPS", "usps_ground_advantage", "FEDEX", "Yun Express", "DHL eCommerce". */
export function carrierFromName(name: unknown): CarrierId | undefined {
  if (typeof name !== "string") return undefined;
  const s = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  if (/ usps |postal service|united states post/.test(s)) return "usps";
  if (/ ups /.test(s)) return "ups";
  if (/fedex|federal express/.test(s)) return "fedex";
  if (/ dhl/.test(s)) return "dhl";
  if (/yun ?express|yuntu|yuntrack/.test(s)) return "yunexpress";
  return undefined;
}

/** A carrier only when the number's pattern can't be anyone else's. */
export function carrierFromNumber(number: string): CarrierId | undefined {
  const n = cleanTrackingNumber(number);
  if (!n) return undefined;
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return "ups";
  if (/^YT\d{16}$/.test(n)) return "yunexpress";
  if (/^9[2-5]\d{18,24}$/.test(n)) return "usps"; // IMpb: 20–26 digits starting 92–95
  if (/^420\d{5}(\d{4})?9[2-5]\d{18,24}$/.test(n)) return "usps"; // 420 + ZIP(+4) + IMpb
  if (/^[A-Z]{2}\d{9}US$/.test(n)) return "usps"; // UPU S10 posted in the US
  if (/^96\d{20}$/.test(n)) return "fedex"; // FedEx Ground 96…
  return undefined;
}

/** Numbers that only fit a carrier the name already names (a 12-digit number could be anyone's). */
const fitsNamedCarrier = (carrier: CarrierId, n: string) => {
  switch (carrier) {
    case "fedex":
      return /^(\d{12}|\d{15}|\d{20}|\d{22})$/.test(n);
    case "dhl":
      return /^(\d{10,11}|GM\d{16,24}|JJD\d{16,22}|[A-Z]{2}\d{9}[A-Z]{2}|\d{20,22})$/.test(n);
    case "usps":
      return /^(\d{20,26}|[A-Z]{2}\d{9}US)$/.test(n);
    case "ups":
      return /^(1Z[0-9A-Z]{16}|\d{9,12}|T\d{10})$/.test(n);
    case "yunexpress":
      return /^YT\d{16}$/.test(n);
  }
};

export type Tracking = {
  number: string;
  carrierId?: CarrierId;
  /** What the email shows: "USPS", or the supplier's own name for a carrier we don't know. */
  carrier?: string;
  service?: string;
  url: string;
};

const latinLabel = (s: unknown) =>
  typeof s === "string" && /^[\x20-\x7e]{2,40}$/.test(s.trim()) && /[a-z]/i.test(s) ? s.trim() : undefined;

/** "FEDEX" -> "FedEx"; "SOME CARRIER" -> "Some Carrier"; non-Latin or code-like names -> undefined. */
export const carrierLabel = (name: unknown): string | undefined => {
  const known = carrierFromName(name);
  if (known) return carrierNames[known];
  const s = latinLabel(name);
  if (!s) return undefined;
  return s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s;
};

/**
 * The link and labels for one package. `url`: the supplier's own tracking URL
 * (kept only when it's https). `carrier`: the supplier's carrier name or code.
 */
export function buildTracking(input: {
  number: unknown;
  carrier?: unknown;
  service?: unknown;
  url?: unknown;
}): Tracking | null {
  const number = cleanTrackingNumber(input.number);
  if (!number) return null;
  const byNumber = carrierFromNumber(number);
  const byName = carrierFromName(input.carrier);
  // The link: the supplier's own, else the carrier the number's pattern names,
  // else the named carrier if the number fits it, else 17track.
  const linkCarrier = byNumber ?? (byName && fitsNamedCarrier(byName, number) ? byName : undefined);
  const given = typeof input.url === "string" && /^https:\/\/[^\s"'<>]+$/i.test(input.url.trim()) ? input.url.trim() : undefined;
  const url = given ?? (linkCarrier ? carrierUrls[linkCarrier](number) : seventeenTrackUrl(number));
  // The label: who the supplier says carries it (a DHL eCommerce number can look
  // like a USPS one, since USPS delivers it), else what the number says.
  const carrierId = byName ?? byNumber;
  const carrier = carrierId ? carrierNames[carrierId] : carrierLabel(input.carrier);
  // "USPS · USPS Ground Advantage" reads twice: drop the carrier from the service.
  let service = latinLabel(input.service);
  if (service && carrier) {
    const lead = carrier.toLowerCase();
    const s = service.toLowerCase();
    if (s === lead) service = undefined;
    else if (s.startsWith(`${lead} `)) service = service.slice(lead.length + 1).trim() || undefined;
  }
  return { number, carrierId, carrier, service, url };
}

/** "9400111899223817364905" -> "9400 1118 9922 3817 3649 05" for reading (the link carries the real one). */
export const groupTrackingNumber = (n: string) => (/^\d{16,}$/.test(n) ? n.replace(/(\d{4})(?=\d)/g, "$1 ") : n);
