// The words at the top of the home page (John, 10/16), under the title.
//
// The benefits row says only what's true of every product on sale
// (test/home-top.test.ts checks it against the products and the checkout):
//   Free US shipping   every card is free shipping, and checkout ships to the US only
//   Original art, made to order   Printful and Yoycol print each order when it's placed
// "Real cotton" isn't in the row: the skater dress (78% polyester) and the
// snapback (acrylic / wool) aren't cotton. The cotton line is the hero's, and
// the cards still flag anything that isn't cotton.

/** One sentence under the brand line. */
export const HERO_LINE = "Original characters on real cotton.";

/** The benefits row, shown as one line: "Free US shipping · Original art, made to order". */
export const BENEFITS = ["Free US shipping", "Original art, made to order"] as const;
