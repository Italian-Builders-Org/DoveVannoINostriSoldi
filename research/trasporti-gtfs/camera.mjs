const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function baseScale({ width, height }) {
  return Math.min(width / 6500, height / 4300) * 1.4;
}
export function normalizeBearing(angle) {
  return (
    ((((angle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) -
    Math.PI
  );
}
function limitedScale(camera, scale) {
  return clamp(scale, camera.base / 10, Math.min(1.2, camera.base * 8));
}
export function projection(camera, { width, height }) {
  const { x: cx, y: cy, scale, bearing, pitch } = camera,
    sin = Math.sin(bearing),
    cos = Math.cos(bearing),
    cp = Math.cos(pitch),
    sp = Math.sin(pitch),
    distance = height / (0.8 * scale),
    ox = width / 2,
    oy = height * 0.53;
  return {
    project(point, elevation = 0) {
      const dx = point[0] - cx,
        dy = point[1] - cy,
        x = dx * cos - dy * sin,
        y = dx * sin + dy * cos,
        den = distance + y * sp - elevation * cp;
      if (den < distance * 0.12) return null;
      const f = distance / den;
      return [ox + x * scale * f, oy - (y * cp + elevation * sp) * scale * f];
    },
    unproject(x, y) {
      const sx = x - ox,
        sy = y - oy,
        den = cp * scale * distance + sy * sp;
      if (den <= 1e-8) return null;
      const ry = (-sy * distance) / den,
        f = distance / (distance + ry * sp),
        rx = sx / (scale * f);
      return [cx + rx * cos + ry * sin, cy - rx * sin + ry * cos];
    },
  };
}
function anchored(camera, next, view, from, to) {
  const before = projection(camera, view).unproject(...from),
    after = projection(next, view).unproject(...to);
  if (!before || !after) return next;
  return {
    ...next,
    x: next.x + before[0] - after[0],
    y: next.y + before[1] - after[1],
  };
}
export function zoomCamera(
  camera,
  view,
  factor,
  anchor = [view.width / 2, view.height * 0.53],
) {
  if (!Number.isFinite(factor) || factor <= 0) return { ...camera };
  return anchored(
    camera,
    { ...camera, scale: limitedScale(camera, camera.scale * factor) },
    view,
    anchor,
    anchor,
  );
}
export function panCamera(camera, view, from, to) {
  return anchored(camera, { ...camera }, view, from, to);
}
export function fitCamera(
  camera,
  view,
  points,
  { padding = 42, maxHeight = 0 } = {},
) {
  if (!points.length) return { ...camera };
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  for (const [x, y] of points) {
    west = Math.min(west, x);
    south = Math.min(south, y);
    east = Math.max(east, x);
    north = Math.max(north, y);
  }
  const next = {
      ...camera,
      x: (west + east) / 2,
      y: (south + north) / 2,
      bearing: normalizeBearing(camera.bearing),
    },
    corners = [
      [west, south],
      [west, north],
      [east, south],
      [east, north],
    ];
  const fits = (scale) => {
    const p = projection({ ...next, scale }, view);
    return corners.every((point) =>
      [0, maxHeight].every((z) => {
        const s = p.project(point, z);
        return (
          s &&
          s[0] >= padding &&
          s[0] <= view.width - padding &&
          s[1] >= padding &&
          s[1] <= view.height - padding
        );
      }),
    );
  };
  let lo = camera.base / 10,
    hi = Math.min(1.2, camera.base * 8);
  for (let i = 0; i < 36; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  next.scale = lo;
  return next;
}
export function resizeCamera(camera, before, after) {
  const base = baseScale(after),
    next = { ...camera, base };
  next.scale = limitedScale(next, (camera.scale / camera.base) * base);
  return next;
}
export function scaleBar(camera, view, pixels = 100) {
  const p = projection(camera, view),
    a = p.unproject(24, view.height - 30),
    b = p.unproject(24 + pixels, view.height - 30);
  if (!a || !b) return null;
  const distance = Math.hypot(b[0] - a[0], b[1] - a[1]),
    unit = 10 ** Math.floor(Math.log10(distance)),
    factor = [5, 2, 1].find((n) => n * unit <= distance * (1 + 1e-9)) ?? 1,
    metres = factor * unit;
  return { metres, pixels: (metres / distance) * pixels };
}
export function transformCamera(camera, view, { from, to, factor, rotation }) {
  const next = {
    ...camera,
    scale: limitedScale(camera, camera.scale * factor),
    bearing: normalizeBearing(camera.bearing - rotation),
  };
  return anchored(camera, next, view, from, to);
}
