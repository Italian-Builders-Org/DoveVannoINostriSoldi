import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { clampRailWidth, maxRailWidth, parseStoredRailWidth, RAIL_WIDTH_MIN } = await import("../src/lib/politici-rail-width.ts");
const read = (name) => readFile(new URL(`../src/app/politici/${name}`, import.meta.url), "utf8");
const [graph, rail, styles] = await Promise.all(["repubblica-graph.tsx", "atlas-rail.tsx", "atlas-enhancements.module.css"].map(read));

test("rail width clamp respects the floor and the viewport cap", () => {
  assert.equal(clampRailWidth(100, 1280), RAIL_WIDTH_MIN);
  assert.equal(clampRailWidth(400, 1280), 400);
  assert.equal(clampRailWidth(999, 1280), 640);
  assert.equal(clampRailWidth(999, 900), 450);
  assert.equal(clampRailWidth(400, 900), 400);
  assert.equal(maxRailWidth(1280), 640);
  assert.equal(maxRailWidth(900), 450);
  assert.equal(maxRailWidth(400), RAIL_WIDTH_MIN);
});

test("stored rail width ignores non-numeric and out-of-range values", () => {
  assert.equal(parseStoredRailWidth(null, 1280), null);
  assert.equal(parseStoredRailWidth("abc", 1280), null);
  assert.equal(parseStoredRailWidth("", 1280), null);
  assert.equal(parseStoredRailWidth("200", 1280), null);
  assert.equal(parseStoredRailWidth("700", 1280), null);
  assert.equal(parseStoredRailWidth("500", 900), null);
  assert.equal(parseStoredRailWidth("500", 1280), 500);
  assert.equal(parseStoredRailWidth("320.7", 1280), 321);
});

test("explorer composes accessible resizer with capture, cancellation, keyboard and optional storage", () => {
  assert.match(graph, /AtlasRailResizer rail=\{rail\}/);
  assert.match(graph, /style=\{rail.style\}/);
  for (const token of ['role="separator"', 'aria-orientation="vertical"', "aria-valuemin", "aria-valuemax", "aria-valuenow", "onPointerDown", "onPointerMove", "onPointerCancel", "onLostPointerCapture", "onKeyDown", "onDoubleClick", "RAIL_WIDTH_STORAGE_KEY", "setPointerCapture", "releasePointerCapture", "ArrowLeft", "ArrowRight", "Home", "End", "Escape"]) assert.ok(rail.includes(token), token);
  assert.match(rail, /--rail-width/);
  assert.match(styles, /\.railResizer/);
  assert.match(styles, /data-resizing/);
});
