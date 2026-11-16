import { projection, scaleBar } from "./camera.mjs";
import { buildStopIndex } from "./explorer.mjs";
import { rampColor, kmhColor, scaleFor } from "./insights.mjs";
export const speedColor = kmhColor;
// 0–12 min/km quantised in half-minute steps: one stroke per colour run keeps
// the gradient smooth without one canvas call per interpolated point.
const rampBuckets = Array.from({ length: 25 }, (_, i) => rampColor(i / 2));
const basemap = {
  paper: "#eceeee",
  block: "#e3e6e6",
  green: "#dfe6dc",
  water: "#cfdbe1",
  river: "#c9d7de",
  casing: "#d7dbdc",
  road: "#fbfbfa",
  label: "#59656b",
  minorLabel: "#848e93",
  halo: "#f2f3f3",
};
export const mapPaper = basemap.paper;
function worldFactory(focus) {
  const r = 6371008.8,
    cos = Math.cos((focus[1] * Math.PI) / 180),
    originY = Math.log(Math.tan(Math.PI / 4 + (focus[1] * Math.PI) / 360));
  return (point) => [
    (((point[0] - focus[0]) * Math.PI) / 180) * r * cos,
    (Math.log(Math.tan(Math.PI / 4 + (point[1] * Math.PI) / 360)) - originY) *
      r *
      cos,
  ];
}
export function prepareScene(source) {
  const world = worldFactory(source.focus);
  const segments = source.segments.map((s) => {
    const points = s.coordinates.map(world),
      lengths = [0];
    for (let i = 1; i < points.length; i++)
      lengths.push(
        lengths.at(-1) +
          Math.hypot(
            points[i][0] - points[i - 1][0],
            points[i][1] - points[i - 1][1],
          ),
      );
    return { ...s, points, lengths };
  });
  const stops = buildStopIndex(source).map((s) => ({
    ...s,
    world: world(s.point),
  }));
  const features = (source.basemap?.features ?? []).map((f) => ({
      ...f,
      points: f.coordinates.map(world),
    })),
    labels = (
      source.basemap?.labels ??
      source.stops.map((s) => ({
        name: s.name,
        point: s.point,
        class: "station",
      }))
    )
      .map((l) => ({
        ...l,
        point: world(l.point),
      }))
      .sort(
        (a, b) =>
          Number(/city|town/.test(b.class)) - Number(/city|town/.test(a.class)),
      );
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  for (const s of segments)
    for (const [x, y] of s.points) {
      west = Math.min(west, x);
      south = Math.min(south, y);
      east = Math.max(east, x);
      north = Math.max(north, y);
    }
  const bounds = source.mapBounds ?? [
    source.focus[0] - 0.05,
    source.focus[1] - 0.05,
    source.focus[0] + 0.05,
    source.focus[1] + 0.05,
  ];
  for (const geo of [
    [bounds[0], bounds[1]],
    [bounds[2], bounds[3]],
  ]) {
    const [x, y] = world(geo);
    west = Math.min(west, x);
    south = Math.min(south, y);
    east = Math.max(east, x);
    north = Math.max(north, y);
  }
  return {
    source,
    scale: scaleFor(source.mode),
    // Ridges are drawn in world metres: wide corridors need taller ones to
    // stay visible at the zoom that shows them whole.
    heightScale: Math.max(1, ((source.viewWidthMetres ?? 6500) / 6500) ** 0.9),
    features,
    segments,
    labels,
    stops,
    bounds: [west, south, east, north],
  };
}
function path(ctx, points) {
  ctx.beginPath();
  let active = false;
  for (const p of points) {
    if (!p) {
      active = false;
      continue;
    }
    if (active) ctx.lineTo(...p);
    else {
      ctx.moveTo(...p);
      active = true;
    }
  }
}
function onScreen(points, width, height) {
  return (
    points.some(
      (p) =>
        p &&
        p[0] > -60 &&
        p[0] < width + 60 &&
        p[1] > -60 &&
        p[1] < height + 60,
    ) ||
    points.some(
      (p, i) =>
        p &&
        points[i + 1] &&
        Math.min(p[0], points[i + 1][0]) < width &&
        Math.max(p[0], points[i + 1][0]) > 0 &&
        Math.min(p[1], points[i + 1][1]) < height &&
        Math.max(p[1], points[i + 1][1]) > 0,
    )
  );
}
function roadWidth(kind) {
  if (/motorway|trunk/.test(kind)) return 5;
  if (/primary|secondary/.test(kind)) return 4;
  if (/tertiary/.test(kind)) return 2.8;
  return 1.6;
}
function drawBackground(ctx, scene, p, view, camera, labelExclusions) {
  const { width, height } = view,
    zoom = camera ? camera.scale / camera.base : 1,
    visible = [];
  ctx.fillStyle = basemap.paper;
  ctx.fillRect(0, 0, width, height);
  for (const f of scene.features) {
    const screen = f.points.map((point) => p.project(point));
    if (onScreen(screen, width, height)) visible.push({ ...f, screen });
  }
  for (const f of visible) {
    if (f.kind === "road") continue;
    path(ctx, f.screen);
    if (f.closed) {
      ctx.fillStyle =
        f.kind === "water"
          ? basemap.water
          : f.kind === "green"
            ? basemap.green
            : basemap.block;
      ctx.fill();
    } else if (f.kind === "water") {
      ctx.strokeStyle = basemap.river;
      ctx.lineWidth = f.class === "river" ? 15 : 6;
      ctx.stroke();
    }
  }
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const f of visible) {
    if (f.kind !== "road") continue;
    path(ctx, f.screen);
    ctx.strokeStyle = basemap.casing;
    ctx.lineWidth = roadWidth(f.class) + 1.2;
    ctx.stroke();
    ctx.strokeStyle = basemap.road;
    ctx.lineWidth = roadWidth(f.class);
    ctx.stroke();
  }
  const boxes = [],
    names = new Set(),
    labelGap = 8,
    labelPad = (zoom >= 1.4 ? 14 : zoom >= 1 ? 18 : 24) + labelGap,
    stopLabels = !scene.source.basemap?.labels,
    maxPlaceLabels =
      zoom >= 1.5 ? 22 : zoom >= 1.1 ? 12 : zoom >= 0.85 ? 6 : stopLabels ? 0 : 4,
    maxRoadLabels = zoom >= 1.3 ? 12 : zoom >= 1 ? 8 : 3;
  let placedPlaces = 0;
  const overlapsUi = (left, top, right, bottom) =>
    labelExclusions.some(
      (ex) => left < ex.right && right > ex.left && top < ex.bottom && bottom > ex.top,
    );
  const fits = (x, y, w, h = 12) => {
      const left = x - w / 2 - labelPad,
        right = x + w / 2 + labelPad,
        top = y - h / 2 - labelPad,
        bottom = y + h / 2 + labelPad;
      if (left < 8 || right > width - 8 || top < 8 || bottom > height - 50)
        return false;
      if (overlapsUi(left, top, right, bottom)) return false;
      if (
        boxes.some(
          (b) =>
            !(
              right + labelGap < b.left ||
              left > b.right + labelGap ||
              bottom + labelGap < b.top ||
              top > b.bottom + labelGap
            ),
        )
      )
        return false;
      boxes.push({ left, top, right, bottom });
      return true;
    };
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const label of scene.labels) {
    const xy = p.project(label.point);
    if (!xy) continue;
    const major = /city|town|station/.test(label.class);
    if (stopLabels && !major && zoom < 1.6) continue;
    if (stopLabels && major && zoom < 0.95) continue;
    if (placedPlaces >= maxPlaceLabels) break;
    const text = label.name.slice(0, 50);
    ctx.font = (major ? "600 13px" : "500 11px") + " system-ui";
    const textW = ctx.measureText(text).width;
    if (!fits(xy[0], xy[1], textW, major ? 16 : 14)) continue;
    placedPlaces++;
    ctx.strokeStyle = basemap.halo;
    ctx.lineWidth = 4;
    ctx.strokeText(text, ...xy);
    ctx.fillStyle = major ? basemap.label : basemap.minorLabel;
    ctx.fillText(text, ...xy);
  }
  for (const f of visible) {
    if (
      f.kind !== "road" ||
      !f.name ||
      !/^(primary|secondary|tertiary)$/.test(f.class) ||
      names.has(f.name)
    )
      continue;
    const a = f.screen.find(Boolean),
      b = f.screen.findLast(Boolean),
      mid = f.screen[Math.floor(f.screen.length / 2)];
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!a || !b || !mid || span < (zoom >= 1.2 ? 160 : 200))
      continue;
    const text = f.name.slice(0, 60);
    ctx.font = "10px system-ui";
    const textW = ctx.measureText(text).width;
    if (!fits(mid[0], mid[1], textW, 12)) continue;
    ctx.strokeStyle = basemap.halo;
    ctx.lineWidth = 3;
    ctx.strokeText(text, ...mid);
    ctx.fillStyle = basemap.minorLabel;
    ctx.fillText(text, ...mid);
    names.add(f.name);
    if (names.size >= maxRoadLabels) break;
  }
  return visible.filter((f) => f.kind === "road").length;
}
// World-metre crest height for a segment; the camera framing uses it too.
export function ridgeHeight(s, band, scene, relief) {
  return (
    Math.min((60 / s.bands[band].kmh) * (12 / scene.scale.maxMinPerKm), 12) *
    24 *
    relief *
    scene.heightScale
  );
}
function ridgePoints(s, band, p, relief, scene) {
  const points = [],
    base = [],
    levels = [],
    total = s.lengths.at(-1) || 1,
    value = Math.min(
      (60 / s.bands[band].kmh) * (12 / scene.scale.maxMinPerKm),
      12,
    ),
    height = ridgeHeight(s, band, scene, relief);
  // Graphic interpolation encodes segment min/km, never observed speed within
  // a segment. Colour follows the drawn height, so feet stay pale and the
  // peak carries the segment's value (in 2D the whole line does).
  const push = (point, progress) => {
    const lift = relief ? Math.sin(progress * Math.PI) ** 2 : 1;
    points.push(p.project(point, height * lift));
    base.push(relief ? p.project(point) : null);
    levels.push(Math.round(value * lift * 2));
  };
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1],
      b = s.points[i],
      steps = Math.max(
        1,
        Math.ceil(((s.lengths[i] - s.lengths[i - 1]) / total) * 18),
      );
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      push(
        [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        (s.lengths[i - 1] + (s.lengths[i] - s.lengths[i - 1]) * t) / total,
      );
    }
  }
  push(s.points.at(-1), 1);
  return { points, base, levels, value };
}
function strokeRuns(ctx, points, levels, width) {
  ctx.lineWidth = width;
  let start = 0;
  for (let i = 1; i <= points.length; i++) {
    if (i < points.length && levels[i] === levels[start] && points[i]) continue;
    const run = points.slice(start, Math.min(i + 1, points.length));
    if (run.length > 1) {
      path(ctx, run);
      // Colour each run by its higher end so peaks never look paler.
      ctx.strokeStyle =
        rampBuckets[Math.max(levels[start], levels[Math.min(i, points.length - 1)])];
      ctx.stroke();
    }
    start = i;
  }
}
function curtain(ctx, ridge, dense) {
  const { points, base, value } = ridge;
  if (!base[0] || value <= 0) return;
  ctx.beginPath();
  let open = false;
  for (const xy of points)
    if (xy) {
      if (open) ctx.lineTo(...xy);
      else ctx.moveTo(...xy);
      open = true;
    }
  for (let i = base.length - 1; i >= 0; i--) if (base[i]) ctx.lineTo(...base[i]);
  ctx.closePath();
  ctx.fillStyle = rampBuckets[Math.round(value * 2)] + "14";
  ctx.fill();
  if (!dense) return;
  // Hairline "posts" from ground to crest, as in a ribbon chart.
  ctx.beginPath();
  for (let i = 1; i < points.length - 1; i += 3) {
    if (!points[i] || !base[i] || Math.abs(points[i][1] - base[i][1]) < 3)
      continue;
    ctx.moveTo(...base[i]);
    ctx.lineTo(...points[i]);
  }
  ctx.strokeStyle = "rgba(70, 80, 86, 0.16)";
  ctx.lineWidth = 0.6;
  ctx.stroke();
}
export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("Il browser non supporta la mappa Canvas.");
  const back = document.createElement("canvas"),
    front = document.createElement("canvas"),
    bc = back.getContext("2d"),
    fc = front.getContext("2d");
  let backgroundScene = null,
    backgroundKey = "",
    foregroundKey = "",
    foregroundSegments = null,
    drawn = [],
    grid = new Map(),
    streets = 0,
    labelExclusions = [];
  function setLabelExclusions(rects) {
    labelExclusions = rects;
    backgroundKey = "";
  }
  function sizeLayer(layer, context, width, height, ratio) {
    if (
      layer.width !== Math.round(width * ratio) ||
      layer.height !== Math.round(height * ratio)
    ) {
      layer.width = Math.round(width * ratio);
      layer.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  function indexPaths(view) {
    grid = new Map();
    for (let index = 0; index < drawn.length; index++) {
      const points = drawn[index].points.filter(Boolean);
      let loX = Infinity,
        hiX = -Infinity,
        loY = Infinity,
        hiY = -Infinity;
      for (const [x, y] of points) {
        loX = Math.min(loX, x);
        hiX = Math.max(hiX, x);
        loY = Math.min(loY, y);
        hiY = Math.max(hiY, y);
      }
      for (
        let x = Math.max(0, Math.floor((loX - 10) / 64));
        x <= Math.min(Math.floor(view.width / 64), Math.floor((hiX + 10) / 64));
        x++
      )
        for (
          let y = Math.max(0, Math.floor((loY - 10) / 64));
          y <=
          Math.min(Math.floor(view.height / 64), Math.floor((hiY + 10) / 64));
          y++
        ) {
          const key = x + "," + y;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(index);
        }
    }
  }
  function draw({
    scene,
    segments,
    band,
    camera,
    selected,
    hovered,
    stop,
    relief = 1,
  }) {
    const started = performance.now(),
      view = { width: canvas.clientWidth, height: canvas.clientHeight },
      ratio = Math.min(window.devicePixelRatio || 1, 2),
      p = projection(camera, view),
      key = [
        view.width,
        view.height,
        ratio,
        camera.x,
        camera.y,
        camera.scale,
        camera.bearing,
        camera.pitch,
      ].join(",");
    // A hidden or collapsed canvas has no pixels to draw: drawImage would throw.
    if (!view.width || !view.height)
      return { streets, segments: 0, renderMs: "0", scale: null };
    sizeLayer(canvas, ctx, view.width, view.height, ratio);
    sizeLayer(back, bc, view.width, view.height, ratio);
    sizeLayer(front, fc, view.width, view.height, ratio);
    const backgroundHit = backgroundScene === scene && backgroundKey === key;
    if (!backgroundHit) {
      bc.clearRect(0, 0, view.width, view.height);
      streets = scene
        ? drawBackground(bc, scene, p, view, camera, labelExclusions)
        : 0;
      backgroundScene = scene;
      backgroundKey = key;
    }
    const fgKey = key + "," + band + "," + relief,
      foregroundHit =
        backgroundHit &&
        foregroundKey === fgKey &&
        foregroundSegments === segments;
    if (!foregroundHit) {
      fc.clearRect(0, 0, view.width, view.height);
      fc.lineJoin = "round";
      fc.lineCap = "round";
      drawn = [];
      const ordered = [...segments].sort(
        (a, b) =>
          (p.project(a.points[0]) ?? [0, 0])[1] -
          (p.project(b.points[0]) ?? [0, 0])[1],
      );
      const lifted = camera.pitch ? relief : 0,
        ridges = [];
      for (const s of ordered) {
        const ground = s.points.map((point) => p.project(point)),
          ridge = ridgePoints(s, band, p, lifted, scene);
        if (
          !onScreen(ground, view.width, view.height) &&
          !onScreen(ridge.points, view.width, view.height)
        )
          continue;
        ridges.push({ s, ground, ridge });
      }
      // Detail scales with how much is on screen: posts and halos only when
      // they stay readable and cheap.
      const dense = ridges.length < 1400,
        sparse = ridges.length < 600;
      fc.strokeStyle = lifted ? "rgba(96, 108, 114, 0.45)" : "rgba(96, 108, 114, 0.25)";
      fc.lineWidth = 1;
      for (const { ground } of ridges) {
        path(fc, ground);
        fc.stroke();
      }
      for (const { s, ridge } of ridges) {
        if (lifted) curtain(fc, ridge, dense);
        if (sparse) {
          path(fc, ridge.points);
          fc.strokeStyle = "rgba(255, 255, 255, 0.75)";
          fc.lineWidth = lifted ? 3.6 : 4.4;
          fc.stroke();
        }
        strokeRuns(fc, ridge.points, ridge.levels, lifted ? 2 : 2.6);
        drawn.push({ segment: s, points: ridge.points, ridge });
      }
      const usedStops = new Set(segments.flatMap((s) => [s.fromId, s.toId])),
        keys = new Set(),
        dot =
          (scene?.heightScale ?? 1) > 5
            ? 1.4
            : camera.scale / camera.base > 1.6
              ? 2.6
              : 1.9;
      fc.beginPath();
      for (const s of scene?.stops ?? []) {
        if (!usedStops.has(s.id)) continue;
        const xy = p.project(s.world);
        if (
          !xy ||
          xy[0] < 0 ||
          xy[0] > view.width ||
          xy[1] < 0 ||
          xy[1] > view.height
        )
          continue;
        const k = xy.map((v) => Math.round(v / 4)).join(",");
        if (keys.has(k)) continue;
        keys.add(k);
        fc.moveTo(xy[0] + dot, xy[1]);
        fc.arc(...xy, dot, 0, Math.PI * 2);
      }
      fc.fillStyle = "#fff";
      fc.lineWidth = 1.6;
      fc.strokeStyle = "rgba(255, 255, 255, 0.85)";
      fc.stroke();
      fc.fillStyle = "#20272b";
      fc.fill();
      foregroundKey = fgKey;
      foregroundSegments = segments;
      indexPaths(view);
    }
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.fillStyle = basemap.paper;
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.drawImage(back, 0, 0, view.width, view.height);
    const selectedItem =
      selected && drawn.find((item) => item.segment.id === selected);
    ctx.save();
    ctx.globalAlpha = selectedItem ? 0.2 : 1;
    ctx.drawImage(front, 0, 0, view.width, view.height);
    ctx.restore();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const id of new Set([hovered, selected])) {
      if (!id) continue;
      const item =
        id === selected ? selectedItem : drawn.find((s) => s.segment.id === id);
      if (!item) continue;
      path(ctx, item.points);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 6;
      ctx.stroke();
      strokeRuns(
        ctx,
        item.points,
        item.ridge.levels,
        id === selected ? 3.4 : 2.8,
      );
    }
    if (selected) {
      const segment = segments.find((s) => s.id === selected);
      if (segment) {
        const ends = [segment.fromId, segment.toId].map((id) =>
          scene.stops.find((s) => s.id === id),
        );
        const screen = ends.map((stop) => stop && p.project(stop.world));
        if (
          screen.every(Boolean) &&
          Math.hypot(screen[0][0] - screen[1][0], screen[0][1] - screen[1][1]) >
            30
        ) {
          screen.forEach((xy, i) => {
            ctx.beginPath();
            ctx.arc(...xy, 8, 0, Math.PI * 2);
            ctx.fillStyle = "#1d2427";
            ctx.fill();
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.font = "700 10px system-ui";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#fff";
            ctx.fillText(i ? "B" : "A", xy[0], xy[1]);
            ctx.textBaseline = "alphabetic";
          });
        }
      }
    }
    if (stop) {
      const xy = p.project(stop.world);
      if (xy) {
        ctx.beginPath();
        ctx.arc(...xy, 7, 0, Math.PI * 2);
        ctx.fillStyle = "#1d2427";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.font = "600 12px system-ui";
        ctx.textAlign = "center";
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 4;
        ctx.strokeText(stop.label.slice(0, 36), xy[0], xy[1] - 17);
        ctx.fillStyle = "#1d2427";
        ctx.fillText(stop.label.slice(0, 36), xy[0], xy[1] - 17);
      }
    }
    const stats = {
      streets,
      segments: drawn.length,
      renderMs: (performance.now() - started).toFixed(1),
      backgroundHit,
      foregroundHit,
      scale: scaleBar(camera, view),
    };
    Object.assign(canvas.dataset, {
      streetCount: String(streets),
      segmentCount: String(drawn.length),
      renderMs: stats.renderMs,
      backgroundCacheHit: String(backgroundHit),
      foregroundCacheHit: String(foregroundHit),
      selectionVisible: String(Boolean(selectedItem)),
      contextOpacity: String(selectedItem ? 0.2 : 1),
      camera: [
        camera.x,
        camera.y,
        camera.scale,
        camera.bearing,
        camera.pitch,
      ].join(","),
    });
    return stats;
  }
  function nearest(x, y) {
    let best = null,
      distance = 9;
    for (const index of grid.get(
      Math.floor(x / 64) + "," + Math.floor(y / 64),
    ) ?? []) {
      const item = drawn[index];
      for (let i = 1; i < item.points.length; i++) {
        const a = item.points[i - 1],
          b = item.points[i];
        if (!a || !b) continue;
        const dx = b[0] - a[0],
          dy = b[1] - a[1],
          den = dx * dx + dy * dy,
          t = den
            ? Math.max(
                0,
                Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / den),
              )
            : 0,
          d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
        if (d < distance) {
          distance = d;
          best = item.segment;
        }
      }
    }
    return best;
  }
  return { draw, nearest, setLabelExclusions };
}
