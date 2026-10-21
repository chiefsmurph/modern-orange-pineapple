// Every choice is recorded once per value per tab (lib/umami.ts trackOnce, John 10/20).
import { test } from "node:test";
import assert from "node:assert/strict";
import { trackOnce } from "../lib/umami.ts";

test("trackOnce sends each choice once per tab; a different value or product is a new event", async () => {
  const calls: [string, unknown][] = [];
  (globalThis as unknown as { window: unknown }).window = {
    umami: { track: (name: string, data: unknown) => void calls.push([name, data]) },
  };
  try {
    trackOnce("pick|sky-tee|sky|aurora", "pick", { slug: "sky-tee", option: "sky", value: "aurora" });
    trackOnce("pick|sky-tee|sky|aurora", "pick", { slug: "sky-tee", option: "sky", value: "aurora" });
    trackOnce("pick|sky-tee|sky|milky-way", "pick", { slug: "sky-tee", option: "sky", value: "milky-way" });
    trackOnce("pick|sky-tee|sky|aurora", "pick", { slug: "sky-tee", option: "sky", value: "aurora" }); // back again: not resent
    trackOnce("pick|pelican-tee|size|XL", "pick", { slug: "pelican-tee", option: "size", value: "XL" });
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls, [
      ["pick", { slug: "sky-tee", option: "sky", value: "aurora" }],
      ["pick", { slug: "sky-tee", option: "sky", value: "milky-way" }],
      ["pick", { slug: "pelican-tee", option: "size", value: "XL" }],
    ]);
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});
