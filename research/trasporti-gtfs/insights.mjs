// Continuous colour ramp keyed on scheduled minutes per kilometre (0–12).
// Pale sage for fast stretches, through ochre and orange, to deep wine for the
// slowest ones: dark = slow, so the ramp also reads in greyscale.
const rampStops = [
  [0, [166, 201, 182]],
  [2, [127, 181, 154]],
  [3.4, [226, 196, 96]],
  [4.8, [233, 143, 58]],
  [6.6, [197, 64, 40]],
  [9, [122, 22, 38]],
  [12, [72, 10, 26]],
];
const hex = (n) => Math.round(n).toString(16).padStart(2, "0");
// A bus at 30 km/h is quick, a train at 30 km/h is crawling: each network
// type maps its own min/km range onto the same ramp, and the legend says so.
const urbanScale = {
  id: "urban",
  maxMinPerKm: 12,
  classes: [10, 15, 25],
  edges: [0, 5, 10, 15, 20, 25, 30, 40, 60, Infinity],
};
const railScale = {
  id: "rail",
  maxMinPerKm: 3,
  classes: [40, 70, 100],
  edges: [0, 20, 40, 60, 80, 100, 120, 160, 200, Infinity],
};
export const scaleFor = (mode) => (mode === "train" ? railScale : urbanScale);
export function rampColor(minPerKm, scale = urbanScale) {
  const value = (minPerKm * 12) / scale.maxMinPerKm,
    m = Number.isNaN(value) ? 0 : Math.max(0, Math.min(12, value));
  let i = 1;
  while (i < rampStops.length - 1 && rampStops[i][0] < m) i++;
  const [a, ca] = rampStops[i - 1],
    [b, cb] = rampStops[i],
    t = Math.max(0, Math.min(1, (m - a) / (b - a)));
  return "#" + ca.map((v, k) => hex(v + (cb[k] - v) * t)).join("");
}
export const kmhColor = (kmh, scale = urbanScale) =>
  rampColor(kmh > 0 ? 60 / kmh : Infinity, scale);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Network speed = total distance / total scheduled time, so a long slow
// stretch weighs more than a short fast one. Opposite directions stay
// separate segments: km counts stretches, not route length.
export function networkProfile(segments, band) {
  let metres = 0,
    seconds = 0;
  const speeds = [],
    routes = new Set();
  for (const s of segments) {
    const b = s.bands[band];
    if (!b) continue;
    metres += s.metres;
    seconds += b.seconds;
    speeds.push(b.kmh);
    routes.add(s.route);
  }
  return {
    segments: speeds.length,
    routes: routes.size,
    km: metres / 1000,
    kmh: seconds > 0 ? (metres / seconds) * 3.6 : null,
    medianKmh: median(speeds),
  };
}

export function speedHistogram(segments, band, scale = urbanScale) {
  const edges = scale.edges,
    bins = edges.slice(0, -1).map((from, i) => ({
    from,
    to: edges[i + 1],
    km: 0,
    segments: 0,
  }));
  for (const s of segments) {
    const b = s.bands[band];
    if (!b) continue;
    const bin = bins.find((x) => b.kmh >= x.from && b.kmh < x.to);
    if (!bin) continue;
    bin.km += s.metres / 1000;
    bin.segments++;
  }
  return bins;
}

// Short hops and one-off trips are noisy (rounded timetables), so the list
// keeps stretches of at least 150 m with two or more scheduled trips, and one
// stretch per line to show where, not just which line, slows down.
export function slowestSegments(
  segments,
  band,
  { limit = 5, minMetres = 150, minTrips = 2 } = {},
) {
  const best = new Map();
  for (const s of segments) {
    const b = s.bands[band];
    if (!b || s.metres < minMetres || b.samples < minTrips) continue;
    const current = best.get(s.route);
    if (!current || b.kmh < current.bands[band].kmh) best.set(s.route, s);
  }
  return [...best.values()]
    .sort((a, b) => a.bands[band].kmh - b.bands[band].kmh || a.id.localeCompare(b.id))
    .slice(0, limit);
}

// Compare time bands on the same stretches only, otherwise a band with fewer
// (e.g. only suburban) services would look faster or slower for that reason.
export function bandComparison(segments, bands) {
  const common = segments.filter((s) => bands.every((b) => s.bands[b]));
  return bands.map((band) => ({
    band,
    ...networkProfile(common, band),
  }));
}
