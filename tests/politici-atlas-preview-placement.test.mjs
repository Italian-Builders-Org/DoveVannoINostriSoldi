import assert from "node:assert/strict";
import test from "node:test";
import { placePreview } from "../src/app/politici/atlas-preview-placement.ts";

const viewport = { left: 0, top: 0, width: 1280, height: 820 };
const content = { width: 264, height: 170 };
const seat = { left: 700, top: 450, width: 14, height: 14 };

test("measured preview prefers space above the seat", () => {
  const result = placePreview(seat, content, viewport);
  assert.equal(result.side, "above");
  assert.equal(result.top, 272);
  assert.equal(result.left, 575);
});

test("preview flips below a seat near the top", () => {
  const result = placePreview({ ...seat, top: 12 }, content, viewport);
  assert.equal(result.side, "below");
  assert.equal(result.top, 34);
});

test("long role and group names use their real height", () => {
  const result = placePreview({ ...seat, top: 240 }, { width: 264, height: 430 }, viewport);
  assert.equal(result.side, "below");
  assert.equal(result.top, 262);
});

for (const [label, view] of [
  ["phone", { left: 0, top: 0, width: 320, height: 568 }],
  ["landscape", { left: 0, top: 0, width: 844, height: 390 }],
  ["desktop", viewport],
  ["zoomed visual viewport", { left: 210.5, top: 114.25, width: 500, height: 330 }],
  ["tiny viewport", { left: 0, top: 0, width: 10, height: 10 }],
  ["zero-sized viewport", { left: 0, top: 0, width: 0, height: 0 }],
]) {
  test(`preview stays bounded: ${label}`, () => {
    for (const x of [-400, 0, 310.25, 900, 2000]) {
      for (const y of [-500, 0, 360.5, 1700]) {
        for (const height of [0, 90, 230, 700]) {
          const size = { width: 264, height };
          const result = placePreview({ ...seat, left: x, top: y }, size, view);
          assert.ok(result.left >= view.left);
          assert.ok(result.top >= view.top);
          assert.ok(result.left + Math.min(size.width, result.maxWidth) <= view.left + view.width + 1e-9);
          assert.ok(result.top + Math.min(size.height, result.maxHeight) <= view.top + view.height + 1e-9);
        }
      }
    }
  });
}

test("invalid geometry is rejected, not rendered as NaNpx", () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.throws(() => placePreview({ ...seat, left: invalid }, content, viewport), RangeError);
    assert.throws(() => placePreview(seat, { ...content, height: invalid }, viewport), RangeError);
  }
  assert.throws(() => placePreview(seat, { ...content, width: -1 }, viewport), RangeError);
});

test("placement is deterministic and does not mutate geometry", () => {
  const anchor = Object.freeze({ ...seat });
  assert.deepEqual(placePreview(anchor, content, viewport), placePreview(anchor, content, viewport));
  assert.deepEqual(anchor, seat);
});
