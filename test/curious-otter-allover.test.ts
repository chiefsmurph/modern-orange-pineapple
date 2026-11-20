// Curious Otter All-Over Tee (John 11/19): a Yoycol product, never sent to Printful.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildItem } from "../lib/orders/build-items.ts";
import legacy from "../public/products.ts";
import { creditText, getDesign } from "../lib/artists.ts";

test("the otter tee orders from Yoycol (design Q46Q2, tee blank, picked size) at the all-over price", () => {
  const { item, shippingCents } = buildItem("curious-otter-allover-tee", { size: "L" }, 1, {});
  assert.equal(item.supplier, "yoycol");
  assert.deepEqual(item.yoycol, { designCode: "Q46Q2", skuCode: "ADS-3MTXVYM32-00000-FFFFFF-L" });
  assert.equal(item.manual, undefined);
  assert.equal(item.unitAmount + shippingCents, 4476);
});

test("the otter tee page credits the CC BY Morro Rock photo", () => {
  const p = legacy.products.find((x) => x.id === "curious-otter-allover-tee")!;
  assert.equal(p.title, "Curious Otter All-Over Tee");
  assert.doesNotMatch(p.title + p.description, /Morro Bay/);
  assert.match(creditText(getDesign(p.design as never)!), /Vanessa Kay \(CC BY 3\.0\)/);
});
