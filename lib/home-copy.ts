// The words at the top of the home page (John, 10/16), under the logo.
//
// The benefits row says only what's true of every product on sale
// (test/home-top.test.ts checks it against the products and the checkout):
//   Free US shipping   every card is free shipping, and checkout ships to the US only
//   Original art, made to order   Printful and Yoycol print each order when it's placed
// "Real cotton" isn't in the row: the skater dress (78% polyester) and the
// snapback (acrylic / wool) aren't cotton. The cotton line is the hero's, and
// the cards still flag anything that isn't cotton.

/** One sentence under the logo. */
export const HERO_LINE = "Real skies and original characters, on cotton.";

/** The benefits row, shown as one line: "Tees from $35 · Free US shipping · Original art, made to order".
 *  "Tees from $35" = the cheapest tee on sale (test/home-top.test.ts checks it against the catalog; John 10/17;
 *  $35 since the 10/20 prices, was $29). The Founding 50 line sits under it (lib/founding50.ts). */
export const BENEFITS = ["Tees from $35", "Free US shipping", "Original art, made to order"] as const;

/** The benefit that stands out in the row: white on an orange pill (John 10/19). */
export const BENEFIT_HIGHLIGHT: (typeof BENEFITS)[number] = "Free US shipping";
