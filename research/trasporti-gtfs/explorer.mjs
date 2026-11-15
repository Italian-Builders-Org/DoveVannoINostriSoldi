export const normalizeText = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export const stopLabel = (name) =>
  name.replace(/^Fermata\s+\d+\s*[-–]\s*/i, "");
export function buildStopIndex(city) {
  const routes = new Map();
  for (const s of city.segments)
    for (const id of [s.fromId, s.toId]) {
      if (!routes.has(id)) routes.set(id, new Set());
      routes.get(id).add(s.route);
    }
  const seen = new Set();
  return (city.stops ?? [])
    .filter((s) => routes.has(s.id))
    .map((s) => {
      if (seen.has(s.id)) throw Error("Duplicate stop identity");
      seen.add(s.id);
      if (
        !Array.isArray(s.point) ||
        s.point.length !== 2 ||
        !s.point.every(Number.isFinite) ||
        Math.abs(s.point[0]) > 180 ||
        Math.abs(s.point[1]) > 85
      )
        throw Error("Invalid stop coordinate");
      return {
        ...s,
        label: stopLabel(s.name),
        search: normalizeText(stopLabel(s.name)),
        routes: [...routes.get(s.id)].sort((a, b) =>
          a.localeCompare(b, "it", { numeric: true }),
        ),
      };
    });
}
export function searchStops(index, query, route = "", limit = 8) {
  const q = normalizeText(query).slice(0, 80),
    tokens = q.split(" ");
  if (!q) return [];
  return index
    .filter(
      (s) =>
        (!route || s.routes.includes(route)) &&
        (s.id.toLowerCase() === q || tokens.every((t) => s.search.includes(t))),
    )
    .map((s) => ({
      s,
      score:
        s.id.toLowerCase() === q || s.search === q
          ? 0
          : s.search.startsWith(q)
            ? 1
            : 2,
    }))
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.s.label.localeCompare(b.s.label, "it") ||
        a.s.id.localeCompare(b.s.id),
    )
    .slice(0, Math.max(0, Math.min(20, limit)))
    .map((x) => x.s);
}
export function selectSegments(
  segments,
  {
    band,
    route = "",
    speedClass = null,
    sort = "speed-asc",
    classes = [10, 15, 25],
  },
) {
  const field =
    sort === "trips-asc" || sort === "trips-desc" ? "samples" : "kmh";
  const direction = sort === "speed-desc" || sort === "trips-desc" ? -1 : 1;
  return segments
    .filter(
      (s) =>
        s.bands[band] &&
        (!route || s.route === route) &&
        (speedClass === null ||
          (s.bands[band].kmh < classes[0]
            ? 0
            : s.bands[band].kmh < classes[1]
              ? 1
              : s.bands[band].kmh < classes[2]
                ? 2
                : 3) === speedClass),
    )
    .sort((a, b) => {
      return (
        direction * (a.bands[band][field] - b.bands[band][field]) ||
        a.id.localeCompare(b.id)
      );
    });
}
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
  if (/[",\r\n]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
  return text;
}
export function selectionCSV(city, segments, band) {
  const rows = [
    [
      "id_tratto",
      "citta",
      "data_servizio",
      "fascia",
      "linea",
      "direzione_gtfs",
      "da_id",
      "da_fermata",
      "a_id",
      "a_fermata",
      "distanza_m",
      "tempo_programmato_mediano_s",
      "velocita_programmata_kmh",
      "corse_programmate_fascia",
      "fonte_url",
      "sha256_feed",
    ],
  ];
  for (const s of segments) {
    const b = s.bands[band];
    if (!b) continue;
    rows.push([
      s.id,
      city.name,
      city.serviceDate,
      band,
      s.route,
      s.direction,
      s.fromId,
      s.from,
      s.toId,
      s.to,
      s.metres,
      b.seconds,
      b.kmh,
      b.samples,
      city.url,
      city.receipt.sha256,
    ]);
  }
  return (
    "\uFEFF" +
    rows.map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}
