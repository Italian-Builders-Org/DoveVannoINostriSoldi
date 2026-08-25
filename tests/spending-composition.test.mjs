import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { layoutComposition } from "../src/lib/composition-layout.ts";
import { HOME_SPENDING_BUCKETS } from "../src/lib/siope-titles.ts";

const snapshots = [
  new URL("../src/data/generated/siope-municipal-2024.json", import.meta.url),
  new URL("../src/data/generated/siope-municipal-2025.json", import.meta.url),
  new URL("../src/data/generated/siope-municipal.json", import.meta.url),
];

test("composition layout preserves proportional area without overlap", () => {
  const rectangles = layoutComposition([
    { id: "a", value: 55 },
    { id: "b", value: 25 },
    { id: "c", value: 15 },
    { id: "d", value: 5 },
  ]);
  assert.equal(rectangles.length, 4);
  assert.ok(Math.abs(rectangles.reduce((total, rectangle) => total + rectangle.areaShare, 0) - 1) < 1e-12);
  for (const rectangle of rectangles) {
    assert.ok(rectangle.x >= 0 && rectangle.y >= 0);
    assert.ok(rectangle.x + rectangle.width <= 100 + 1e-9);
    assert.ok(rectangle.y + rectangle.height <= 62 + 1e-9);
    assert.ok(Math.abs((rectangle.width * rectangle.height) / 6200 - rectangle.areaShare) < 1e-12);
  }
});

test("composition layout rejects misleading inputs", () => {
  assert.throws(() => layoutComposition([{ id: "a", value: -1 }]), /non-negative/);
  assert.throws(() => layoutComposition([{ id: "a", value: 1 }, { id: "a", value: 2 }]), /unique/);
});

test("home spending buckets are a complete additive partition for every available snapshot", async () => {
  const allCodes = HOME_SPENDING_BUCKETS.flatMap((bucket) => bucket.codes);
  assert.equal(new Set(allCodes).size, allCodes.length, "ogni titolo deve appartenere a un solo gruppo");

  for (const url of snapshots) {
    const snapshot = JSON.parse(await readFile(url, "utf8"));
    const values = new Map(snapshot.titles.map((title) => [title.code, title.value]));
    assert.deepEqual([...values.keys()].sort(), [...allCodes].sort(), `${snapshot.year}: copertura titoli`);
    const groupedTotal = HOME_SPENDING_BUCKETS.reduce(
      (total, bucket) => total + bucket.codes.reduce((sum, code) => sum + values.get(code), 0),
      0,
    );
    assert.ok(Math.abs(groupedTotal - snapshot.totalPaid) <= 0.01, `${snapshot.year}: riconciliazione al centesimo`);
  }
});

test("composition component keeps partial state, keyboard tooltip and exact table in its contract", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../src/components/spending-composition.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/spending-composition.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(component, /kind: "partial"/);
  assert.match(component, /role="tooltip"/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(component, /Dati esatti della composizione/);
  assert.match(component, /Ready composition must reconcile with its total/);
  assert.match(component, /Partial composition cannot exceed its canonical total/);
  assert.match(css, /aspect-ratio: 100 \/ 62/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.visual \{ display: none; \}/);
});
