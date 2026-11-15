import test from "node:test";
import assert from "node:assert/strict";
import {
  baseScale,
  normalizeBearing,
  projection,
  zoomCamera,
  panCamera,
  fitCamera,
  resizeCamera,
  scaleBar,
} from "./camera.mjs";
const view = { width: 1200, height: 650 };
const cam = {
  x: 124,
  y: -321,
  scale: 0.18,
  base: 0.18,
  bearing: -0.35,
  pitch: 0.95,
};
const near = (a, b) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${a} differs from ${b}`);

test("ground coordinates survive perspective/rotation and its inverse", () => {
  for (const pitch of [0, 0.4, 0.95, 1.13])
    for (const bearing of [-2.9, -0.35, 0, 2.8]) {
      const p = projection({ ...cam, pitch, bearing }, view);
      for (const world of [
        [0, 0],
        [500, -1000],
        [-1400, 1800],
      ]) {
        const s = p.project(world);
        assert.ok(s);
        const w = p.unproject(...s);
        near(w[0], world[0]);
        near(w[1], world[1]);
      }
    }
});
test("points above the ground horizon do not become fake locations", () => {
  const p = projection(cam, view);
  assert.equal(p.unproject(600, -10000), null);
  assert.equal(p.project([0, 0], 100000), null);
});
test("wheel zoom keeps the location under a rotated off-centre cursor", () => {
  const anchor = [870, 450],
    before = projection(cam, view).unproject(...anchor);
  const next = zoomCamera(cam, view, 1.7, anchor),
    after = projection(next, view).unproject(...anchor);
  near(before[0], after[0]);
  near(before[1], after[1]);
  assert.equal(cam.scale, 0.18);
});
test("zoom shares one finite range with controls, even after repeated input", () => {
  const max = zoomCamera(cam, view, 1e20, [600, 325]),
    min = zoomCamera(cam, view, 1e-20, [600, 325]);
  assert.equal(max.scale, 1.2);
  near(min.scale, cam.base / 10);
  assert.ok(Number.isFinite(max.x));
});
test("drag keeps the grabbed ground point under the pointer in perspective", () => {
  const from = [300, 390],
    to = [470, 470],
    world = projection(cam, view).unproject(...from);
  const next = panCamera(cam, view, from, to),
    screen = projection(next, view).project(world);
  near(screen[0], to[0]);
  near(screen[1], to[1]);
});
test("fit contains the rotated network and raised ridges, not just flat bounds", () => {
  const points = [
      [-4000, -2500],
      [3500, 2800],
      [0, 0],
      [1000, -2000],
    ],
    padding = 42;
  for (const bearing of [-2, -0.35, 1.8]) {
    const next = fitCamera({ ...cam, bearing }, view, points, {
        padding,
        maxHeight: 360,
      }),
      p = projection(next, view);
    for (const point of points)
      for (const height of [0, 360]) {
        const s = p.project(point, height);
        assert.ok(s);
        assert.ok(s[0] >= padding - 0.1 && s[0] <= view.width - padding + 0.1);
        assert.ok(s[1] >= padding - 0.1 && s[1] <= view.height - padding + 0.1);
      }
  }
});
test("fit handles coincident points and empty selections without NaN", () => {
  const a = fitCamera(cam, view, [], {}),
    b = fitCamera(
      cam,
      view,
      [
        [20, 30],
        [20, 30],
      ],
      {},
    );
  assert.deepEqual(a, cam);
  assert.ok(b.scale > 0 && Number.isFinite(b.scale));
});
test("bearing wraps and responsive resizing preserves relative zoom", () => {
  near(normalizeBearing(7 * Math.PI), -Math.PI);
  near(normalizeBearing(-9 * Math.PI), -Math.PI);
  const next = resizeCamera(cam, view, { width: 360, height: 520 });
  near(next.scale / next.base, cam.scale / cam.base);
  assert.equal(next.x, cam.x);
  near(next.base, baseScale({ width: 360, height: 520 }));
});
test("map scale uses ground perspective at its displayed position", () => {
  const s = scaleBar({ ...cam, pitch: 0, scale: 0.2 }, view, 100);
  assert.equal(s.metres, 500);
  near(s.pixels, 100);
});
test("pinch and twist preserve the grabbed centre while both fingers move", async () => {
  const { transformCamera } = await import("./camera.mjs");
  const from = [500, 340],
    to = [570, 390],
    world = projection(cam, view).unproject(...from);
  const next = transformCamera(cam, view, {
      from,
      to,
      factor: 1.4,
      rotation: 0.3,
    }),
    screen = projection(next, view).project(world);
  near(screen[0], to[0]);
  near(screen[1], to[1]);
  near(next.bearing, normalizeBearing(cam.bearing - 0.3));
});

test("fit balances the projected network and raised ridges around the viewport centre", () => {
  const box = [
      [0, -2000],
      [0, 7000],
      [12000, -2000],
      [12000, 7000],
    ],
    viewport = { width: 1280, height: 700 };
  const fitted = fitCamera(
    { ...cam, bearing: 1.1, pitch: 1.0 },
    viewport,
    box,
    { padding: 48, maxHeight: 300 },
  );
  const project = projection(fitted, viewport),
    screen = box.flatMap((p) => [project.project(p), project.project(p, 300)]);
  assert.ok(screen.every(Boolean));
  for (const [axis, size] of [
    [0, viewport.width],
    [1, viewport.height],
  ]) {
    const values = screen.map((p) => p[axis]);
    assert.ok(
      Math.abs((Math.min(...values) + Math.max(...values)) / 2 - size / 2) < 1,
      "projected bounds must be centred",
    );
  }
});

test("a selected raised segment fits the free viewport above a mobile detail card", () => {
  const viewport = { width: 390, height: 550 },
    box = [
      [-200, -300],
      [-200, 600],
      [500, -300],
      [500, 600],
    ];
  const insets = { top: 70, right: 54, bottom: 265, left: 12 },
    padding = 16;
  const fitted = fitCamera(
    { ...cam, base: baseScale(viewport), bearing: 1.1, pitch: 1 },
    viewport,
    box,
    { padding, maxHeight: 280, insets },
  );
  const p = projection(fitted, viewport),
    screen = box.flatMap((point) => [p.project(point), p.project(point, 280)]);
  assert.ok(screen.every(Boolean));
  for (const [x, y] of screen) {
    assert.ok(
      x >= insets.left + padding - 0.1 &&
        x <= viewport.width - insets.right - padding + 0.1,
    );
    assert.ok(
      y >= insets.top + padding - 0.1 &&
        y <= viewport.height - insets.bottom - padding + 0.1,
    );
  }
  const ys = screen.map((point) => point[1]);
  assert.ok(
    Math.abs(
      (Math.min(...ys) + Math.max(...ys)) / 2 -
        (insets.top + viewport.height - insets.bottom) / 2,
    ) < 1,
  );
});

test("long distance context fits without changing urban defaults or resize ratios", () => {
  const span = 160000;
  near(baseScale(view), Math.min(view.width / 6500, view.height / 4300) * 1.4);
  near(baseScale(view, span), (baseScale(view) * 6500) / span);
  const wide = {
    ...cam,
    base: baseScale(view, span),
    scale: baseScale(view, span),
    viewWidthMetres: span,
  };
  const points = [
    [0, -80000],
    [0, 80000],
    [20000, 0],
  ];
  const fitted = fitCamera(wide, view, points, { padding: 42 });
  for (const point of points) {
    const [x, y] = projection(fitted, view).project(point);
    assert.ok(
      x >= 40 && x <= view.width - 40 && y >= 40 && y <= view.height - 40,
    );
  }
  const small = resizeCamera(fitted, view, { width: 390, height: 600 });
  near(small.scale / small.base, fitted.scale / fitted.base);
  near(small.base, baseScale({ width: 390, height: 600 }, span));
  for (const bad of [0, NaN, Infinity, -1, 3000000])
    assert.throws(() => baseScale(view, bad));
});
