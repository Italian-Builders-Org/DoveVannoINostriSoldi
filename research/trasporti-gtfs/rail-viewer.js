import { enhanceDisclosure } from "./disclosure.mjs";
import { enhanceSelect, syncSelectMenus } from "./select-menu.mjs";
const rail = JSON.parse(document.getElementById("rail-data").textContent);
if (rail.schemaVersion !== 1 || rail.metric !== "observed-station-delay")
  throw Error("Formato ferroviario non supportato.");
const field = document.getElementById("rail-train"),
  content = document.getElementById("rail-content"),
  chart = document.getElementById("rail-chart"),
  status = document.getElementById("rail-status"),
  exportButton = document.getElementById("rail-export");
let journey = null;
const label = (s) =>
  s
    .toLocaleLowerCase("it")
    .replace(/(^|\s)\p{L}/gu, (m) => m.toLocaleUpperCase("it"));
const shortLabel = (s, limit) =>
  s.length > limit ? s.slice(0, limit - 1).trimEnd() + "…" : s;
const minutes = (value) =>
  value === null
    ? "—"
    : (value > 0 ? "+" : value < 0 ? "−" : "") + Math.abs(value) + " min";
function text(id, value) {
  document.getElementById(id).textContent = value;
}
function node(tag, value, parent) {
  const e = document.createElement(tag);
  if (value !== undefined) e.textContent = value;
  parent.append(e);
  return e;
}
// Href targets are constants / digit-only interpolations — never raw strings from #rail-data.
const ART_DATASET_LANDING =
  "https://bdt.autorita-trasporti.it/catalogo-opendata/dataset/?id=18";
const VIAGGIATRENO_SCHEDA =
  "https://www.viaggiatreno.it/vt_pax_internet/mobile/scheda";

function viaggiatrenoHref(trainNumber) {
  if (typeof trainNumber !== "string" || !/^[0-9]{1,6}$/.test(trainNumber)) {
    throw new Error("numero treno non valido");
  }
  return (
    VIAGGIATRENO_SCHEDA +
    "?dettaglio=visualizza&numeroTreno=" +
    trainNumber +
    "&tipoRicerca=numero&lang=IT"
  );
}
const empty = document.createElement("option");
empty.value = "";
empty.textContent = "Scegli una corsa";
empty.disabled = true;
field.append(empty);
for (const j of rail.journeys) {
  const option = document.createElement("option");
  option.value = j.id;
  option.textContent =
    j.category +
    " " +
    j.number +
    " · " +
    label(j.origin) +
    " → " +
    label(j.destination);
  option.dataset.subtitle = new Date(
    j.serviceDate + "T12:00:00",
  ).toLocaleDateString("it-IT");
  field.append(option);
}
function drawChart() {
  chart.replaceChildren();
  if (!journey || chart.clientWidth < 1) return;
  const width = chart.clientWidth,
    height = chart.clientHeight,
    left = 32,
    right = width - 14,
    top = 30,
    bottom = height - 30,
    rows = journey.observations,
    observed = rows.filter((r) => r.delayMinutes !== null),
    low = Math.min(
      -5,
      Math.floor(Math.min(...observed.map((r) => r.delayMinutes)) / 5) * 5,
    ),
    high = Math.max(
      5,
      Math.ceil(Math.max(...observed.map((r) => r.delayMinutes)) / 5) * 5,
    ),
    x = (i) => left + (i * (right - left)) / (rows.length - 1),
    y = (value) => bottom - ((value - low) * (bottom - top)) / (high - low);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    "Ritardo alle fermate, in minuti. Valori completi nella tabella.",
  );
  const add = (tag, attrs, value) => {
    const e = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, v] of Object.entries(attrs))
      e.setAttribute(key, String(v));
    if (value !== undefined) e.textContent = value;
    svg.append(e);
    return e;
  };
  const step = high - low > 25 ? 10 : 5;
  for (let tick = Math.ceil(low / step) * step; tick <= high; tick += step) {
    add("line", {
      x1: left,
      y1: y(tick),
      x2: right,
      y2: y(tick),
      stroke: tick === 0 ? "#b9c0c3" : "#e8eaeb",
      "stroke-dasharray": tick === 0 ? "3 3" : "none",
    });
    add("text", { x: left - 8, y: y(tick) + 3, "text-anchor": "end" }, tick);
  }
  add("text", { x: 4, y: 13 }, "min");
  let path = "",
    active = false;
  rows.forEach((r, i) => {
    if (r.delayMinutes === null) {
      active = false;
      return;
    }
    path += `${active ? "L" : "M"}${x(i)},${y(r.delayMinutes)} `;
    active = true;
  });
  add("path", {
    d: path,
    fill: "none",
    stroke: "#1d2427",
    "stroke-width": 2.3,
    "stroke-linejoin": "round",
    "stroke-linecap": "round",
  });
  rows.forEach((r, i) => {
    if (r.delayMinutes !== null)
      add("circle", {
        cx: x(i),
        cy: y(r.delayMinutes),
        r: 3.5,
        fill:
          r.delayMinutes === journey.peakDelayMinutes ? "#c54028" : "#1d2427",
        stroke: "white",
        "stroke-width": 1.5,
      });
  });
  add(
    "text",
    { x: left, y: height - 6 },
    shortLabel(label(journey.origin), 18),
  );
  add(
    "text",
    { x: right, y: height - 6, "text-anchor": "end" },
    shortLabel(label(journey.destination), 18),
  );
  const peakIndex = rows.findIndex(
      (r) => r.delayMinutes === journey.peakDelayMinutes,
    ),
    peak = rows[peakIndex],
    onRight = x(peakIndex) > width / 2;
  const peakLabel = add(
    "text",
    {
      x: Math.max(left, Math.min(right, x(peakIndex) + (onRight ? -8 : 8))),
      y: Math.max(17, y(peak.delayMinutes) - 12),
      "text-anchor": onRight ? "end" : "start",
      class: "peak-label",
    },
    shortLabel(label(peak.station), 24) + " " + minutes(peak.delayMinutes),
  );
  chart.append(svg);
  const box = peakLabel.getBBox();
  if (box.x < 4)
    peakLabel.setAttribute(
      "x",
      Number(peakLabel.getAttribute("x")) + 4 - box.x,
    );
  else if (box.x + box.width > width - 4)
    peakLabel.setAttribute(
      "x",
      Number(peakLabel.getAttribute("x")) - (box.x + box.width - width + 4),
    );
}
function delayColor(m) {
  if (m === null) return null;
  if (m < 0) return "#a6c9b6";
  if (m <= 2) return "#e6e9ea";
  if (m <= 5) return "#efcd78";
  if (m <= 10) return "#e98f3a";
  if (m <= 20) return "#c54028";
  return "#7a1626";
}
const dateLabel = (d) =>
  new Date(d + "T12:00:00").toLocaleDateString("it-IT", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
function renderHistory(j) {
  const train = rail.history?.trains.find((t) => t.number === j.number),
    panel = document.getElementById("rail-history");
  panel.hidden = !train;
  if (!train) return;
  const days = train.days.length;
  text(
    "rail-history-note",
    days === 1
      ? "Una sola giornata salvata per questo treno: servono più rilevazioni per vedere se i ritardi si ripetono."
      : days +
          " giornate salvate. Ogni cella è il ritardo rilevato in quella stazione; le celle vuote sono passaggi non rilevati o solo previsti. Poche giornate non dimostrano una tendenza.",
  );
  const table = document.getElementById("rail-heatmap");
  table.replaceChildren();
  const head = node("thead", undefined, table),
    top = node("tr", undefined, head);
  node("th", "Stazione", top).scope = "col";
  for (const d of train.days) {
    const th = node("th", dateLabel(d.serviceDate), top);
    th.scope = "col";
    if (d.id === j.id) th.className = "current";
  }
  if (days > 1) node("th", "Media", top).scope = "col";
  const body = node("tbody", undefined, table);
  for (const s of train.stations) {
    const row = node("tr", undefined, body),
      name = node("th", label(s.station), row);
    name.scope = "row";
    s.delays.forEach((m, i) => {
      const cell = node("td", m === null ? "" : minutes(m).replace(" min", ""), row),
        color = delayColor(m);
      if (color) cell.style.setProperty("--c", color);
      else cell.className = "none";
      if (m !== null && m > 10) cell.classList.add("dark");
      if (train.days[i].id === j.id) cell.classList.add("current");
      cell.title =
        label(s.station) +
        ", " +
        dateLabel(train.days[i].serviceDate) +
        ": " +
        (m === null ? "non rilevato" : minutes(m));
    });
    if (days > 1)
      node(
        "td",
        s.meanDelayMinutes === null
          ? "—"
          : (s.meanDelayMinutes > 0 ? "+" : "") +
              s.meanDelayMinutes.toLocaleString("it-IT"),
        row,
      ).className = "mean";
  }
  const foot = node("tfoot", undefined, table),
    arrival = node("tr", undefined, foot);
  node("th", "Arrivo", arrival).scope = "row";
  for (const d of train.days)
    node(
      "td",
      d.arrivalDelayMinutes === null ? "—" : minutes(d.arrivalDelayMinutes),
      arrival,
    );
  if (days > 1) node("td", "", arrival);
}
function renderContext() {
  const c = rail.context;
  if (!c) {
    document.getElementById("rail-context").hidden = true;
    return;
  }
  text("rail-context-note", c.note);
  const bars = document.getElementById("rail-context-bars"),
    top = Math.max(...c.rows.map((r) => r.lateShare));
  bars.replaceChildren();
  for (const r of c.rows) {
    const row = node("div", undefined, bars);
    row.className = "context-row";
    node("span", String(r.year), row);
    const track = node("span", undefined, row);
    track.className = "context-track";
    const fill = node("i", undefined, track);
    fill.style.width = (r.lateShare / top) * 100 + "%";
    node(
      "strong",
      (r.lateShare * 100).toLocaleString("it-IT", {
        maximumFractionDigits: 1,
      }) + "% in ritardo",
      row,
    );
  }
  const source = document.getElementById("rail-context-source");
  source.replaceChildren(c.publisher + ", ");
  const a = node("a", c.dataset, source);
  a.href = ART_DATASET_LANDING;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  source.append(" · " + c.license);
}
function render() {
  journey = rail.journeys.find((j) => j.id === field.value) || null;
  content.hidden = !journey;
  status.hidden = Boolean(journey);
  exportButton.disabled = !journey;
  text("rail-date", "");
  if (!journey) {
    status.textContent =
      "Corsa non disponibile in queste rilevazioni. Scegline una dal menu.";
    return;
  }
  const j = journey;
  text(
    "rail-date",
    "Corsa del " +
      new Date(j.serviceDate + "T12:00:00").toLocaleDateString("it-IT"),
  );
  text("rail-route", label(j.origin) + " → " + label(j.destination));
  text(
    "rail-coverage",
    j.coverage.observedStops + "/" + j.coverage.stops + " fermate rilevate",
  );
  text(
    "rail-arrival",
    j.arrivalDelayMinutes === null
      ? "Non rilevato"
      : minutes(j.arrivalDelayMinutes),
  );
  document
    .getElementById("rail-arrival")
    .classList.toggle("unobserved", j.arrivalDelayMinutes === null);
  text("rail-peak", minutes(j.peakDelayMinutes));
  text(
    "rail-increase",
    j.largestIncrease ? minutes(j.largestIncrease.minutes) : "—",
  );
  text(
    "rail-increase-leg",
    j.largestIncrease
      ? label(j.observations[j.largestIncrease.fromIndex].station) +
          " → " +
          label(j.observations[j.largestIncrease.toIndex].station)
      : "Nessun aumento fra passaggi consecutivi rilevati",
  );
  const rows = document.getElementById("rail-rows");
  rows.replaceChildren();
  for (const r of j.observations) {
    const row = node("tr", undefined, rows);
    row.classList.toggle("unobserved", r.observed === null);
    node("td", label(r.station), row);
    node("td", r.scheduled, row);
    node("td", r.observed ?? "—", row);
    for (const value of [r.delayMinutes, r.deltaMinutes]) {
      const cell = node("td", minutes(value), row);
      if (value > 0) cell.className = "loss";
      else if (value < 0) cell.className = "recovery";
    }
  }
  const source = document.getElementById("rail-source");
  source.href = viaggiatrenoHref(j.number);
  text(
    "rail-acquired",
    "Rilevazione salvata: " +
      new Date(j.source.acquiredAt).toLocaleString("it-IT", {
        timeZone: "Europe/Rome",
      }),
  );
  text(
    "rail-digest",
    (j.source.kind === "public-browser-dom-extract"
      ? "Estratto salvato (titolo, stazioni e orari della pagina). "
      : "Pagina salvata. ") +
      "SHA-256: " +
      j.source.sha256,
  );
  renderHistory(j);
  drawChart();
}
field.addEventListener("change", () => {
  const j = rail.journeys.find((j) => j.id === field.value),
    url = new URL(location.href);
  if (j) {
    url.searchParams.set("train", j.number);
    url.searchParams.set("date", j.serviceDate);
    history.replaceState(null, "", url);
  }
  render();
  syncSelectMenus();
});
exportButton.addEventListener("click", () => {
  if (!journey) return;
  const url = URL.createObjectURL(
      new Blob(["\ufeff", journey.csv], { type: "text/csv;charset=utf-8" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "treno-" + journey.id + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
const query = new URL(location.href).searchParams,
  requested = query.has("train") || query.has("date"),
  initial = requested
    ? rail.journeys.find(
        (j) =>
          j.number === query.get("train") &&
          (!query.has("date") || j.serviceDate === query.get("date")),
      )
    : rail.journeys[0];
field.value = initial?.id || "";
enhanceSelect(field);
renderContext();
render();
new ResizeObserver(drawChart).observe(chart);

for (const details of document.querySelectorAll(".source details"))
  enhanceDisclosure(details);
