const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function baseScale({ width, height }, spanMetres = 6500) {
  if (!Number.isFinite(spanMetres) || spanMetres < 1000 || spanMetres > 2000000)
    throw Error("Invalid map context span");
  return (Math.min(width / 6500, height / 4300) * 1.4 * 6500) / spanMetres;
}
export function normalizeBearing(angle) {
  return (
    ((((angle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) -
    Math.PI
  );
}
export function zoomLimits(camera) {
  return { min: camera.base / 10, max: Math.min(1.2, camera.base * 8) };
}
function limitedScale(camera, scale) {
  const { min, max } = zoomLimits(camera);
  return clamp(scale, min, max);
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
  { padding = 42, maxHeight = 0, insets = {} } = {},
) {
  if (!points.length) return { ...camera };
  const left = insets.left || 0,
    right = insets.right || 0,
    top = insets.top || 0,
    bottom = insets.bottom || 0;
  const target = [
    (left + view.width - right) / 2,
    (top + view.height - bottom) / 2,
  ];
  if (
    view.width - left - right <= padding * 2 ||
    view.height - top - bottom <= padding * 2
  )
    return { ...camera };
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
  const centered = (scale) => {
    let candidate = { ...next, scale };
    for (let iteration = 0; iteration < 12; iteration++) {
      const p = projection(candidate, view);
      const screen = corners.flatMap((point) => [
        p.project(point),
        p.project(point, maxHeight),
      ]);
      if (screen.some((point) => !point)) return null;
      const xs = screen.map((point) => point[0]),
        ys = screen.map((point) => point[1]);
      const centre = [
        (Math.min(...xs) + Math.max(...xs)) / 2,
        (Math.min(...ys) + Math.max(...ys)) / 2,
      ];
      if (Math.hypot(centre[0] - target[0], centre[1] - target[1]) < 0.01)
        break;
      candidate = panCamera(candidate, view, centre, target);
    }
    return candidate;
  };
  const fits = (scale) => {
    const candidate = centered(scale);
    if (!candidate) return false;
    const p = projection(candidate, view);
    return corners.every((point) =>
      [0, maxHeight].every((z) => {
        const screen = p.project(point, z);
        return (
          screen &&
          screen[0] >= left + padding &&
          screen[0] <= view.width - right - padding &&
          screen[1] >= top + padding &&
          screen[1] <= view.height - bottom - padding
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
  return centered(lo) ?? { ...next, scale: lo };
}
export function resizeCamera(camera, before, after) {
  const base = baseScale(after, camera.viewWidthMetres),
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
