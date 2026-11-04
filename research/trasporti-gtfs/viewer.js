import { mapImage } from "./map-export.mjs";
import { groupAreas, sourceForArea, modeLabel } from "./catalog.mjs";
import {
  enhanceSelect,
  syncSelectMenus,
  closeSelectMenu,
} from "./select-menu.mjs";
import {
  baseScale,
  normalizeBearing,
  zoomCamera,
  zoomLimits,
  panCamera,
  fitCamera,
  resizeCamera,
  transformCamera,
} from "./camera.mjs";
import {
  searchStops,
  selectSegments,
  selectionCSV,
  stopLabel,
} from "./explorer.mjs";
import { enhanceDisclosure, finishDisclosures } from "./disclosure.mjs";
import { readView, viewURL } from "./view-state.mjs";
import {
  prepareScene,
  createRenderer,
  speedColor,
  ridgeHeight,
} from "./renderer.mjs";
import {
  networkProfile,
  speedHistogram,
  slowestSegments,
  bandComparison,
  kmhColor,
} from "./insights.mjs";
const $ = (id) => document.getElementById(id),
  manifest = JSON.parse($("data").textContent),
  canvas = $("map"),
  shell = $("map-shell"),
  renderer = createRenderer(canvas);
const fmt = (n, d = 1) =>
    new Intl.NumberFormat("it-IT", { maximumFractionDigits: d }).format(n),
  licenseReceiptLine = (city) => {
    const lines = [];
    if (city.publicationVerdict === "RESTRICTED")
      lines.push(
        "Audit licenza: riuso pubblico del feed segnalato come limitato dal titolare (RESTRICTED). Le misure restano attribuite al GTFS ufficiale; verificare condizioni prima di redistribuire dati derivati.",
      );
    else if (city.publicationVerdict === "UNKNOWN")
      lines.push(
        "Audit licenza: condizioni di riuso non verificate in catalogo (UNKNOWN). Controllare titolare e pagina ufficiale prima di redistribuire dati derivati.",
      );
    if (city.license === "not-declared")
      lines.push(
        "Licenza non dichiarata nel campo dataset; verificare condizioni di riuso sulla pagina ufficiale.",
      );
    else if (/non commerciale/i.test(String(city.license)))
      lines.push(city.license + " — rispettare attribuzione e limiti del titolare.");
    else lines.push("Dati: " + city.license);
    return lines.join(" ");
  },
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
    let href = null;
    if (typeof url === "string") {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:")
          href = parsed.href;
      } catch {
        href = null;
      }
    }
    if (!href) return add(parent, "span", label);
    const n = add(parent, "a", label);
    n.href = href;
    n.target = "_blank";
    n.rel = "noopener noreferrer";
    return n;
  },
  option = (value, label) => {
    const n = make("option", label);
    n.value = value;
    return n;
  };
const view = () => ({ width: canvas.clientWidth, height: canvas.clientHeight });
let lastView = view(),
  cam = {
    x: 0,
    y: 0,
    base: baseScale(lastView),
    scale: baseScale(lastView),
    bearing: (-20 * Math.PI) / 180,
    pitch: (55 * Math.PI) / 180,
  };
let scene = null,
  city = null,
  band = "morning",
  route = "",
  speedClass = null,
  sort = "speed-asc",
  shown = [],
  selected = null,
  hovered = null,
  selectedStop = null,
  tablePage = 0,
  mode3d = true,
  pitchDegrees = 55,
  relief = 1,
  frame = 0,
  requestId = 0,
  expanded = false,
  touchMode = false;
const areas = groupAreas(manifest.cities);
const failedAssets = new Set();
const cache = new Map(),
  pending = new Map(),
  controls = [
    "band",
    "export-map",
    "route",
    "clear-route",
    "stop-search",
    "share-view",
    "mode3d",
    "mode2d",
    "center",
    "fit",
    "zoom-in",
    "zoom-out",
    "north",
    "rotate-left",
    "rotate-right",
    "reset",
    "bearing",
    "pitch",
    "relief",
    "zoom",
  ];
function notice(message, context = false) {
  const box = $("notice"),
    text = $("notice-text");
  box.dataset.context = String(context);
  box.hidden = !message;
  if (text) text.textContent = message || "";
  else box.textContent = message || "";
  if (renderer.setLabelExclusions) renderer.setLabelExclusions(mapLabelExclusions());
  schedule();
}
function mapLabelExclusions() {
  const shell = $("map-shell"),
    canvas = $("map");
  if (!shell || !canvas) return [];
  const bounds = canvas.getBoundingClientRect(),
    pad = 4,
    pick = (el) => {
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return {
        left: r.left - bounds.left - pad,
        top: r.top - bounds.top - pad,
        right: r.right - bounds.left + pad,
        bottom: r.bottom - bounds.top + pad,
      };
    },
    rects = [];
  for (const el of [
    $("notice"),
    $("map-tip"),
    shell.querySelector(".map-context"),
    shell.querySelector(".top-tools"),
    shell.querySelector(".camera-tools"),
    shell.querySelector(".zoom-tools"),
    shell.querySelector(".map-foot"),
    shell.querySelector(".legend"),
    shell.querySelector(".touch-mode"),
  ]) {
    const rect = pick(el);
    if (rect) rects.push(rect);
  }
  return rects.filter(
    (r) => r.right > 0 && r.bottom > 0 && r.left < bounds.width && r.top < bounds.height,
  );
}
async function boundedBytes(response, limit) {
  if (!response.body) throw Error("File della città vuoto.");
  const reader = response.body.getReader(),
    parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw Error("Limite di dimensione della città superato.");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
async function decodeCity(id) {
  if (cache.has(id)) {
    const s = cache.get(id);
    cache.delete(id);
    cache.set(id, s);
    return s;
  }
  if (pending.has(id) && !pending.get(id).controller.signal.aborted)
    return pending.get(id).promise;
  if (typeof DecompressionStream !== "function")
    throw Error(
      "Questo browser non supporta gli archivi compressi del prototipo.",
    );
  const controller = new AbortController(),
    { signal } = controller;
  const task = (async () => {
    const entry = manifest.cities.find((c) => c.id === id);
    let bytes;
    if (entry?.asset) {
      const asset = entry.asset;
      if (
        !/^cities\/[a-z][a-z0-9-]{0,31}-[a-f0-9]{64}\.json\.gz$/.test(
          asset.path,
        ) ||
        !asset.path.startsWith("cities/" + id + "-") ||
        !Number.isInteger(asset.bytes) ||
        asset.bytes < 1 ||
        asset.bytes > 16 * 1024 ** 2
      )
        throw Error("Manifest della città non valido.");
      if (!crypto.subtle)
        throw Error(
          "Apri l’anteprima su localhost o HTTPS, oppure usa la versione offline.",
        );
      try {
        const response = await fetch(asset.path, {
          cache: failedAssets.has(asset.path) ? "reload" : "force-cache",
          signal,
        });
        if (!response.ok)
          throw Error(
            "File della città non disponibile (HTTP " + response.status + ").",
          );
        bytes = await boundedBytes(response, asset.bytes);
        if (bytes.length !== asset.bytes)
          throw Error("Dimensione del file città non valida.");
        const digest = [
          ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        ]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        if (digest !== asset.sha256)
          throw Error(
            "Il file della città non supera la verifica di integrità.",
          );
        failedAssets.delete(asset.path);
      } catch (error) {
        if (!signal.aborted) failedAssets.add(asset.path);
        throw error;
      }
    } else {
      const block = $("city-" + id);
      if (!block) throw Error("Archivio della città non disponibile.");
      bytes = Uint8Array.from(atob(block.textContent.trim()), (c) =>
        c.charCodeAt(0),
      );
    }
    const expanded = await boundedBytes(
      new Response(
        new Blob([bytes])
          .stream()
          .pipeThrough(new DecompressionStream("gzip"), { signal }),
      ),
      64 * 1024 ** 2,
    );
    signal.throwIfAborted();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(expanded);
    const source = JSON.parse(text);
    if (source.id !== id) throw Error("Il file appartiene a un’altra città.");
    const result = prepareScene(source);
    cache.set(id, result);
    while (cache.size > 2) cache.delete(cache.keys().next().value);
    return result;
  })();
  const entry = { promise: task, controller };
  pending.set(id, entry);
  try {
    return await task;
  } finally {
    if (pending.get(id) === entry) pending.delete(id);
  }
}
async function selectCity(id, restored = null) {
  finishDisclosures();
  syncArea(id);
  $("share-result").hidden = true;
  const token = ++requestId;
  for (const [otherId, task] of pending)
    if (otherId !== id) task.controller.abort();
  $("rows").inert = true;
  canvas.inert = true;
  $("inspector").hidden = true;
  hideMapTip();
  for (const id of ["map-shell", "data-section", "source-panel"])
    $(id).setAttribute("aria-busy", "true");
  $("source-panel").inert = true;
  $("export-map-status").textContent = "";
  controls.forEach((id) => ($(id).disabled = true));
  syncBand();
  syncSelectMenus();
  $("export").disabled = true;
  $("page-previous").disabled = true;
  $("page-next").disabled = true;
  for (const button of document.querySelectorAll("[data-speed]"))
    button.disabled = true;
  shell.dataset.loading = "true";
  $("map-title").textContent = manifest.cities.find((c) => c.id === id).name;
  $("area-label").textContent = "Caricamento…";
  notice("Preparazione della mappa…");
  hideSearch();
  try {
    const result = await decodeCity(id);
    if (token !== requestId) return;
    scene = result;
    city = scene.source;
    selected = null;
    selectedStop = null;
    hovered = null;
    route = "";
    speedClass = null;
    tablePage = 0;
    $("stop-search").value = "";
    $("route").replaceChildren(option("", "Tutte"));
    for (const name of [...new Set(scene.segments.map((s) => s.route))].sort(
      (a, b) => a.localeCompare(b, "it", { numeric: true }),
    ))
      $("route").append(option(name, name));

    sourceInfo();
    syncLegend();
    $("map-attribution").hidden = !city.basemap;
    $("center").setAttribute(
      "aria-label",
      city.areaType === "corridor" ? "Centra tratta" : "Torna al centro città",
    );
    $("center").title =
      city.areaType === "corridor" ? "Centra tratta" : "Centro città";
    if (city.scopeLabel) $("area-label").textContent = city.scopeLabel;
    controls.forEach((id) => ($(id).disabled = false));
    for (const button of document.querySelectorAll("[data-speed]"))
      button.disabled = !scene.segments.length;
    $("stop-search").disabled = !scene.stops.length;
    $("route").disabled = !scene.segments.length;
    $("pitch").disabled = !mode3d;
    $("relief").disabled = !mode3d;
    renderInspector();
    home();
    updateData();
    if (restored) restoreView(restored);
    if (city.initialView === "network" && !restored?.camera) fit();
    notice(
      city.basemap
        ? null
        : "Sfondo OSM non incluso: misure sui tracciati GTFS; toponimi solo dove l’estratto locale esiste.",
      true,
    );
    shell.dataset.loading = "false";
  } catch (error) {
    if (token !== requestId) return;
    finishDisclosures();
    scene = null;
    city = null;
    shown = [];
    selected = null;
    selectedStop = null;
    renderInspector();
    renderTable();
    $("insights").hidden = true;
    $("map-title").textContent = "Mappa non disponibile";
    $("selection-count").textContent = "";
    route = "";
    speedClass = null;
    for (const id of ["source", "quality", "receipt", "area-label"])
      $(id).replaceChildren();
    for (const id of ["quality", "receipt"])
      $(id).closest("details").hidden = true;
    $("empty-state").hidden = true;
    $("clear-filters").hidden = true;
    $("clear-route").hidden = true;
    $("route").parentElement.dataset.clearable = "false";
    $("stop-search").value = "";
    $("route").replaceChildren();
    shell.dataset.loading = "false";
    notice(error.message);
    schedule();
  } finally {
    if (token === requestId) {
      $("rows").inert = false;
      canvas.inert = false;
      $("source-panel").inert = false;
      for (const id of ["map-shell", "data-section", "source-panel"])
        $(id).setAttribute("aria-busy", "false");
      syncSelectMenus();
      syncControls();
      syncBand();
    }
  }
}
function sourceInfo() {
  finishDisclosures(document.querySelector(".source"));
  for (const id of ["quality", "receipt"])
    $(id).closest("details").hidden = false;
  const p = $("source");
  p.replaceChildren();
  const holder = add(p, "p", undefined, "source-holder");
  if (city.attribution) link(holder, city.attribution, city.attributionUrl);
  else holder.textContent = city.holder;
  link(
    add(p, "p", undefined, "source-link"),
    "Feed e documentazione ufficiale ↗",
    city.landingUrl,
  );
  const dates = add(p, "div", undefined, "source-dates");
  const service = add(dates, "p", "Servizio: ");
  const serviceDate = add(
    service,
    "time",
    new Date(city.serviceDate + "T12:00:00").toLocaleDateString("it-IT"),
  );
  serviceDate.dateTime = city.serviceDate;
  add(
    dates,
    "p",
    "Acquisito: " + new Date(city.receipt.acquiredAt).toLocaleString("it-IT"),
  );
  if (city.receipt.lastModified) {
    const lastModified = new Date(city.receipt.lastModified);
    if (!Number.isNaN(lastModified.getTime()))
      add(
        dates,
        "p",
        "File fonte: " + lastModified.toLocaleDateString("it-IT"),
      );
  }
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
  if (city.maxStopOffsetMetres)
    add(
      q,
      "p",
      "Escluse le coppie con fermate oltre " +
        city.maxStopOffsetMetres +
        " m dal tracciato GTFS.",
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
    stop_shape_offset_above_100_m:
      "Fermate oltre 100 m dal tracciato nei percorsi unici",
  };
  const ul = add(q, "ul");
  for (const [key, value] of Object.entries(city.exclusions))
    if (value)
      add(
        ul,
        "li",
        (labels[key] ??
          (key.match(/^implausible_speed_above_(\d+)_kmh$/)
            ? "Coppie oltre " + key.match(/above_(\d+)/)[1] + " km/h, escluse"
            : key)) +
          ": " +
          fmt(value, 0),
      );
  if (city.segments.some((s) => s.estimated))
    add(
      q,
      "p",
      "Sono presenti orari marcati come stimati (timepoint=0). Gli altri non sono per questo osservazioni reali.",
    );
  for (const note of city.sourceNotes ?? []) add(q, "p", note);
  const receipt = $("receipt");
  receipt.replaceChildren();
  add(receipt, "p", licenseReceiptLine(city));
  if (city.licenseUrl)
    link(receipt, "Condizioni e fonte ufficiale ↗", city.licenseUrl);
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
function filtered() {
  return Boolean(route) || speedClass !== null;
}
function updateData() {
  hideMapTip();
  if (!scene) return;
  shown = selectSegments(scene.segments, {
    band,
    route,
    speedClass,
    sort,
    classes: scene.scale.classes,
  });
  tablePage = 0;
  if (selected && !shown.some((s) => s.id === selected)) selected = null;
  if (selectedStop && route && !selectedStop.routes.includes(route))
    selectedStop = null;
  $("map-title").textContent = city.name + (route ? " · " + route : "");
  $("selection-count").textContent = fmt(shown.length, 0) + " tratti";
  $("clear-filters").hidden = !filtered();
  $("clear-route").hidden = !route;
  $("route").parentElement.dataset.clearable = String(Boolean(route));
  $("export").disabled = !shown.length;
  $("export-map").disabled = !shown.length;
  for (const button of document.querySelectorAll("[data-speed]"))
    button.setAttribute(
      "aria-pressed",
      String(
        button.dataset.speed ===
          (speedClass === null ? "" : String(speedClass)),
      ),
    );
  const empty = !shown.length;
  $("empty-state").hidden = !empty;
  $("empty-reset").hidden = !filtered();
  // A band without service is common on corridors (one train a day): offer
  // the band that has it instead of leaving an empty map.
  const otherBand =
    empty && city.status === "ready" && !filtered()
      ? ["all", "morning", "day", "evening"].find(
          (b) => b !== band && scene.segments.some((s) => s.bands[b]),
        )
      : null;
  $("empty-band").hidden = !otherBand;
  if (otherBand) {
    $("empty-band").textContent =
      "Mostra " + (otherBand === "all" ? "il giorno intero" : "la fascia " + bandNames[otherBand]);
    $("empty-band").onclick = () => {
      setBand(otherBand);
      // The button hides itself: keep keyboard focus on the map.
      canvas.focus({ preventScroll: true });
    };
  }
  $("empty-title").textContent =
    city.status === "ready"
      ? filtered()
        ? "Nessun tratto con questi filtri"
        : "Nessuna corsa in questa fascia"
      : "Orari non disponibili";
  $("empty-copy").textContent =
    city.status === "ready"
      ? filtered()
        ? "Prova un’altra fascia, linea o velocità."
        : "Il feed non prevede corse fra queste fermate nella fascia scelta."
      : "Il feed acquisito non contiene corse utilizzabili per il " +
        new Date(city.serviceDate + "T12:00:00").toLocaleDateString("it-IT") +
        ".";
  renderTable();
  renderInsights();
  renderInspector();
  schedule();
}
const bandNames = {
  morning: "7–10",
  day: "10–16",
  evening: "16–20",
  all: "giorno intero",
};
function syncBand() {
  for (const button of document.querySelectorAll("[data-band]")) {
    button.setAttribute("aria-pressed", String(button.dataset.band === band));
    button.disabled = $("band").disabled;
  }
}
function renderInsights() {
  syncBand();
  const base = scene ? selectSegments(scene.segments, { band, route }) : [],
    profile = networkProfile(shown, band);
  $("insights").hidden = !scene || !scene.segments.length;
  if ($("insights").hidden) return;
  $("network-speed").textContent =
    profile.kmh === null ? "–" : fmt(profile.kmh, 1);
  $("network-speed").style.setProperty(
    "--speed-color",
    profile.kmh === null ? "transparent" : kmhColor(profile.kmh, scene.scale),
  );
  $("network-speed-note").textContent =
    profile.kmh === null
      ? "nessun tratto nella selezione"
      : "km/h medi previsti" +
        (route ? " sulla linea " + route : "") +
        ", " +
        bandNames[band];
  $("network-routes").textContent = fmt(profile.routes, 0);
  $("network-segments").textContent = fmt(profile.segments, 0);
  $("network-median").textContent =
    profile.medianKmh === null ? "–" : fmt(profile.medianKmh, 1) + " km/h";
  const bins = speedHistogram(base, band, scene.scale),
    peak = Math.max(...bins.map((b) => b.km), 0.001),
    bars = $("histogram");
  bars.replaceChildren();
  bars.setAttribute(
    "aria-label",
    bins
      .filter((b) => b.km)
      .map(
        (b) =>
          (b.to === Infinity
            ? "oltre " + b.from
            : b.from + "–" + b.to) +
          " km/h: " +
          fmt(b.km, 1) +
          " km",
      )
      .join("; "),
  );
  bars.setAttribute("role", "img");
  for (const b of bins) {
    const bar = add(bars, "span");
    bar.style.setProperty("--h", (b.km / peak) * 100 + "%");
    bar.style.setProperty(
      "--c",
      kmhColor(
        b.to === Infinity ? b.from * 1.25 : (b.from + b.to) / 2,
        scene.scale,
      ),
    );
    bar.title =
      (b.to === Infinity ? "oltre " + b.from : b.from + "–" + b.to) +
      " km/h · " +
      fmt(b.km, 1) +
      " km in " +
      fmt(b.segments, 0) +
      " tratti";
  }
  $("histogram-axis").replaceChildren(
    ...bins.map((b) =>
      make("span", String(b.from)),
    ),
  );
  const compare = $("band-compare");
  compare.replaceChildren();
  const rows = bandComparison(base, ["morning", "day", "evening"]),
    top = Math.max(...rows.map((r) => r.kmh ?? 0), 1);
  $("band-compare-block").hidden = !rows.some((r) => r.segments);
  for (const r of rows) {
    const button = add(compare, "button", undefined, "band-row");
    button.type = "button";
    button.setAttribute("aria-pressed", String(r.band === band));
    button.disabled = !r.segments;
    add(button, "span", bandNames[r.band], "band-name");
    const track = add(button, "span", undefined, "band-track"),
      fill = add(track, "i");
    fill.style.width = ((r.kmh ?? 0) / top) * 100 + "%";
    fill.style.background = r.kmh === null ? "none" : kmhColor(r.kmh, scene.scale);
    add(button, "span", r.kmh === null ? "–" : fmt(r.kmh, 1), "band-value");
    button.setAttribute(
      "aria-label",
      "Fascia " +
        bandNames[r.band] +
        ": " +
        (r.kmh === null ? "nessun dato" : fmt(r.kmh, 1) + " km/h"),
    );
    button.onclick = () => setBand(r.band);
  }
  const list = $("slowest");
  list.replaceChildren();
  for (const s of slowestSegments(base, band)) {
    const item = add(list, "li"),
      button = add(item, "button");
    button.type = "button";
    button.dataset.segment = s.id;
    button.setAttribute("aria-pressed", String(s.id === selected));
    const badge = add(button, "span", s.route, "route-chip");
    badge.style.setProperty("--chip", kmhColor(s.bands[band].kmh, scene.scale));
    const text = add(button, "span", undefined, "slow-stops");
    add(text, "span", stopLabel(s.from));
    add(text, "span", "→ " + stopLabel(s.to));
    add(button, "strong", fmt(s.bands[band].kmh, 1), "slow-speed");
    button.setAttribute(
      "aria-label",
      "Linea " +
        s.route +
        ", " +
        stopLabel(s.from) +
        " verso " +
        stopLabel(s.to) +
        ", " +
        fmt(s.bands[band].kmh, 1) +
        " km/h. Mostra sulla mappa",
    );
    button.onclick = () => {
      if (speedClass !== null && !shown.some((x) => x.id === s.id)) {
        speedClass = null;
        updateData();
      }
      inspect(s);
      focusSegment(s);
    };
  }
  if (!list.children.length)
    add(list, "li", "Nessun tratto abbastanza lungo e frequente.", "hint");
}
function setBand(value) {
  if (value === band || !$("band").querySelector('[value="' + value + '"]'))
    return;
  $("band").value = value;
  band = value;
  updateData();
}
function renderTable() {
  for (const [key, label] of [
    ["speed", "Velocità"],
    ["trips", "Corse"],
  ]) {
    const active = sort.startsWith(key + "-");
    const ascending = sort.endsWith("asc");
    const button = $("sort-" + key);
    $(key + "-heading").setAttribute(
      "aria-sort",
      active ? (ascending ? "ascending" : "descending") : "none",
    );
    button.querySelector("span").textContent = active
      ? ascending
        ? "↑"
        : "↓"
      : "↕";
    button.setAttribute(
      "aria-label",
      label +
        ": mostra prima " +
        (key === "speed"
          ? active && ascending
            ? "i più veloci"
            : "i più lenti"
          : active && !ascending
            ? "i meno frequenti"
            : "i più frequenti"),
    );
    button.disabled = !shown.length;
  }
  tablePage = Math.max(
    0,
    Math.min(tablePage, Math.ceil(shown.length / 20) - 1),
  );
  const start = tablePage * 20;
  $("coverage").textContent = shown.length
    ? fmt(start + 1, 0) +
      "–" +
      fmt(Math.min(start + 20, shown.length), 0) +
      " di " +
      fmt(shown.length, 0) +
      " tratti"
    : "Nessun tratto nella selezione";
  $("page-previous").disabled = tablePage === 0;
  $("page-next").disabled = start + 20 >= shown.length;
  $("pages").hidden = !shown.length;
  const rows = $("rows");
  rows.replaceChildren();
  for (const s of shown.slice(start, start + 20)) {
    const row = add(rows, "tr"),
      td = add(row, "td"),
      button = add(td, "button", s.route);
    row.dataset.selected = String(s.id === selected);
    button.type = "button";
    button.setAttribute(
      "aria-label",
      "Seleziona linea " + s.route + ", " + s.from + " verso " + s.to,
    );
    button.setAttribute("aria-pressed", String(s.id === selected));
    row.onclick = () => {
      inspect(s);
      focusSegment(s);
      canvas.scrollIntoView({ block: "center", behavior: "instant" });
      canvas.focus({ preventScroll: true });
    };
    add(row, "td", stopLabel(s.from) + " → " + stopLabel(s.to));
    const speedCell = add(row, "td");
    speedCell.style.setProperty("--speed-color", speedColor(s.bands[band].kmh, scene.scale));
    add(speedCell, "span", fmt(s.bands[band].kmh), "speed-value");
    add(row, "td", fmt(s.bands[band].samples, 0));
  }
}
function inspect(segment) {
  hideMapTip();
  selected = segment?.id ?? null;
  selectedStop = null;
  renderInspector();
  renderTable();
  schedule();
}
function renderInspector() {
  for (const button of $("slowest").querySelectorAll("[data-segment]"))
    button.setAttribute("aria-pressed", String(button.dataset.segment === selected));
  const panel = $("inspector");
  finishDisclosures(panel);
  panel.replaceChildren();
  const s = shown.find((s) => s.id === selected);
  panel.hidden = !s && !selectedStop;
  panel.classList.toggle("stop-detail", Boolean(selectedStop));
  if (panel.hidden) return;
  const close = add(panel, "button", undefined, "close-detail");
  const closeIcon = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  closeIcon.setAttribute("viewBox", "0 0 24 24");
  closeIcon.setAttribute("aria-hidden", "true");
  const closePath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  closePath.setAttribute("d", "m6 6 12 12M18 6 6 18");
  closeIcon.append(closePath);
  close.append(closeIcon);
  close.type = "button";
  close.setAttribute("aria-label", "Chiudi dettaglio");
  close.onclick = () => {
    inspect(null);
    canvas.focus({ preventScroll: true });
  };
  if (selectedStop) {
    add(panel, "h3", selectedStop.label);
    add(panel, "p", "Fermata GTFS " + selectedStop.id, "detail-note");
    const routes = add(panel, "div", undefined, "stop-routes");
    for (const r of selectedStop.routes) {
      const b = add(routes, "button", "Linea " + r);
      b.type = "button";
      b.onclick = () => setRoute(r);
    }
    return;
  }
  const line = add(panel, "button", undefined, "route-badge line-action");
  add(line, "span", "Linea " + s.route);
  const filterIcon = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  filterIcon.setAttribute("viewBox", "0 0 24 24");
  filterIcon.setAttribute("aria-hidden", "true");
  const filterPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  filterPath.setAttribute("d", "M4 5h16l-6 7v6l-4 2v-8Z");
  filterIcon.append(filterPath);
  line.append(filterIcon);
  line.type = "button";
  const isolated = route === s.route;
  line.setAttribute("aria-pressed", String(isolated));
  line.setAttribute(
    "aria-label",
    isolated ? "Mostra tutte le linee" : "Mostra solo la linea " + s.route,
  );
  line.title = line.getAttribute("aria-label");
  line.onclick = () => {
    inspect(null);
    setRoute(isolated ? "" : s.route);
    if (isolated) fit();
    canvas.focus({ preventScroll: true });
  };
  const trip = add(panel, "div", undefined, "trip");
  const from = add(trip, "span", undefined, "trip-end");
  add(from, "b", "A");
  add(from, "span", stopLabel(s.from));
  const to = add(trip, "span", undefined, "trip-end");
  add(to, "b", "B");
  add(to, "span", stopLabel(s.to));
  const value = add(panel, "div", fmt(s.bands[band].kmh), "metric");
  value.style.setProperty("--speed-color", kmhColor(s.bands[band].kmh, scene.scale));
  add(value, "span", " km/h");
  const peers = selectSegments(scene.segments, { band, route: "" }),
    faster = peers.filter((x) => x.bands[band].kmh > s.bands[band].kmh).length,
    // Clamp to 1–99: "100%" would also count the segment against itself.
    share =
      peers.length > 1
        ? Math.min(99, Math.max(1, Math.round((faster / (peers.length - 1)) * 100)))
        : null;
  add(
    panel,
    "p",
    "Velocità programmata" +
      (share === null
        ? ""
        : share >= 50
          ? " · più lento del " + share + "% dei tratti della rete"
          : " · più veloce del " + (100 - share) + "% dei tratti della rete"),
    "metric-label",
  );
  const bandsRow = add(panel, "div", undefined, "segment-bands");
  for (const key of ["morning", "day", "evening"]) {
    const b = s.bands[key],
      cell = add(bandsRow, "span");
    cell.dataset.current = String(key === band);
    add(cell, "small", bandNames[key]);
    add(cell, "b", b ? fmt(b.kmh) : "–");
    if (b) cell.style.setProperty("--c", kmhColor(b.kmh, scene.scale));
  }
  const dl = add(panel, "dl");
  for (const [label, value] of [
    ["Tempo", fmt(s.bands[band].seconds / 60) + " min"],
    ["Tracciato", fmt(s.metres, 0) + " m"],
    ["Corse", fmt(s.bands[band].samples, 0)],
  ]) {
    const row = add(dl, "div");
    add(row, "dt", label);
    add(row, "dd", value);
  }
  if (s.geometrySource === "osm-rail")
    add(
      panel,
      "p",
      "Percorso ricostruito sui binari OpenStreetMap: il feed non ha la forma del tracciato. Tempi e fermate restano quelli del GTFS.",
      "detail-note derived-note",
    );
  if (s.from.toLocaleLowerCase() === s.to.toLocaleLowerCase())
    add(
      panel,
      "p",
      "Fermate omonime: può includere manovre o capolinea.",
      "detail-note",
    );
  const details = add(panel, "details", undefined, "detail-note");
  add(details, "summary", "Identificativi del tratto");
  add(
    details,
    "p",
    s.fromId +
      " → " +
      s.toId +
      " · direzione GTFS " +
      (s.direction || "non indicata"),
  );
  add(details, "p", s.id);
  enhanceDisclosure(details);
}
function clearFilters() {
  route = "";
  speedClass = null;
  $("route").value = "";
  syncSelectMenus();
  hideSearch();
  updateData();
}
function setRoute(value) {
  route = value;
  $("route").value = value;
  syncSelectMenus();
  hideSearch();
  updateData();
  if (route) fit();
}
function hideSearch() {
  $("stop-menu").hidden = true;
}
function showSearch() {
  closeSelectMenu();
  const query = $("stop-search").value,
    results = scene ? searchStops(scene.stops, query, route, 8) : [];
  $("stop-results").replaceChildren();
  $("stop-menu").hidden = !query.trim();
  if (!query.trim()) return;
  for (const stop of results) {
    const li = add($("stop-results"), "li"),
      button = add(li, "button");
    button.type = "button";
    add(button, "span", stop.label);
    add(
      button,
      "small",
      "GTFS " +
        stop.id +
        " · " +
        stop.routes.slice(0, 4).join(", ") +
        (stop.routes.length > 4 ? "…" : ""),
    );
    button.onclick = () => chooseStop(stop);
    button.onkeydown = (event) => {
      const buttons = [...$("stop-results").querySelectorAll("button")],
        index = buttons.indexOf(button);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        buttons[(index + 1) % buttons.length].focus();
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!index) $("stop-search").focus();
        else buttons[index - 1].focus();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        hideSearch();
        $("stop-search").focus();
      }
    };
  }
  $("search-status").textContent = results.length
    ? ""
    : "Nessuna fermata trovata" + (route ? " su questa linea." : ".");
  $("search-status").hidden = Boolean(results.length);
}
function chooseStop(stop) {
  selected = null;
  selectedStop = stop;
  $("camera-panel").open = false;
  $("stop-search").value = stop.label;
  hideSearch();
  focusPoint(stop.world, Math.min(1.2, Math.max(cam.scale, cam.base * 2.2)));
  renderInspector();
  renderTable();
  canvas.scrollIntoView({ block: "center", behavior: "instant" });
  canvas.focus({ preventScroll: true });
}
function constrain() {
  cam.bearing = normalizeBearing(cam.bearing);
  if (!scene) return;
  const [w, s, e, n] = scene.bounds,
    padX = (e - w) * 0.25,
    padY = (n - s) * 0.25;
  cam.x = Math.max(w - padX, Math.min(e + padX, cam.x));
  cam.y = Math.max(s - padY, Math.min(n + padY, cam.y));
}
function syncControls() {
  const panel = document.querySelector(".camera-options"),
    maxHeight = Math.min(410, Math.max(160, canvas.clientHeight - 95)) + "px";
  if (panel.style.maxHeight !== maxHeight) panel.style.maxHeight = maxHeight;
  $("bearing").value = (cam.bearing * 180) / Math.PI;
  $("bearing-value").textContent = fmt((cam.bearing * 180) / Math.PI, 0) + "°";
  $("compass").style.transform = "rotate(" + -cam.bearing + "rad)";
  const limits = zoomLimits(cam);
  const busy = !scene || shell.dataset.loading === "true";
  $("zoom").min = (limits.min / cam.base) * 100;
  $("zoom").max = (limits.max / cam.base) * 100;
  $("zoom-in").disabled = busy || cam.scale >= limits.max - 1e-10;
  $("zoom-out").disabled = busy || cam.scale <= limits.min + 1e-10;
  $("zoom").step = "any";
  $("zoom").value = (cam.scale / cam.base) * 100;
  $("zoom-value").textContent = fmt((cam.scale / cam.base) * 100, 0) + "%";
  $("zoom").setAttribute(
    "aria-valuetext",
    fmt((cam.scale / cam.base) * 100, 0) + "%",
  );
  $("pitch").value = pitchDegrees;
  $("pitch-value").textContent = mode3d ? fmt(pitchDegrees, 0) + "°" : "2D";
  $("relief").value = relief * 100;
  $("relief-value").textContent = fmt(relief * 100, 0) + "%";
  $("pitch").disabled = busy || !mode3d;
  $("relief").disabled = busy || !mode3d;
}
function updateCamera(next) {
  hideMapTip();
  cam = next;
  constrain();
  syncControls();
  schedule();
}
function home() {
  lastView = view();
  const viewWidthMetres = city?.viewWidthMetres ?? 6500;
  const base = baseScale(lastView, viewWidthMetres);
  updateCamera({ ...cam, x: 0, y: 0, base, scale: base, viewWidthMetres });
}
function fit() {
  if (!shown.length) return;
  const selection = shown.find((s) => s.id === selected);
  if (selection) {
    focusSegment(selection);
    return;
  }
  if (selectedStop) {
    focusPoint(selectedStop.world, Math.max(cam.base, cam.scale));
    return;
  }
  const maxHeight = shown.reduce((m, s) => Math.max(m, crestFor(s)), 0);
  updateCamera(
    fitCamera(
      cam,
      view(),
      shown.flatMap((s) => s.points),
      { padding: canvas.clientWidth < 600 ? 28 : 48, maxHeight },
    ),
  );
}
function focusPoint(point, scale) {
  let next = { ...cam, x: point[0], y: point[1], scale };
  if (canvas.clientWidth < 600)
    next = panCamera(
      next,
      view(),
      [canvas.clientWidth / 2, canvas.clientHeight * 0.53],
      [canvas.clientWidth / 2, canvas.clientHeight * 0.31],
    );
  updateCamera(next);
}
function selectionInsets() {
  const panel = $("inspector"),
    rect = canvas.getBoundingClientRect();
  const topTools = document.querySelector(".top-tools").getBoundingClientRect();
  const bottomTools = document
    .querySelector(".camera-tools")
    .getBoundingClientRect();
  const zoomTools = document
    .querySelector(".zoom-tools")
    .getBoundingClientRect();
  const top = topTools.bottom - rect.top + 12,
    bottom = rect.bottom - bottomTools.top + 12;
  const right = rect.right - zoomTools.left + 12;
  if (panel.hidden) return { top, right, bottom, left: 12 };
  const detail = panel.getBoundingClientRect();
  return canvas.clientWidth < 600
    ? {
        top,
        right: zoomTools.top < detail.top ? right : 12,
        bottom: Math.max(bottom, rect.bottom - detail.top + 12),
        left: 12,
      }
    : { top, right, bottom, left: detail.right - rect.left + 16 };
}

function crestFor(s) {
  // Same height the renderer draws, so framing includes the crest.
  return mode3d ? ridgeHeight(s, band, scene, relief) : 0;
}
function segmentCamera(s) {
  const height = crestFor(s);
  const endpoints = [s.fromId, s.toId]
    .map((id) => scene.stops.find((stop) => stop.id === id)?.world)
    .filter(Boolean);
  return fitCamera(cam, view(), [...s.points, ...endpoints], {
    padding: 18,
    maxHeight: height,
    insets: selectionInsets(),
  });
}
function focusSegment(s) {
  updateCamera(segmentCamera(s));
}

function zoomBy(
  factor,
  x = canvas.clientWidth / 2,
  y = canvas.clientHeight * 0.53,
) {
  updateCamera(zoomCamera(cam, view(), factor, [x, y]));
}
function setMode(value) {
  mode3d = value;
  $("mode3d").setAttribute("aria-pressed", String(value));
  $("mode2d").setAttribute("aria-pressed", String(!value));
  updateCamera({ ...cam, pitch: value ? (pitchDegrees * Math.PI) / 180 : 0 });
}
function resetView() {
  pitchDegrees = 55;
  relief = 1;
  cam.bearing = (-20 * Math.PI) / 180;
  setMode(true);
  home();
}
function drawFrame() {
  frame = 0;
  const nextView = view();
  if (
    nextView.width !== lastView.width ||
    nextView.height !== lastView.height
  ) {
    hideMapTip();
    cam = resizeCamera(cam, lastView, nextView);
    lastView = nextView;
    const segment = shown.find((s) => s.id === selected);
    if (segment) cam = segmentCamera(segment);
    constrain();
    syncControls();
  }
  if (renderer.setLabelExclusions)
    renderer.setLabelExclusions(mapLabelExclusions());
  const stats = renderer.draw({
    scene,
    segments: shown,
    band,
    camera: cam,
    selected,
    hovered,
    stop: selectedStop,
    relief,
  });
  const scale = $("scale-bar");
  scale.hidden = !stats.scale;
  if (stats.scale) {
    const label =
      stats.scale.metres >= 1000
        ? fmt(stats.scale.metres / 1000, 1) + " km"
        : fmt(stats.scale.metres, 0) + " m";
    if (scale.firstElementChild.textContent !== label)
      scale.firstElementChild.textContent = label;
    scale.lastElementChild.style.width = stats.scale.pixels + "px";
  }
}
function schedule() {
  if (!frame) frame = requestAnimationFrame(drawFrame);
}
function setTouch(value) {
  touchMode = value;
  shell.dataset.touch = String(value);
  $("touch-mode").setAttribute("aria-pressed", String(value));
  $("touch-mode").textContent = value
    ? "Termina esplorazione"
    : "Esplora con le dita";
  if (value) canvas.focus({ preventScroll: true });
}
const inertBefore = new Map();
let overflowBefore = "";
function toggleExpanded() {
  expanded = !expanded;
  shell.classList.toggle("expanded", expanded);
  $("expand").setAttribute("aria-expanded", String(expanded));
  $("expand").setAttribute(
    "aria-label",
    expanded ? "Riduci mappa" : "Espandi mappa",
  );
  if (expanded) {
    overflowBefore = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    for (const node of [
      document.querySelector(".mast"),
      ...[...document.querySelector("main").children].filter(
        (n) => n !== shell,
      ),
    ]) {
      inertBefore.set(node, node.inert);
      node.inert = true;
    }
    shell.setAttribute("role", "dialog");
    shell.setAttribute("aria-modal", "true");
    canvas.focus({ preventScroll: true });
  } else {
    document.body.style.overflow = overflowBefore;
    for (const [node, value] of inertBefore) node.inert = value;
    inertBefore.clear();
    shell.removeAttribute("role");
    shell.removeAttribute("aria-modal");
    $("expand").focus({ preventScroll: true });
  }
  schedule();
}
function escape() {
  hideMapTip();
  if (!$("share-result").hidden) {
    $("share-result").hidden = true;
    $("share-view").focus();
    return;
  }
  if (!$("stop-menu").hidden) {
    hideSearch();
    return;
  }
  if ($("camera-panel").open) {
    $("camera-panel").open = false;
    return;
  }
  if (selected || selectedStop) {
    inspect(null);
    return;
  }
  if (expanded) {
    toggleExpanded();
    return;
  }
  if (touchMode) setTouch(false);
}
function pointerPoint(event) {
  const r = canvas.getBoundingClientRect();
  return [event.clientX - r.left, event.clientY - r.top];
}
const pointers = new Map();
let moved = false,
  dragStart = null,
  tapOnly = null;
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || pointers.size >= 2) return;
  const point = pointerPoint(event);
  if (event.pointerType === "touch" && !touchMode) {
    tapOnly = { id: event.pointerId, point };
    return;
  }
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, point);
  moved = pointers.size > 1;
  dragStart = point;
  canvas.classList.add("dragging");
  hideMapTip();
});
canvas.addEventListener("pointermove", (event) => {
  const point = pointerPoint(event);
  if (tapOnly?.id === event.pointerId) {
    if (
      Math.hypot(point[0] - tapOnly.point[0], point[1] - tapOnly.point[1]) > 6
    )
      tapOnly = null;
    return;
  }
  if (pointers.has(event.pointerId)) {
    const before = [...pointers.values()],
      previous = pointers.get(event.pointerId);
    pointers.set(event.pointerId, point);
    if (pointers.size === 2) {
      moved = true;
      const after = [...pointers.values()],
        mid = (pair) => [
          (pair[0][0] + pair[1][0]) / 2,
          (pair[0][1] + pair[1][1]) / 2,
        ],
        distance = (pair) =>
          Math.hypot(pair[1][0] - pair[0][0], pair[1][1] - pair[0][1]),
        angle = (pair) =>
          Math.atan2(pair[1][1] - pair[0][1], pair[1][0] - pair[0][0]),
        d = distance(before);
      if (d > 1)
        updateCamera(
          transformCamera(cam, view(), {
            from: mid(before),
            to: mid(after),
            factor: distance(after) / d,
            rotation: normalizeBearing(angle(after) - angle(before)),
          }),
        );
    } else {
      if (
        dragStart &&
        Math.hypot(point[0] - dragStart[0], point[1] - dragStart[1]) > 4
      )
        moved = true;
      if (moved) {
        if (event.shiftKey) {
          if (mode3d)
            pitchDegrees = Math.max(
              15,
              Math.min(65, pitchDegrees + (point[1] - previous[1]) * 0.15),
            );
          updateCamera({
            ...cam,
            bearing: cam.bearing + (point[0] - previous[0]) * 0.008,
            pitch: mode3d ? (pitchDegrees * Math.PI) / 180 : 0,
          });
        } else updateCamera(panCamera(cam, view(), previous, point));
      }
    }
    return;
  }
  if (event.pointerType === "touch") return;
  const s = renderer.nearest(...point);
  if (hovered !== s?.id) {
    hovered = s?.id ?? null;
    schedule();
  }
  showMapTip(s, point);
});
let tipWidth = 0,
  tipHeight = 0;
function hideMapTip() {
  const tip = $("map-tip");
  if (tip.hidden && hovered === null) return;
  tip.hidden = true;
  tip.dataset.segment = "";
  hovered = null;
  schedule();
}
function showMapTip(segment, point) {
  if (!segment) {
    hideMapTip();
    return;
  }
  const tip = $("map-tip");
  if (tip.dataset.segment !== segment.id) {
    tip.replaceChildren();
    const heading = add(tip, "div", undefined, "tip-heading");
    add(heading, "span", "Linea " + segment.route, "tip-route");
    const speed = add(
      heading,
      "strong",
      fmt(segment.bands[band].kmh),
      "tip-speed",
    );
    add(speed, "small", " km/h");
    add(
      tip,
      "span",
      stopLabel(segment.from) + " → " + stopLabel(segment.to),
      "tip-stops",
    );
    tip.dataset.segment = segment.id;
    tip.hidden = false;
    tipWidth = tip.offsetWidth;
    tipHeight = tip.offsetHeight;
  }
  const x = Math.max(
    8,
    Math.min(canvas.clientWidth - tipWidth - 8, point[0] + 12),
  );
  const above = point[1] - tipHeight - 12;
  const y = Math.max(
    8,
    Math.min(
      canvas.clientHeight - tipHeight - 8,
      above >= 8 ? above : point[1] + 16,
    ),
  );
  tip.style.transform = "translate3d(" + x + "px," + y + "px,0)";
}
function endPointer(event, cancelled = false) {
  if (tapOnly?.id === event.pointerId) {
    if (!cancelled) inspect(renderer.nearest(...pointerPoint(event)));
    tapOnly = null;
    return;
  }
  if (!pointers.has(event.pointerId)) return;
  if (!cancelled && !moved && pointers.size === 1)
    inspect(renderer.nearest(...pointerPoint(event)));
  pointers.delete(event.pointerId);
  if (!pointers.size) {
    canvas.classList.remove("dragging");
    dragStart = null;
  } else moved = true;
}
canvas.addEventListener("pointerup", (event) => endPointer(event));
canvas.addEventListener("pointercancel", (event) => endPointer(event, true));
canvas.addEventListener("lostpointercapture", (event) =>
  endPointer(event, true),
);
canvas.addEventListener("pointerleave", () => {
  if (!pointers.size) hideMapTip();
});
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    zoomBy(
      Math.exp(-Math.max(-600, Math.min(600, event.deltaY)) * 0.0015),
      ...pointerPoint(event),
    );
  },
  { passive: false },
);
canvas.addEventListener("dblclick", (event) => {
  zoomBy(1.6, ...pointerPoint(event));
});
canvas.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (
    ![
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
    return;
  event.preventDefault();
  if (event.key === "Escape") {
    escape();
    return;
  }
  if (event.key === "Home") {
    home();
    return;
  }
  if (event.key === "+" || event.key === "=") {
    zoomBy(1.25);
    return;
  }
  if (event.key === "-") {
    zoomBy(0.8);
    return;
  }
  if (event.shiftKey) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight")
      updateCamera({
        ...cam,
        bearing:
          cam.bearing + ((event.key === "ArrowLeft" ? -1 : 1) * Math.PI) / 12,
      });
    else if (mode3d) {
      pitchDegrees = Math.max(
        15,
        Math.min(65, pitchDegrees + (event.key === "ArrowUp" ? 5 : -5)),
      );
      updateCamera({ ...cam, pitch: (pitchDegrees * Math.PI) / 180 });
    }
    return;
  }
  const from = [canvas.clientWidth / 2, canvas.clientHeight * 0.53],
    delta =
      event.key === "ArrowLeft"
        ? [60, 0]
        : event.key === "ArrowRight"
          ? [-60, 0]
          : event.key === "ArrowUp"
            ? [0, 60]
            : [0, -60];
  updateCamera(
    panCamera(cam, view(), from, [from[0] + delta[0], from[1] + delta[1]]),
  );
});
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;
  if (event.key === "Escape") {
    escape();
    return;
  }
  if (event.key === "Tab" && expanded) {
    const list = [
        ...shell.querySelectorAll(
          "button:not([disabled]),input:not([disabled]),summary,canvas,a[href]",
        ),
      ].filter((n) => n.getClientRects().length),
      first = list[0],
      last = list.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".stop-search")) hideSearch();
  if ($("camera-panel").open && !event.target.closest("#camera-panel"))
    $("camera-panel").open = false;
});
window.addEventListener(
  "scroll",
  () => {
    hideSearch();
    hideMapTip();
  },
  { passive: true },
);
window.addEventListener("blur", hideMapTip);
function restoreView(state) {
  band = state.band;
  $("band").value = band;
  route = scene.segments.some((s) => s.route === state.route)
    ? state.route
    : "";
  $("route").value = route;
  syncSelectMenus();
  speedClass = state.speed;
  sort = state.sort;
  if (state.camera) {
    pitchDegrees = state.camera[4];
    relief = state.camera[5];
  }
  setMode(state.mode === "3d");
  updateData();
  selected = shown.some((s) => s.id === state.segment) ? state.segment : null;
  selectedStop = selected
    ? null
    : (scene.stops.find(
        (s) => s.id === state.stop && (!route || s.routes.includes(route)),
      ) ?? null);
  if (selectedStop) $("stop-search").value = selectedStop.label;
  if (state.camera) {
    const [x, y, zoom, bearing] = state.camera;
    updateCamera({
      ...cam,
      x,
      y,
      scale: Math.min(1.2, (cam.base * zoom) / 100),
      bearing: (bearing * Math.PI) / 180,
    });
  }
  renderInspector();
  renderTable();
  schedule();
}
let copyTimer;
$("share-view").onclick = async () => {
  if (!city) return;
  const url = viewURL(location.href, {
    city: city.id,
    band,
    route,
    speed: speedClass,
    sort,
    mode: mode3d ? "3d" : "2d",
    stop: selectedStop?.id ?? null,
    segment: selected,
    camera: [
      cam.x,
      cam.y,
      (cam.scale / cam.base) * 100,
      (cam.bearing * 180) / Math.PI,
      pitchDegrees,
      relief,
    ].map((n) => Number(n.toFixed(4))),
  });
  $("view-link").value = url;
  clearTimeout(copyTimer);
  try {
    await navigator.clipboard.writeText(url);
    $("share-result").hidden = true;
    $("share-view").querySelector("span").textContent = "Link copiato";
    $("share-status").textContent = "Link alla vista copiato.";
    copyTimer = setTimeout(() => {
      $("share-view").querySelector("span").textContent = "Copia link";
    }, 2000);
  } catch {
    $("share-result").hidden = false;
    $("view-link").focus();
    $("view-link").select();
    $("share-status").textContent =
      "Copia il link alla vista dal campo selezionato.";
  }
};
$("close-share").onclick = () => {
  $("share-result").hidden = true;
  $("share-view").focus();
};
function syncLegend() {
  const [a, b, c] = scene.scale.classes,
    labels = ["< " + a, a + "–" + b, b + "–" + c, "≥ " + c],
    samples = [a * 0.7, (a + b) / 2, (b + c) / 2, c * 1.3];
  for (const button of document.querySelectorAll("[data-speed]")) {
    if (button.dataset.speed === "") continue;
    const i = Number(button.dataset.speed),
      swatch = button.querySelector("i");
    swatch.style.setProperty("--swatch", kmhColor(samples[i], scene.scale));
    button.replaceChildren(swatch, labels[i]);
    button.setAttribute("aria-label", labels[i] + " km/h");
  }
  $("map-key-fast").textContent = "≥ " + c;
  $("map-key-slow").textContent = "< " + a;
  $("ramp-note").textContent =
    scene.scale.id === "rail"
      ? "Scala ferroviaria: scuro sotto i 40 km/h"
      : "Scala urbana: scuro sotto i 10 km/h";
}
function syncArea(sourceId) {
  const entry = manifest.cities.find((c) => c.id === sourceId);
  const area = areas.find((a) => a.id === (entry.areaId || entry.id));
  $("city").value = area.id;
  $("vehicle").replaceChildren(
    ...area.sources.map((source) => {
      const node = option(source.id, modeLabel(source.mode));
      node.dataset.subtitle =
        source.status === "ready" ? "" : "Dati non disponibili";
      return node;
    }),
  );
  $("vehicle").value = sourceId;
  const tabs = $("mode-tabs");
  tabs.replaceChildren();
  for (const source of area.sources) {
    const button = add(tabs, "button", modeLabel(source.mode));
    button.type = "button";
    button.dataset.source = source.id;
    button.setAttribute("aria-pressed", String(source.id === sourceId));
    if (source.status !== "ready") {
      button.classList.add("unavailable");
      button.title = "Dati non disponibili per il giorno scelto";
    }
    button.onclick = () => {
      if (source.id === $("vehicle").value && city?.id === source.id) return;
      $("vehicle").value = source.id;
      selectCity(source.id);
    };
  }
  tabs.hidden = area.sources.length < 2;
  syncSelectMenus();
}
$("city").onchange = () => {
  const preferred = manifest.cities.find(
    (c) => c.id === $("vehicle").value,
  )?.mode;
  selectCity(sourceForArea(areas, $("city").value, preferred).id);
};
$("vehicle").onchange = () => selectCity($("vehicle").value);
$("band").onchange = () => setBand($("band").value);
for (const button of document.querySelectorAll("[data-band]"))
  button.onclick = () => setBand(button.dataset.band);
$("route").onchange = () => setRoute($("route").value);
$("clear-route").onclick = () => {
  closeSelectMenu();
  setRoute("");
  $("route-trigger").focus({ preventScroll: true });
};
$("stop-search").oninput = showSearch;
$("stop-search").onfocus = () => {
  if ($("stop-search").value) showSearch();
};
$("stop-search").onkeydown = (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    hideSearch();
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    $("stop-results").querySelector("button")?.focus();
  }
  if (event.key === "Enter") {
    event.preventDefault();
    $("stop-results").querySelector("button")?.click();
  }
};
for (const button of document.querySelectorAll("[data-speed]"))
  button.onclick = () => {
    speedClass =
      button.dataset.speed === "" ? null : Number(button.dataset.speed);
    updateData();
  };
$("clear-filters").onclick = clearFilters;
$("empty-reset").onclick = clearFilters;
for (const key of ["speed", "trips"])
  $("sort-" + key).onclick = () => {
    sort =
      sort === key + "-asc"
        ? key + "-desc"
        : sort === key + "-desc"
          ? key + "-asc"
          : key === "speed"
            ? "speed-asc"
            : "trips-desc";
    updateData();
  };
$("page-previous").onclick = () => {
  tablePage--;
  renderTable();
};
$("page-next").onclick = () => {
  tablePage++;
  renderTable();
};
$("mode3d").onclick = () => setMode(true);
$("mode2d").onclick = () => setMode(false);
$("center").onclick = home;
$("fit").onclick = fit;
$("reset").onclick = resetView;
$("north").onclick = () => updateCamera({ ...cam, bearing: 0 });
$("rotate-left").onclick = () =>
  updateCamera({ ...cam, bearing: cam.bearing - Math.PI / 12 });
$("rotate-right").onclick = () =>
  updateCamera({ ...cam, bearing: cam.bearing + Math.PI / 12 });
$("zoom-in").onclick = () => zoomBy(1.3);
$("zoom-out").onclick = () => zoomBy(1 / 1.3);
$("bearing").oninput = () =>
  updateCamera({
    ...cam,
    bearing: (Number($("bearing").value) * Math.PI) / 180,
  });
$("pitch").oninput = () => {
  pitchDegrees = Number($("pitch").value);
  updateCamera({ ...cam, pitch: (pitchDegrees * Math.PI) / 180 });
};
$("relief").oninput = () => {
  relief = Number($("relief").value) / 100;
  syncControls();
  schedule();
};
$("zoom").oninput = () =>
  zoomBy(((Number($("zoom").value) / 100) * cam.base) / cam.scale);
$("expand").onclick = toggleExpanded;
$("touch-mode").onclick = () => setTouch(!touchMode);
$("export").onclick = () => {
  if (!city || !shown.length) return;
  const url = URL.createObjectURL(
      new Blob([selectionCSV(city, shown, band)], {
        type: "text/csv;charset=utf-8",
      }),
    ),
    a = make("a");
  a.href = url;
  a.download = "dvns-" + city.id + "-" + city.serviceDate + "-" + band + ".csv";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("export-map").onclick = async () => {
  if (!city || !shown.length || $("export-map").disabled) return;
  const token = requestId,
    snapshot = city;
  $("export-map").disabled = true;
  $("export-map-status").classList.add("sr-only");
  $("export-map-status").textContent = "Preparazione immagine…";
  try {
    if (frame) cancelAnimationFrame(frame);
    drawFrame();
    const segment = shown.find((s) => s.id === selected);
    const blob = await mapImage({
      canvas,
      city: snapshot,
      bandLabel: $("band").selectedOptions[0].textContent,
      route,
      count: shown.length,
      mode3d,
      camera: { ...cam },
      scale: scene.scale,
      selection: segment
        ? stopLabel(segment.from) + " → " + stopLabel(segment.to)
        : null,
    });
    const url = URL.createObjectURL(blob),
      a = make("a");
    a.href = url;
    a.download = "dvns-" + snapshot.id + "-" + snapshot.serviceDate + ".png";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (token === requestId)
      $("export-map-status").textContent = "Immagine scaricata.";
  } catch (error) {
    if (token === requestId) {
      $("export-map-status").classList.remove("sr-only");
      $("export-map-status").textContent = error.message;
    }
  } finally {
    if (token === requestId) $("export-map").disabled = !shown.length;
  }
};
new ResizeObserver(schedule).observe(canvas);
window.addEventListener("resize", () => finishDisclosures());
window
  .matchMedia("(prefers-reduced-motion: reduce)")
  .addEventListener("change", (event) => {
    if (event.matches) finishDisclosures();
  });
for (const area of areas) {
  const node = option(area.id, area.name);
  node.dataset.subtitle = area.sources
    .map(
      (s) =>
        modeLabel(s.mode) +
        (s.status === "ready" ? "" : " · dati non disponibili"),
    )
    .join(" · ");
  $("city").append(node);
}
for (const id of ["city", "route"])
  enhanceSelect($(id), hideSearch);
for (const disclosure of document.querySelectorAll(
  ".source > details, .map-help",
))
  enhanceDisclosure(disclosure);
$("notice-dismiss")?.addEventListener("click", () => notice(null));
$("city").disabled = false;
const initialView = readView(location.search, manifest.cities);
selectCity(initialView.city, initialView);
