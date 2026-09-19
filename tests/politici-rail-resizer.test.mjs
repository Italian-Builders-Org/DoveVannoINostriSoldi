import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  clampRailWidth,
  maxRailWidth,
  parseStoredRailWidth,
  RAIL_WIDTH_MIN,
} = await import("../src/lib/politici-rail-width.ts");

const graph = await readFile(new URL("../src/app/politici/repubblica-graph.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/app/politici/politici.module.css", import.meta.url), "utf8");

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

test("explorer wires the separator to pointer, keyboard and persistence", () => {
  assert.match(graph, /role="separator"/);
  assert.match(graph, /aria-orientation="vertical"/);
  assert.match(graph, /aria-valuemin={RAIL_WIDTH_MIN}/);
  assert.match(graph, /aria-valuemax={railMax}/);
  assert.match(graph, /onPointerDown={onRailPointerDown}/);
  assert.match(graph, /onPointerMove={onRailPointerMove}/);
  assert.match(graph, /onKeyDown={onRailKeyDown}/);
  assert.match(graph, /onDoubleClick={onRailDoubleClick}/);
  assert.match(graph, /RAIL_WIDTH_STORAGE_KEY/);
  assert.match(graph, /setPointerCapture/);
  assert.match(styles, /--rail-width/);
  assert.match(styles, /\.railResizer/);
  assert.match(styles, /data-resizing/);
});
