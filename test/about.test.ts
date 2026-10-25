// /about + the schema.org JSON-LD (lib/structured-data.ts, app/about/page.tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  aboutJsonLd,
  homeJsonLd,
  HOME_TOWN,
  INSTAGRAM_URL,
  jsonLdScript,
  organizationNode,
} from "../lib/structured-data.ts";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "../lib/share-meta.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
type Node = Record<string, any>;
const graph = (d: Node) => d["@graph"] as Node[];

test("the store: name, MOP aliases, the rabbit logo, Morro Bay, Instagram", () => {
  const org = organizationNode();
  assert.equal(org["@type"], "OnlineStore");
  assert.equal(org.name, SITE_NAME);
  assert.deepEqual(org.alternateName, ["MOP", "MOP Clothing"]);
  assert.equal(org.url, `${SITE_URL}/`);
  assert.equal(org.logo, `${SITE_URL}/apple-icon.png`);
  assert.ok(existsSync(path.join(ROOT, "public", "apple-icon.png")));
  assert.deepEqual(org.address, {
    "@type": "PostalAddress",
    addressLocality: "Morro Bay",
    addressRegion: "CA",
    addressCountry: "US",
  });
  assert.deepEqual(org.sameAs, [INSTAGRAM_URL]);
});

test("the home town is the one the site already states", () => {
  assert.ok(SITE_DESCRIPTION.endsWith(`${HOME_TOWN.locality}, ${HOME_TOWN.region}`), SITE_DESCRIPTION);
  const about = readFileSync(path.join(ROOT, "app/about/page.tsx"), "utf8");
  assert.match(about, /from Morro Bay, California/);
});

test("home: the store + the website, linked by @id", () => {
  const d = homeJsonLd();
  assert.equal(d["@context"], "https://schema.org");
  const [org, site] = graph(d);
  assert.equal(org["@type"], "OnlineStore");
  assert.equal(site["@type"], "WebSite");
  assert.equal(site.name, SITE_NAME);
  assert.deepEqual(site.publisher, { "@id": org["@id"] });
});

test("about: the store + an AboutPage about it", () => {
  const [org, page] = graph(aboutJsonLd("desc"));
  assert.equal(page["@type"], "AboutPage");
  assert.equal(page.url, `${SITE_URL}/about`);
  assert.equal(page.description, "desc");
  assert.deepEqual(page.about, { "@id": org["@id"] });
  assert.equal(page.isPartOf["@id"], homeJsonLd()["@graph"][1]["@id"]);
});

test("the script body can't close its <script> tag and still parses to the same data", () => {
  const data = { "@context": "https://schema.org", name: "</script><b>x</b>" };
  const s = jsonLdScript(data);
  assert.ok(!s.includes("<"));
  assert.deepEqual(JSON.parse(s), data);
});
