import { projection, scaleBar } from "./camera.mjs";
import { buildStopIndex } from "./explorer.mjs";
const palette = ["#9e3530", "#c18a30", "#8d9c5e", "#528b78"];
const speedColor = (kmh) =>
  palette[kmh < 10 ? 0 : kmh < 15 ? 1 : kmh < 25 ? 2 : 3];
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
    labels = (source.basemap?.labels ?? [])
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
function drawBackground(ctx, scene, p, view) {
  const { width, height } = view,
    visible = [];
  ctx.fillStyle = "#edf0ea";
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
          ? "#dbe7e7"
          : f.kind === "green"
            ? "#e1e7dc"
            : "#e8ebe5";
      ctx.fill();
    } else if (f.kind === "water") {
      ctx.strokeStyle = "#d4e2e3";
      ctx.lineWidth = f.class === "river" ? 15 : 6;
      ctx.stroke();
    }
  }
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const f of visible) {
    if (f.kind !== "road") continue;
    path(ctx, f.screen);
    ctx.strokeStyle = "#dce1da";
    ctx.lineWidth = roadWidth(f.class) + 1;
    ctx.stroke();
    ctx.strokeStyle = "#fbfcf9";
    ctx.lineWidth = roadWidth(f.class);
    ctx.stroke();
  }
  const labels = [],
    names = new Set(),
    fits = (x, y, w) => {
      if (x < w / 2 + 8 || x > width - w / 2 - 8 || y < 46 || y > height - 50)
        return false;
      if (
        labels.some(
          (b) =>
            Math.abs(x - b.x) < (w + b.w) / 2 + 12 && Math.abs(y - b.y) < 19,
        )
      )
        return false;
      labels.push({ x, y, w });
      return true;
    };
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const label of scene.labels) {
    const xy = p.project(label.point);
    if (!xy) continue;
    const major = /city|town/.test(label.class),
      text = label.name.slice(0, 50);
    ctx.font = (major ? "600 13px" : "500 11px") + " system-ui";
    if (!fits(...xy, ctx.measureText(text).width)) continue;
    ctx.strokeStyle = "#f8faf4";
    ctx.lineWidth = 4;
    ctx.strokeText(text, ...xy);
    ctx.fillStyle = major ? "#5c6c59" : "#788672";
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
    if (!a || !b || !mid || Math.hypot(b[0] - a[0], b[1] - a[1]) < 130)
      continue;
    const text = f.name.slice(0, 60);
    ctx.font = "10px system-ui";
    if (!fits(...mid, ctx.measureText(text).width)) continue;
    ctx.strokeStyle = "#f7f9f3";
    ctx.lineWidth = 3;
    ctx.strokeText(text, ...mid);
    ctx.fillStyle = "#7b8679";
    ctx.fillText(text, ...mid);
    names.add(f.name);
    if (names.size >= 22) break;
  }
  return visible.filter((f) => f.kind === "road").length;
}
function ridgePoints(s, band, p, relief) {
  const points = [],
    total = s.lengths.at(-1) || 1,
    height = Math.min(60 / s.bands[band].kmh, 12) * 30 * relief;
  // Graphic interpolation encodes segment min/km, never observed speed within a segment.
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1],
      b = s.points[i],
      steps = Math.max(
        1,
        Math.ceil(((s.lengths[i] - s.lengths[i - 1]) / total) * 18),
      );
    for (let j = 0; j < steps; j++) {
      const t = j / steps,
        progress =
          (s.lengths[i - 1] + (s.lengths[i] - s.lengths[i - 1]) * t) / total;
      points.push(
        p.project(
          [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
          height * Math.sin(progress * Math.PI) ** 2,
        ),
      );
    }
  }
  points.push(p.project(s.points.at(-1)));
  return points;
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
    streets = 0;
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
    sizeLayer(canvas, ctx, view.width, view.height, ratio);
    sizeLayer(back, bc, view.width, view.height, ratio);
    sizeLayer(front, fc, view.width, view.height, ratio);
    const backgroundHit = backgroundScene === scene && backgroundKey === key;
    if (!backgroundHit) {
      bc.clearRect(0, 0, view.width, view.height);
      streets = scene ? drawBackground(bc, scene, p, view) : 0;
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
      for (const s of ordered) {
        const ground = s.points.map((point) => p.project(point)),
          points = ridgePoints(s, band, p, camera.pitch ? relief : 0);
        if (
          !onScreen(ground, view.width, view.height) &&
          !onScreen(points, view.width, view.height)
        )
          continue;
        path(fc, ground);
        fc.strokeStyle = "#b5c2ad";
        fc.lineWidth = 1.4;
        fc.stroke();
        path(fc, points);
        fc.strokeStyle = speedColor(s.bands[band].kmh);
        fc.lineWidth = 1.65;
        fc.stroke();
        drawn.push({ segment: s, points });
      }
      const usedStops = new Set(segments.flatMap((s) => [s.fromId, s.toId])),
        keys = new Set();
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
        const k = xy.map((v) => Math.round(v / 3)).join(",");
        if (keys.has(k)) continue;
        keys.add(k);
        fc.beginPath();
        fc.arc(...xy, 1.25, 0, Math.PI * 2);
        fc.fillStyle = "#46594b";
        fc.fill();
      }
      foregroundKey = fgKey;
      foregroundSegments = segments;
      indexPaths(view);
    }
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.fillStyle = "#edf0ea";
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
      ctx.strokeStyle = speedColor(item.segment.bands[band].kmh);
      ctx.lineWidth = id === selected ? 3.3 : 2.6;
      ctx.stroke();
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
            ctx.fillStyle = "#264b3e";
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
        ctx.fillStyle = "#264b3e";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.font = "600 12px system-ui";
        ctx.textAlign = "center";
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 4;
        ctx.strokeText(stop.label.slice(0, 36), xy[0], xy[1] - 17);
        ctx.fillStyle = "#223b30";
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
  return { draw, nearest };
}
