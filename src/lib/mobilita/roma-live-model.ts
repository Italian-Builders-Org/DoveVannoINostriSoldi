/**
 * Pure model for the Roma live map: static network index, vehicle → pattern
 * matching, heading, upcoming stops, search and freshness. No DOM, no fetch.
 */
import type { RomaRealtimeVehicle } from "./roma-gtfs-realtime";

export const ROMA_NETWORK_SCHEMA = 1;

export type RawRomaNetwork = {
  schema: number;
  source: Record<string, unknown>;
  agencies: Record<string, string>;
  routes: [id: string, short: string, type: number, color: string, agency: string, long: string][];
  stops: [id: string, name: string, lon: number, lat: number][];
  patterns: [
    route: number,
    direction: number,
    headsign: string,
    stops: number[],
    polyline: string,
    trips: number,
  ][];
};

export type LonLat = [number, number];

export type NetworkStop = { id: string; name: string; lon: number; lat: number; index: number };

export type NetworkPattern = {
  index: number;
  routeId: string;
  direction: number;
  headsign: string;
  stops: number[];
  trips: number;
  coords: LonLat[];
};

export type NetworkRoute = {
  id: string;
  short: string;
  /** GTFS route_type: 0 tram, 1 metro, 2 rail, 3 bus. */
  type: number;
  /** Publisher colour as #RRGGBB, or null when the feed does not declare one. */
  color: string | null;
  agency: string;
  agencyName: string;
  longName: string;
  patterns: NetworkPattern[];
};

export type RomaNetwork = {
  source: Record<string, unknown>;
  routes: Map<string, NetworkRoute>;
  routeList: NetworkRoute[];
  stops: NetworkStop[];
  stopById: Map<string, NetworkStop>;
  patterns: NetworkPattern[];
};

export function decodePolyline(encoded: string): LonLat[] {
  const points: LonLat[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    for (let axis = 0; axis < 2; axis += 1) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        if (index >= encoded.length) throw new Error("polyline_truncated");
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lon += delta;
    }
    points.push([lon / 1e5, lat / 1e5]);
  }
  return points;
}

export function buildNetwork(raw: RawRomaNetwork): RomaNetwork {
  if (!raw || raw.schema !== ROMA_NETWORK_SCHEMA) throw new Error("network_schema");
  const stops: NetworkStop[] = raw.stops.map(([id, name, lon, lat], index) => ({
    id,
    name,
    lon,
    lat,
    index,
  }));
  const stopById = new Map(stops.map((stop) => [stop.id, stop]));
  const routeList: NetworkRoute[] = raw.routes.map(([id, short, type, color, agency, longName]) => ({
    id,
    short,
    type,
    color: /^[0-9A-F]{6}$/i.test(color) ? `#${color.toUpperCase()}` : null,
    agency,
    agencyName: raw.agencies[agency] ?? agency,
    longName,
    patterns: [],
  }));
  const routes = new Map(routeList.map((route) => [route.id, route]));
  const patterns: NetworkPattern[] = [];
  raw.patterns.forEach(([routeIndex, direction, headsign, stopIndexes, polyline, trips], index) => {
    const route = routeList[routeIndex];
    if (!route || stopIndexes.some((s) => !stops[s])) return;
    const pattern: NetworkPattern = {
      index,
      routeId: route.id,
      direction,
      headsign,
      stops: stopIndexes,
      trips,
      coords: decodePolyline(polyline),
    };
    route.patterns.push(pattern);
    patterns.push(pattern);
  });
  return { source: raw.source, routes, routeList, stops, stopById, patterns };
}

const DEG = Math.PI / 180;

/** Local equirectangular metres; adequate at city scale. */
function toXY([lon, lat]: LonLat, refLat: number): [number, number] {
  return [lon * 111_320 * Math.cos(refLat * DEG), lat * 110_540];
}

export type PatternMatch = {
  pattern: NetworkPattern;
  /** Index of the polyline segment closest to the vehicle. */
  segment: number;
  /** Distance from the vehicle to the path, metres. */
  distance: number;
};

function nearestOnPath(coords: LonLat[], point: LonLat) {
  const p = toXY(point, point[1]);
  let best = Infinity;
  let segment = 0;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = toXY(coords[i]!, point[1]);
    const b = toXY(coords[i + 1]!, point[1]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
    const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    if (d < best) {
      best = d;
      segment = i;
    }
  }
  return { distance: best, segment };
}

type VehicleLike = Pick<
  RomaRealtimeVehicle,
  "routeId" | "directionId" | "stopId" | "lat" | "lon" | "bearing" | "status"
>;

export function matchPattern(network: RomaNetwork, vehicle: VehicleLike): PatternMatch | null {
  const route = vehicle.routeId ? network.routes.get(vehicle.routeId) : undefined;
  if (!route || route.patterns.length === 0) return null;
  const sameDirection = route.patterns.filter((p) => p.direction === vehicle.directionId);
  const candidates = sameDirection.length > 0 ? sameDirection : route.patterns;
  const stop = vehicle.stopId ? network.stopById.get(vehicle.stopId) : undefined;
  let best: (PatternMatch & { score: number }) | null = null;
  for (const pattern of candidates) {
    const near = nearestOnPath(pattern.coords, [vehicle.lon, vehicle.lat]);
    const servesStop = stop ? pattern.stops.includes(stop.index) : false;
    // Serving the announced stop dominates; then being on the path (150 m
    // tolerance for GPS noise); then the variant with most scheduled trips.
    const score =
      (servesStop ? 0 : 1_000_000) + Math.max(0, near.distance - 150) * 100 - pattern.trips / 1_000;
    if (!best || score < best.score) best = { pattern, ...near, score };
  }
  if (!best) return null;
  return { pattern: best.pattern, segment: best.segment, distance: best.distance };
}

/** Compass degrees (0 = north, clockwise) or null when unknown. */
export function vehicleHeading(vehicle: VehicleLike, match: PatternMatch | null): number | null {
  if (typeof vehicle.bearing === "number" && Number.isFinite(vehicle.bearing)) return vehicle.bearing;
  if (!match || match.distance > 250) return null;
  const coords = match.pattern.coords;
  const a = coords[match.segment];
  const b = coords[match.segment + 1];
  if (!a || !b) return null;
  const [ax, ay] = toXY(a, a[1]);
  const [bx, by] = toXY(b, a[1]);
  if (ax === bx && ay === by) return null;
  const degrees = Math.atan2(bx - ax, by - ay) / DEG;
  return (degrees + 360) % 360;
}

export type UpcomingStop = { stop: NetworkStop; state: "here" | "next" | "later" };

export function upcomingStops(
  network: RomaNetwork,
  pattern: NetworkPattern,
  vehicle: Pick<RomaRealtimeVehicle, "stopId" | "status">,
): { stops: UpcomingStop[]; passed: number } {
  const stop = vehicle.stopId ? network.stopById.get(vehicle.stopId) : undefined;
  const position = stop ? pattern.stops.indexOf(stop.index) : -1;
  if (position < 0) {
    return {
      stops: pattern.stops.map((s) => ({ stop: network.stops[s]!, state: "later" as const })),
      passed: 0,
    };
  }
  return {
    stops: pattern.stops.slice(position).map((s, i) => ({
      stop: network.stops[s]!,
      state: i === 0 ? (vehicle.status === "stopped" ? "here" : "next") : "later",
    })),
    passed: position,
  };
}

export type SearchResult =
  | { kind: "route"; route: NetworkRoute; active: number }
  | { kind: "vehicle"; vehicle: RomaRealtimeVehicle; route: NetworkRoute | null };

const QUERY = /^[0-9A-Z][0-9A-Z .'/-]{0,23}$/;

export function normaliseQuery(query: string): string | null {
  const value = query.trim().toUpperCase().replace(/^LINEA\s+/, "");
  return QUERY.test(value) ? value : null;
}

export function searchRoutes(
  network: RomaNetwork,
  vehicles: readonly RomaRealtimeVehicle[],
  query: string,
  limit = 12,
): SearchResult[] {
  const q = normaliseQuery(query);
  if (!q) return [];
  const active = activeByRoute(vehicles);
  const exact: SearchResult[] = [];
  const prefix: SearchResult[] = [];
  const named: SearchResult[] = [];
  for (const route of network.routeList) {
    const short = route.short.toUpperCase();
    const result: SearchResult = { kind: "route", route, active: active.get(route.id) ?? 0 };
    if (short === q || route.id.toUpperCase() === q) exact.push(result);
    else if (short.startsWith(q)) prefix.push(result);
    else if (q.length >= 3 && route.patterns.some((p) => p.headsign.toUpperCase().includes(q))) {
      named.push(result);
    }
  }
  const fleet: SearchResult[] = vehicles
    .filter((v) => v.label?.toUpperCase() === q || v.id.toUpperCase() === q)
    .map((vehicle) => ({
      kind: "vehicle" as const,
      vehicle,
      route: vehicle.routeId ? (network.routes.get(vehicle.routeId) ?? null) : null,
    }));
  const byActivity = (a: SearchResult, b: SearchResult) =>
    (b.kind === "route" ? b.active : 0) - (a.kind === "route" ? a.active : 0);
  prefix.sort((a, b) =>
    a.kind === "route" && b.kind === "route"
      ? a.route.short.length - b.route.short.length || a.route.short.localeCompare(b.route.short, "it", { numeric: true })
      : 0,
  );
  named.sort(byActivity);
  return [...exact, ...fleet, ...prefix, ...named].slice(0, limit);
}

export function activeByRoute(vehicles: readonly RomaRealtimeVehicle[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const vehicle of vehicles) {
    if (vehicle.routeId) counts.set(vehicle.routeId, (counts.get(vehicle.routeId) ?? 0) + 1);
  }
  return counts;
}

export type Freshness = "fresh" | "aging" | "stale" | "unknown";

export const FRESH_SECONDS = 120;
export const STALE_SECONDS = 300;

export function freshness(ageSeconds: number | null): Freshness {
  if (ageSeconds === null || !Number.isFinite(ageSeconds)) return "unknown";
  if (ageSeconds <= FRESH_SECONDS) return "fresh";
  if (ageSeconds <= STALE_SECONDS) return "aging";
  return "stale";
}

export function vehicleAge(vehicle: Pick<RomaRealtimeVehicle, "ts">, nowSeconds: number): number | null {
  return typeof vehicle.ts === "number" ? Math.max(0, Math.round(nowSeconds - vehicle.ts)) : null;
}

export function formatAge(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "ora non indicata";
  if (seconds < 10) return "adesso";
  if (seconds < 90) return `${Math.round(seconds)} s fa`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min fa`;
  return `${Math.floor(seconds / 3600)} h fa`;
}

const OCCUPANCY: Record<number, string> = {
  0: "Vuoto",
  1: "Molti posti liberi",
  2: "Pochi posti liberi",
  3: "Solo posti in piedi",
  4: "Pochi posti in piedi",
  5: "Pieno",
  6: "Non accetta passeggeri",
};

export function occupancyLabel(value: number | undefined): string | null {
  return value === undefined ? null : (OCCUPANCY[value] ?? null);
}

const LOWER = new Set([
  "a", "al", "alla", "alle", "ai", "agli", "da", "dal", "dalla", "dei", "degli", "del", "della",
  "delle", "di", "e", "ed", "in", "con", "per", "su", "sul", "sulla", "tra", "fra",
]);
const ACCENT: Record<string, string> = { a: "à", e: "è", i: "ì", o: "ò", u: "ù" };

/** GTFS names are often ALL CAPS: render them in readable Italian title case. */
export function displayName(value: string): string {
  if (!value) return value;
  let inParens = 0;
  let wordIndex = 0;
  return value.replace(/\(|\)|[^\s()/-]+/g, (token) => {
    if (token === "(") {
      inParens += 1;
      return token;
    }
    if (token === ")") {
      inParens = Math.max(0, inParens - 1);
      return token;
    }
    const first = wordIndex === 0;
    wordIndex += 1;
    if (inParens > 0 || /\d/.test(token) || token.length === 1) return token;
    // Elision: DELL'AMBA → dell'Amba; final apostrophe after a vowel is an accent.
    const parts = token.toLowerCase().split("'");
    const out = parts.map((part, i) => {
      if (!part) return part;
      const cap = part.charAt(0).toUpperCase() + part.slice(1);
      if (i === 0 && parts.length > 1 && parts[1] !== "") return first ? cap : LOWER.has(part) || part.length <= 4 ? part : cap;
      if (i === 0 && !first && LOWER.has(part)) return part;
      return cap;
    });
    let word = out.join("'");
    word = word.replace(/([aeiou])'$/i, (_, vowel: string) => ACCENT[vowel.toLowerCase()] ?? vowel);
    return word;
  });
}
