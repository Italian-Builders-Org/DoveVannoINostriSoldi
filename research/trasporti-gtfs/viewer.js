"use strict";
const $ = (id) => document.getElementById(id),
  manifest = JSON.parse($("data").textContent),
  canvas = $("map"),
  ctx = canvas.getContext("2d");
const fmt = (n, d = 1) =>
    new Intl.NumberFormat("it-IT", { maximumFractionDigits: d }).format(n),
  make = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  },
  add = (parent, tag, text, cls) => {
    const n = make(tag, text, cls);
    parent.append(n);
    return n;
  };
const link = (parent, label, url) => {
  const n = add(parent, "a", label);
  n.href = url;
  n.target = "_blank";
  n.rel = "noopener noreferrer";
  return n;
};
const option = (value, label) => {
  const n = make("option", label);
  n.value = value;
  return n;
};
const palette = ["#9e3530", "#c18a30", "#8d9c5e", "#528b78"];
const color = (s) =>
  palette[
    s.bands[band].kmh < 10
      ? 0
      : s.bands[band].kmh < 15
        ? 1
        : s.bands[band].kmh < 25
          ? 2
          : 3
  ];
let current = null,
  city = null,
  band = "morning",
  route = "",
  selected = null,
  hovered = null,
  shown = [],
  tablePage = 0,
  mode3d = true,
  frame = 0,
  requestId = 0,
  W = 1000,
  H = 650,
  drawn = [];
const cache = new Map(),
  cam = { x: 0, y: 0, scale: 0.15, bearing: (-20 * Math.PI) / 180 },
  controlIds = [
    "band",
    "route",
    "mode3d",
    "mode2d",
    "center",
    "fit",
    "zoom-in",
    "zoom-out",
    "reset",
  ];
let baseScale = 0.15;
function notice(message) {
  $("notice").hidden = !message;
  $("notice").textContent = message || "";
}
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
function prepare(source) {
  const world = worldFactory(source.focus),
    feature = (f) => ({ ...f, points: f.coordinates.map(world) });
  const features = (source.basemap?.features ?? []).map(feature),
    segments = source.segments.map((s) => {
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
  return {
    source,
    features,
    segments,
    labels: (source.basemap?.labels ?? []).map((label) => ({
      ...label,
      point: world(label.point),
    })),
  };
}
async function decodeCity(id) {
  if (cache.has(id)) {
    const value = cache.get(id);
    cache.delete(id);
    cache.set(id, value);
    return value;
  }
  if (typeof DecompressionStream !== "function")
    throw Error(
      "Questo browser non supporta gli archivi compressi del prototipo.",
    );
  const block = $("city-" + id);
  if (!block) throw Error("Archivio della città non disponibile.");
  const bytes = Uint8Array.from(atob(block.textContent.trim()), (c) =>
    c.charCodeAt(0),
  );
  const text = await new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).text();
  const value = prepare(JSON.parse(text));
  cache.set(id, value);
  while (cache.size > 2) cache.delete(cache.keys().next().value);
  return value;
}
async function selectCity(id) {
  const token = ++requestId;
  controlIds.forEach((id) => ($(id).disabled = true));
  notice("Preparazione della mappa…");
  try {
    const value = await decodeCity(id);
    if (token !== requestId) return;
    current = value;
    city = value.source;
    selected = null;
    tablePage = 0;
    hovered = null;
    route = "";
    $("route").replaceChildren(option("", "Tutte le linee"));
    for (const name of [...new Set(city.segments.map((s) => s.route))].sort(
      (a, b) => a.localeCompare(b, "it", { numeric: true }),
    ))
      $("route").append(option(name, "Linea " + name));
    $("reference").textContent = new Date(
      city.serviceDate + "T12:00:00",
    ).toLocaleDateString("it-IT", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    $("mode-label").textContent =
      city.mode === "bus" ? "Autobus e filobus" : "Tram";
    sourceInfo();
    home();
    updateData();
    controlIds.forEach((id) => ($(id).disabled = false));
    notice(
      city.status !== "ready"
        ? "Il feed acquisito non contiene corse utilizzabili per questa data. Non viene usato un giorno diverso."
        : !city.basemap
          ? "Sfondo cartografico non acquisito per questa città."
          : null,
    );
  } catch (error) {
    if (token === requestId) {
      current = null;
      city = null;
      shown = [];
      $("rows").replaceChildren();
      $("inspector").hidden = true;
      notice(error.message);
      $("map-title").textContent = "Mappa non disponibile";
      schedule();
    }
  }
}
function sourceInfo() {
  const p = $("source");
  p.replaceChildren();
  if (city.attribution)
    link(add(p, "p"), city.attribution, city.attributionUrl);
  else add(p, "p", city.holder);
  link(add(p, "p"), "Feed e documentazione ufficiale ↗", city.landingUrl);
  add(
    p,
    "p",
    "Servizio: " +
      new Date(city.serviceDate + "T12:00:00").toLocaleDateString("it-IT"),
  );
  add(
    p,
    "p",
    "Acquisito: " + new Date(city.receipt.acquiredAt).toLocaleString("it-IT"),
  );
  const q = $("quality");
  q.replaceChildren();
  add(
    q,
    "p",
    "Corse programmate nel feed: " +
      fmt(city.coverage.activeScheduledTrips ?? 0, 0) +
      ". Linee attive: " +
      fmt(city.coverage.activeRoutes ?? 0, 0) +
      " su " +
      fmt(city.coverage.routesInFeed ?? 0, 0) +
      ".",
  );
  add(
    q,
    "p",
    "Con tratti utilizzabili: " +
      fmt(city.coverage.analyzedScheduledTrips ?? 0, 0) +
      " corse, " +
      fmt(city.coverage.analyzedRoutes ?? 0, 0) +
      " linee.",
  );
  if (city.studyBounds)
    add(
      q,
      "p",
      "Area di studio: " +
        city.studyBounds.join(", ") +
        " (ovest, sud, est, nord). Sono incluse solo coppie con entrambe le fermate al suo interno.",
    );
  const labels = {
    candidate_pairs: "Coppie esaminate",
    accepted_pairs: "Coppie incluse",
    outside_study_area: "Coppie fuori area",
    frequency_trip: "Corse a frequenza non espanse",
    missing_shape: "Corse senza tracciato",
    trip_without_stop_pairs: "Corse con meno di due fermate",
    missing_time: "Coppie senza orari utilizzabili",
    nonpositive_time: "Coppie con tempo nullo/negativo",
    missing_geometry_pair: "Coppie senza geometria utilizzabile",
    implausible_speed_above_150_kmh: "Coppie oltre 150 km/h, escluse",
    unlocated_or_nonprogressing_pair:
      "Coppie non collocabili nei percorsi unici",
    short_geometry_pair: "Tratti sotto 25 m nei percorsi unici",
  };
  const ul = add(q, "ul");
  for (const [key, value] of Object.entries(city.exclusions))
    if (value) add(ul, "li", (labels[key] ?? key) + ": " + fmt(value, 0));
  if (city.segments.some((s) => s.estimated))
    add(
      q,
      "p",
      "Sono presenti orari marcati come stimati (timepoint=0). Gli altri non sono per questo osservazioni reali.",
    );
  const receipt = $("receipt");
  receipt.replaceChildren();
  add(
    receipt,
    "p",
    city.license === "not-declared"
      ? "Licenza del feed da verificare prima della pubblicazione."
      : city.license,
  );
  if (city.licenseUrl) link(receipt, "Condizioni del feed ↗", city.licenseUrl);
  add(receipt, "p", "GTFS SHA-256 " + city.receipt.sha256, "hash");
  if (city.basemap) {
    add(
      receipt,
      "p",
      "Cartografia: OpenStreetMap, ODbL 1.0. Estratto del " +
        new Date(city.basemap.receipt.acquiredAt).toLocaleDateString("it-IT") +
        ".",
    );
    link(receipt, "Attribuzione e licenza OSM ↗", city.basemap.licenseUrl);
    add(
      receipt,
      "p",
      "Perimetro OSM: " + city.basemap.receipt.bounds.join(", "),
    );
    add(receipt, "p", "OSM SHA-256 " + city.basemap.receipt.sha256, "hash");
  }
  $("area-label").textContent =
    city.mode === "bus" && city.studyBounds
      ? "Area di studio urbana"
      : "Orari pubblicati · tracciati GTFS";
}
function updateData() {
  if (!current) return;
  shown = current.segments
    .filter((s) => s.bands[band] && (!route || s.route === route))
    .sort(
      (a, b) =>
        a.bands[band].kmh - b.bands[band].kmh || a.id.localeCompare(b.id),
    );
  $("map-title").textContent = city.name + (route ? " · linea " + route : "");
  tablePage = Math.max(
    0,
    Math.min(tablePage, Math.ceil(shown.length / 20) - 1),
  );
  const start = tablePage * 20;
  $("page-previous").disabled = tablePage === 0;
  $("page-next").disabled = start + 20 >= shown.length;
  $("pages").hidden = !shown.length;
  $("coverage").textContent = shown.length
    ? fmt(start + 1, 0) +
      "–" +
      fmt(Math.min(start + 20, shown.length), 0) +
      " di " +
      fmt(shown.length, 0) +
      " tratti"
    : "Nessun tratto confrontabile nella selezione";
  const tbody = $("rows");
  tbody.replaceChildren();
  for (const s of shown.slice(start, start + 20)) {
    const row = add(tbody, "tr"),
      td = add(row, "td"),
      button = add(td, "button", s.route);
    button.type = "button";
    button.setAttribute(
      "aria-label",
      "Seleziona linea " + s.route + ", " + s.from + " verso " + s.to,
    );
    button.onclick = () => {
      inspect(s);
      focusSegment(s);
      canvas.scrollIntoView({ block: "center", behavior: "instant" });
    };
    add(row, "td", s.from + " → " + s.to);
    add(row, "td", fmt(s.bands[band].kmh));
    add(row, "td", fmt(s.bands[band].samples, 0));
  }
  const existing = shown.find((s) => s.id === selected);
  inspect(existing ?? null);
  schedule();
}
function inspect(s) {
  selected = s?.id ?? null;
  const p = $("inspector");
  p.replaceChildren();
  p.hidden = !s;
  if (!s) {
    schedule();
    return;
  }
  const close = add(p, "button", "×", "close-detail");
  close.type = "button";
  close.setAttribute("aria-label", "Chiudi dettaglio");
  close.onclick = () => {
    inspect(null);
    canvas.focus({ preventScroll: true });
  };
  add(p, "span", "Linea " + s.route, "route-badge");
  add(p, "p", s.from + " → " + s.to, "trip");
  const value = add(p, "div", fmt(s.bands[band].kmh), "metric");
  add(value, "span", " km/h");
  add(p, "p", "Velocità prevista dal tempo mediano", "metric-label");
  const dl = add(p, "dl");
  for (const [label, value] of [
    ["Tempo previsto", fmt(s.bands[band].seconds / 60) + " min"],
    ["Distanza sul tracciato", fmt(s.metres, 0) + " m"],
    ["Corse nella fascia", fmt(s.bands[band].samples, 0)],
    ["Direzione GTFS", s.direction || "non indicata"],
  ]) {
    const row = add(dl, "div");
    add(row, "dt", label);
    add(row, "dd", value);
  }
  if (s.from.toLocaleLowerCase() === s.to.toLocaleLowerCase())
    add(
      p,
      "p",
      "Fermate omonime: può includere manovre o capolinea.",
      "detail-note",
    );
  schedule();
}
function parameters() {
  const pitch = mode3d ? (55 * Math.PI) / 180 : 0;
  return {
    sin: Math.sin(cam.bearing),
    cos: Math.cos(cam.bearing),
    cp: Math.cos(pitch),
    sp: Math.sin(pitch),
    distance: H / (0.8 * cam.scale),
  };
}
function project(point, height = 0) {
  const p = parameters(),
    dx = point[0] - cam.x,
    dy = point[1] - cam.y,
    x = dx * p.cos - dy * p.sin,
    y = dx * p.sin + dy * p.cos,
    den = p.distance + y * p.sp - height * p.cp;
  if (den < p.distance * 0.12) return null;
  const f = p.distance / den;
  return [
    W * 0.5 + x * cam.scale * f,
    H * 0.53 - (y * p.cp + height * p.sp) * cam.scale * f,
  ];
}
function unproject(x, y) {
  const p = parameters(),
    sx = x - W * 0.5,
    sy = y - H * 0.53,
    den = p.cp * cam.scale * p.distance + sy * p.sp;
  if (Math.abs(den) < 1e-8) return [cam.x, cam.y];
  const ry = (-sy * p.distance) / den,
    f = p.distance / (p.distance + ry * p.sp),
    rx = sx / (cam.scale * f);
  return [cam.x + rx * p.cos + ry * p.sin, cam.y - rx * p.sin + ry * p.cos];
}
function offscreen(points) {
  return (
    !points.some(
      (p) => p && p[0] > -50 && p[0] < W + 50 && p[1] > -50 && p[1] < H + 50,
    ) &&
    !points.some(
      (p, i) =>
        p &&
        points[i + 1] &&
        Math.min(p[0], points[i + 1][0]) < W &&
        Math.max(p[0], points[i + 1][0]) > 0 &&
        Math.min(p[1], points[i + 1][1]) < H &&
        Math.max(p[1], points[i + 1][1]) > 0,
    )
  );
}
function screenPath(points) {
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
function roadWidth(kind) {
  if (/motorway|trunk/.test(kind)) return 5;
  if (/primary|secondary/.test(kind)) return 4;
  if (/tertiary/.test(kind)) return 2.8;
  return 1.6;
}
function draw() {
  frame = 0;
  if (!ctx) return;
  const started = performance.now(),
    ratio = Math.min(window.devicePixelRatio || 1, 2);
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  if (
    canvas.width !== Math.round(W * ratio) ||
    canvas.height !== Math.round(H * ratio)
  ) {
    canvas.width = Math.round(W * ratio);
    canvas.height = Math.round(H * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#edf0ea";
  ctx.fillRect(0, 0, W, H);
  drawn = [];
  if (!current) {
    canvas.dataset.segmentCount = "0";
    canvas.dataset.streetCount = "0";
    return;
  }
  const visible = [];
  for (const feature of current.features) {
    const points = feature.points.map((p) => project(p));
    if (offscreen(points)) continue;
    visible.push({ ...feature, screen: points });
  }
  for (const f of visible) {
    if (f.kind === "road") continue;
    screenPath(f.screen);
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
  for (const f of visible) {
    if (f.kind !== "road") continue;
    screenPath(f.screen);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#dce1da";
    ctx.lineWidth = roadWidth(f.class) + 1;
    ctx.stroke();
    ctx.strokeStyle = "#fbfcf9";
    ctx.lineWidth = roadWidth(f.class);
    ctx.stroke();
  }
  const labels = [];
  const fitsLabel = (x, y, w) => {
    if (x < w / 2 + 5 || x > W - w / 2 - 5 || y < 45 || y > H - 45)
      return false;
    if (
      labels.some(
        (b) => Math.abs(x - b.x) < (w + b.w) / 2 + 12 && Math.abs(y - b.y) < 18,
      )
    )
      return false;
    labels.push({ x, y, w });
    return true;
  };
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const names = new Set();
  for (const f of visible) {
    if (
      f.kind !== "road" ||
      !f.name ||
      !/^(primary|secondary|tertiary)$/.test(f.class) ||
      names.has(f.name)
    )
      continue;
    const a = f.screen.find(Boolean),
      b = f.screen.findLast(Boolean);
    if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) < 130) continue;
    const mid = f.screen[Math.floor(f.screen.length / 2)];
    if (!mid) continue;
    const text = f.name.slice(0, 60);
    ctx.font = "9px system-ui";
    const width = ctx.measureText(text).width;
    if (!fitsLabel(mid[0], mid[1], width)) continue;
    ctx.strokeStyle = "#f7f9f3";
    ctx.lineWidth = 3;
    ctx.strokeText(text, ...mid);
    ctx.fillStyle = "#899084";
    ctx.fillText(text, ...mid);
    names.add(f.name);
    if (names.size > 22) break;
  }
  for (const label of current.labels) {
    const p = project(label.point);
    if (!p) continue;
    const major = /city|town/.test(label.class);
    ctx.font = (major ? "600 12px" : "500 10px") + " system-ui";
    const text = label.name.slice(0, 50),
      width = ctx.measureText(text).width;
    if (!fitsLabel(...p, width)) continue;
    ctx.strokeStyle = "#f8faf4";
    ctx.lineWidth = 4;
    ctx.strokeText(text, ...p);
    ctx.fillStyle = major ? "#697467" : "#87917e";
    ctx.fillText(text, ...p);
  }
  const ordered = [...shown].sort(
    (a, b) =>
      (project(a.points[0]) ?? [0, 0])[1] - (project(b.points[0]) ?? [0, 0])[1],
  );
  const stopKeys = new Set();
  for (const s of ordered) {
    const ground = s.points.map((p) => project(p));
    if (offscreen(ground)) continue;
    screenPath(ground);
    ctx.strokeStyle = "#bec8b5";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const coords = [],
      total = s.lengths.at(-1) || 1;
    // The graphic height is an encoding of scheduled min/km, not geographic elevation.
    const height = mode3d ? Math.min(60 / s.bands[band].kmh, 12) * 30 : 0;
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
        coords.push(
          project(
            [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
            height * Math.sin(progress * Math.PI) ** 2,
          ),
        );
      }
    }
    coords.push(project(s.points.at(-1)));
    if (s.id === selected) {
      screenPath(coords);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 6;
      ctx.stroke();
    }
    screenPath(coords);
    ctx.strokeStyle = color(s);
    ctx.lineWidth = s.id === selected || s.id === hovered ? 3.2 : 1.65;
    ctx.stroke();
    drawn.push({ segment: s, points: coords });
    for (const p of [ground[0], ground.at(-1)])
      if (p) {
        const key = p.map((v) => Math.round(v / 3)).join(",");
        if (stopKeys.has(key)) continue;
        stopKeys.add(key);
        ctx.beginPath();
        ctx.arc(...p, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = "#4c5950";
        ctx.fill();
      }
  }
  if (!city.basemap) {
    ctx.font = "13px system-ui";
    ctx.fillStyle = "#61705d";
    ctx.textAlign = "left";
    ctx.fillText("Sfondo cartografico non acquisito", 20, H - 70);
  }
  canvas.dataset.streetCount = String(
    visible.filter((f) => f.kind === "road").length,
  );
  canvas.dataset.segmentCount = String(drawn.length);
  canvas.dataset.renderMs = (performance.now() - started).toFixed(1);
  canvas.dataset.camera = [cam.x, cam.y, cam.scale, cam.bearing, mode3d].join(
    ",",
  );
}
function schedule() {
  if (!frame) frame = requestAnimationFrame(draw);
}
function syncControls() {
  $("bearing").value = Math.round((cam.bearing * 180) / Math.PI);
  $("zoom").value = Math.round((cam.scale / baseScale) * 100);
}
function home() {
  cam.x = 0;
  cam.y = 0;
  cam.bearing = (-20 * Math.PI) / 180;
  baseScale =
    Math.min(canvas.clientWidth / 6500, canvas.clientHeight / 4300) * 1.4;
  cam.scale = baseScale;
  syncControls();
  schedule();
}
function fit() {
  if (!shown.length) return;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of shown)
    for (const p of s.points) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
  cam.x = (minX + maxX) / 2;
  cam.y = (minY + maxY) / 2;
  cam.bearing = 0;
  cam.scale =
    Math.min(
      (W - 80) / (maxX - minX + 1),
      (H - 130) /
        ((maxY - minY) * Math.cos(mode3d ? (55 * Math.PI) / 180 : 0) + 500),
    ) * 0.8;
  syncControls();
  schedule();
}
function focusSegment(s) {
  const p = s.points[Math.floor(s.points.length / 2)];
  cam.x = p[0];
  cam.y = p[1];
  cam.scale = Math.max(cam.scale, baseScale);
  syncControls();
  schedule();
}
function pan(dx, dy) {
  const p = parameters();
  cam.x += (-dx * p.cos + (dy / p.cp) * p.sin) / cam.scale;
  cam.y += (dx * p.sin + (dy / p.cp) * p.cos) / cam.scale;
  syncControls();
  schedule();
}
function zoomBy(factor, x = W / 2, y = H / 2) {
  const anchor = unproject(x, y);
  cam.scale = Math.max(0.008, Math.min(1.5, cam.scale * factor));
  const next = unproject(x, y);
  cam.x += anchor[0] - next[0];
  cam.y += anchor[1] - next[1];
  syncControls();
  schedule();
}
function setMode(value) {
  mode3d = value;
  $("mode3d").setAttribute("aria-pressed", String(value));
  $("mode2d").setAttribute("aria-pressed", String(!value));
  schedule();
}
function nearest(x, y) {
  let best = null,
    distance = 8;
  for (const candidate of drawn) {
    for (let i = 1; i < candidate.points.length; i++) {
      const a = candidate.points[i - 1],
        b = candidate.points[i];
      if (!a || !b) continue;
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        den = dx * dx + dy * dy,
        t = den
          ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / den))
          : 0,
        d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
      if (d < distance) {
        distance = d;
        best = candidate.segment;
      }
    }
  }
  return best;
}
function pointerPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
const pointers = new Map();
let gestureMoved = false,
  gestureStart = null,
  pinchDistance = null;
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId);
  const p = pointerPoint(event);
  pointers.set(event.pointerId, p);
  gestureMoved = pointers.size > 1;
  gestureStart = p;
  pinchDistance = null;
  canvas.classList.add("dragging");
  $("map-tip").hidden = true;
});
canvas.addEventListener("pointermove", (event) => {
  const p = pointerPoint(event);
  if (pointers.has(event.pointerId)) {
    const previous = pointers.get(event.pointerId);
    pointers.set(event.pointerId, p);
    if (pointers.size === 2) {
      gestureMoved = true;
      const [a, b] = [...pointers.values()],
        distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance && distance > 0)
        zoomBy(distance / pinchDistance, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinchDistance = distance;
    } else {
      if (
        gestureStart &&
        Math.hypot(p.x - gestureStart.x, p.y - gestureStart.y) > 4
      )
        gestureMoved = true;
      if (gestureMoved) {
        if (event.shiftKey) {
          cam.bearing += (p.x - previous.x) * 0.008;
          syncControls();
          schedule();
        } else pan(p.x - previous.x, p.y - previous.y);
      }
    }
    return;
  }
  const s = nearest(p.x, p.y);
  if (hovered !== s?.id) {
    hovered = s?.id ?? null;
    schedule();
  }
  const tip = $("map-tip");
  tip.hidden = !s;
  if (s) {
    tip.textContent =
      "Linea " + s.route + " · " + fmt(s.bands[band].kmh) + " km/h";
    tip.style.left = Math.max(8, Math.min(W - 220, p.x + 12)) + "px";
    tip.style.top = Math.max(8, p.y - 35) + "px";
  }
});
function endPointer(event, cancelled = false) {
  const p = pointerPoint(event);
  if (!cancelled && !gestureMoved && pointers.size === 1)
    inspect(nearest(p.x, p.y));
  pointers.delete(event.pointerId);
  pinchDistance = null;
  if (!pointers.size) {
    canvas.classList.remove("dragging");
    gestureStart = null;
  }
}
canvas.addEventListener("pointerup", (event) => endPointer(event));
canvas.addEventListener("pointercancel", (event) => endPointer(event, true));
canvas.addEventListener("pointerleave", () => {
  if (!pointers.size) {
    $("map-tip").hidden = true;
    hovered = null;
    schedule();
  }
});
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const p = pointerPoint(event);
    zoomBy(Math.exp(-event.deltaY * 0.0015), p.x, p.y);
  },
  { passive: false },
);
canvas.addEventListener("keydown", (event) => {
  if (
    [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "+",
      "=",
      "-",
      "Home",
      "Escape",
    ].includes(event.key)
  )
    event.preventDefault();
  if (event.shiftKey && event.key.startsWith("Arrow")) {
    cam.bearing += ((event.key === "ArrowLeft" ? -1 : 1) * Math.PI) / 18;
    syncControls();
    schedule();
    return;
  }
  if (event.key === "ArrowLeft") pan(60, 0);
  if (event.key === "ArrowRight") pan(-60, 0);
  if (event.key === "ArrowUp") pan(0, 60);
  if (event.key === "ArrowDown") pan(0, -60);
  if (event.key === "+" || event.key === "=") zoomBy(1.25);
  if (event.key === "-") zoomBy(0.8);
  if (event.key === "Home") home();
  if (event.key === "Escape") inspect(null);
});
$("city").onchange = () => selectCity($("city").value);
$("band").onchange = () => {
  band = $("band").value;
  tablePage = 0;
  updateData();
};
$("route").onchange = () => {
  route = $("route").value;
  tablePage = 0;
  updateData();
  if (route) fit();
  else home();
};
$("page-previous").onclick = () => {
  tablePage--;
  updateData();
};
$("page-next").onclick = () => {
  tablePage++;
  updateData();
};
$("mode3d").onclick = () => setMode(true);
$("mode2d").onclick = () => setMode(false);
$("center").onclick = home;
$("reset").onclick = () => {
  setMode(true);
  home();
};
$("fit").onclick = fit;
$("zoom-in").onclick = () => zoomBy(1.3);
$("zoom-out").onclick = () => zoomBy(1 / 1.3);
$("bearing").oninput = () => {
  cam.bearing = (Number($("bearing").value) * Math.PI) / 180;
  schedule();
};
$("zoom").oninput = () => {
  cam.scale = (baseScale * Number($("zoom").value)) / 100;
  schedule();
};
new ResizeObserver(schedule).observe(canvas);
for (const c of manifest.cities)
  $("city").append(
    option(
      c.id,
      c.name + (c.status === "ready" ? "" : " · dati non disponibili"),
    ),
  );
$("city").disabled = false;
$("city").value = manifest.cities.some((c) => c.id === "torino")
  ? "torino"
  : manifest.cities[0].id;
selectCity($("city").value);
