// Verified reviews on a product page, and the rating summary under its title.
// Plain createElement (no JSX, CSS passed in) so the tests can render it
// without a bundler; the page passes ProductReviews.module.css as `styles`.
import { createElement as h } from "react";
import type { PublicReview } from "../lib/reviews.ts";

type Data = { average: number; count: number; reviews: PublicReview[] };
type Styles = Record<string, string>;

const starText = (n: number) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));

/** "★★★★☆ 4.6 · 12 reviews", only once there's at least one approved review. */
export function RatingSummary({ data, styles = {} }: { data: Data | null | undefined; styles?: Styles }) {
  if (!data || data.count === 0) return null;
  return h(
    "a",
    { href: "#reviews", className: styles.summary, "aria-label": `Rated ${data.average} out of 5 from ${data.count} review${data.count === 1 ? "" : "s"}` },
    h("span", { className: styles.stars, "aria-hidden": true }, starText(data.average)),
    ` ${data.average.toFixed(1)} · ${data.count} review${data.count === 1 ? "" : "s"}`
  );
}

export function ProductReviews({ data, styles = {} }: { data: Data | null | undefined; styles?: Styles }) {
  if (!data || data.count === 0) return null;
  return h(
    "section",
    { id: "reviews", className: styles.section, "aria-labelledby": "reviews-title" },
    h("h2", { id: "reviews-title", className: styles.title }, "Reviews"),
    h(RatingSummary, { data, styles }),
    ...data.reviews.map((r) =>
      h(
        "article",
        { key: r.id, className: styles.review },
        h("div", { className: styles.stars, "aria-label": `${r.stars} out of 5 stars` }, starText(r.stars)),
        h("h3", { className: styles.reviewTitle }, r.title),
        h("p", { className: styles.text }, r.text),
        h(
          "p",
          { className: styles.by },
          h("b", null, r.first_name),
          " · ",
          h("span", { className: styles.verified }, "✓ Verified buyer"),
          // FTC: say so when the reviewer knows the maker
          r.connection ? h("span", { className: styles.friend, title: "The reviewer knows John or the MOP family" }, "Friend of MOP") : null
        )
      )
    )
  );
}
