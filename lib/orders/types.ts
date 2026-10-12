// Order automation types: Stripe Checkout -> webhook -> Printful / Yoycol + email John.

/**
 * Who makes an item.
 * - printful: the generated line-up, ordered by Printful sync variant id.
 * - yoycol: the all-over clouds tee/shorts, ordered by Yoycol designCode + skuCode.
 * - manual: an older Printful product with no sync variant mapping (made from a
 *   product template); John places it by hand from the email.
 */
export type Supplier = "printful" | "yoycol" | "manual";

export type OrderItem = {
  /** Site product id / slug. */
  slug: string;
  title: string;
  supplier: Supplier;
  qty: number;
  /** version / style / emblem / color / size, whichever the product has. */
  opts: Record<string, string>;
  /** Cents charged per unit (the whole price for free-shipping items). */
  unitAmount: number;
  printful?: { syncVariantId: number };
  yoycol?: { designCode: string; skuCode: string };
  /** For manual items: what John needs to place it. */
  manual?: string;
};

export type Address = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

export type Customer = {
  name: string;
  email: string;
  phone: string;
  address: Address;
};

export type OrderRecord = {
  session_id: string;
  /** Our order id: "mop-" + 28 hex of sha256(session id). Printful external_id / Yoycol storeOrderSn. */
  order_ref: string;
  created: string;
  livemode: boolean;
  payment_status: string;
  payment_intent: string | null;
  currency: string;
  /** Cents. */
  amount_total: number;
  amount_subtotal: number;
  amount_shipping: number;
  amount_discount: number;
  amount_tax: number;
  customer: Customer;
  items: OrderItem[];
  /** Where the items came from: our session metadata, or (sessions made before this code) Stripe line items. */
  items_source: "metadata" | "line_items" | "none";
};

export type SupplierResult = {
  supplier: Supplier;
  ok: boolean;
  dryRun?: boolean;
  /** Supplier's order id (Printful numeric id, Yoycol orderId). */
  id?: string;
  /** Human order number (Yoycol orderNo). */
  number?: string;
  status?: string;
  /** Link for John. */
  url?: string;
  /** What John has to do next. */
  action?: string;
  /** What the supplier will charge, if it said. */
  cost?: string;
  /** Printful: the order already existed (a retry). */
  existing?: boolean;
  error?: string;
  at: string;
};

export type RoyaltyRow = {
  at: string;
  session_id: string;
  order_ref: string;
  artist: string;
  per_item: number;
  qty: number;
  amount: number;
  product: string;
  slug: string;
  options: Record<string, string>;
  livemode: boolean;
};
