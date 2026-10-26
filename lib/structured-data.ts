// schema.org JSON-LD: who MOP is, in a form search engines and AI answers read
// (Google 10/25 described MOP as "born out of Chico, California"). The home page
// carries the store + the website (Google's site name); /about carries the store +
// the about page. Every fact here is one the site already states: keep them in step
// with SITE_DESCRIPTION and app/about/page.tsx, and never add one the site can't back.
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "./share-meta.ts";

export const INSTAGRAM_URL = "https://www.instagram.com/modernorangepineapple/";
export const ETSY_URL = "https://www.etsy.com/shop/ModOrangePineapple";
/** The brand's official profiles (Organization sameAs). No Facebook page is linked on the site yet. */
export const SAME_AS = [INSTAGRAM_URL, ETSY_URL];
export const ALTERNATE_NAMES = ["Modern Orange Pineapple", "MOP"];
/** Where the brand says it's from (the Instagram bio and SITE_DESCRIPTION end "Morro Bay, CA"). */
export const HOME_TOWN = { locality: "Morro Bay", region: "CA", country: "US" };

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;

type Node = Record<string, unknown>;

export function organizationNode(): Node {
  return {
    "@type": "OnlineStore",
    "@id": ORG_ID,
    name: SITE_NAME,
    alternateName: ALTERNATE_NAMES,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/apple-icon.png`,
    description: SITE_DESCRIPTION,
    address: {
      "@type": "PostalAddress",
      addressLocality: HOME_TOWN.locality,
      addressRegion: HOME_TOWN.region,
      addressCountry: HOME_TOWN.country,
    },
    sameAs: SAME_AS,
  };
}

/** The home page's graph: the store, and the website with its name (Google's site name). */
export function homeJsonLd(): Node {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationNode(),
      {
        "@type": "WebSite",
        "@id": SITE_ID,
        url: `${SITE_URL}/`,
        name: SITE_NAME,
        alternateName: ALTERNATE_NAMES,
        publisher: { "@id": ORG_ID },
      },
    ],
  };
}

/** /about's graph: the store, and the page that describes it. */
export function aboutJsonLd(description: string): Node {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationNode(),
      {
        "@type": "AboutPage",
        url: `${SITE_URL}/about`,
        name: `About ${SITE_NAME}`,
        description,
        about: { "@id": ORG_ID },
        isPartOf: { "@id": SITE_ID },
      },
    ],
  };
}

/** The script body: JSON with "<" escaped, so no string in it can close the <script> tag. */
export const jsonLdScript = (data: Node) => JSON.stringify(data).replace(/</g, "\\u003c");
