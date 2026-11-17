"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap, LngLatBoundsLike } from "maplibre-gl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  RomaRealtimeUnavailable,
  RomaRealtimeVehicle,
  RomaRealtimeVehiclesView,
} from "@/lib/mobilita/roma-gtfs-realtime";
import {
  activeByRoute,
  buildNetwork,
  DELAY_BUCKETS,
  delayBucket,
  displayName,
  formatAge,
  formatDelay,
  formatEta,
  freshness,
  scheduledNow,
  searchStops,
  matchPattern,
  normaliseQuery,
  occupancyLabel,
  searchRoutes,
  upcomingStops,
  vehicleAge,
  vehicleHeading,
  type DelayBucket,
  type Freshness,
  type NetworkPattern,
  type NetworkStop,
  type RomaCoverage,
  type NetworkRoute,
  type PatternMatch,
  type RawRomaNetwork,
  type RomaNetwork,
} from "@/lib/mobilita/roma-live-model";
import { ROMA_COVERAGE_ASSET, ROMA_NETWORK_ASSET } from "@/lib/mobilita/roma-network-asset";
import type { CompactTrip, RomaArrivalsView } from "@/lib/mobilita/roma-trip-updates";
import { getTheme, subscribeToTheme, type Theme } from "@/lib/theme";
import { basemapStyle } from "./map-style";
import { getFavorites, getServerFavorites, subscribeFavorites, toggleFavorite } from "./live-store";
import { VehicleLayer, type DisplayVehicle, type LayerPalette } from "./vehicle-layer";
import styles from "./roma.module.css";

const VEHICLES_URL = "/api/mobilita/roma/vehicles";
const ARRIVALS_URL = "/api/mobilita/roma/arrivals";
const ARRIVALS_POLL_MS = 30_000;
const POLL_MS = 15_000;
const MAX_BACKOFF_MS = 120_000;
const ROMA_CENTER: [number, number] = [12.4964, 41.8986];

type Enriched = {
  vehicle: RomaRealtimeVehicle;
  route: NetworkRoute | null;
  match: PatternMatch | null;
  heading: number | null;
};

type FeedState =
  | { kind: "loading" }
  | { kind: "ok"; view: RomaRealtimeVehiclesView; receivedAt: number }
  | { kind: "error"; error: string; last: RomaRealtimeVehiclesView | null; receivedAt: number | null };

type Selection = {
  routeId: string | null;
  vehicleId: string | null;
  direction: 0 | 1 | null;
  stopId: string | null;
};

const NO_SELECTION: Selection = { routeId: null, vehicleId: null, direction: null, stopId: null };

type ArrivalsState =
  | { kind: "idle" | "loading" }
  | { kind: "ok"; view: RomaArrivalsView; receivedAt: number }
  | { kind: "error"; last: RomaArrivalsView | null };

type StopArrival = { trip: CompactTrip; eta: number; delay: number | null };

const DELAY_COLORS: Record<Theme, Record<DelayBucket, string>> = {
  light: {
    early: "#2563eb",
    ontime: "#1f8a4c",
    late: "#e07a00",
    verylate: "#d62828",
    severe: "#7a1020",
    unknown: "#8f9ba6",
  },
  dark: {
    early: "#60a5fa",
    ontime: "#5fd18f",
    late: "#f5a524",
    verylate: "#ff6b5e",
    severe: "#ff9fb0",
    unknown: "#59636e",
  },
};

const DELAY_LABELS: Record<DelayBucket, string> = {
  early: "in anticipo",
  ontime: "in orario (±2 min)",
  late: "ritardo 2-5 min",
  verylate: "ritardo 5-10 min",
  severe: "ritardo oltre 10 min",
  unknown: "non indicato",
};

const PUNCTUALITY_URL = "/api/mobilita/roma/punctuality";

type Punctuality = {
  status: "ok";
  total: number;
  buckets: Record<DelayBucket, number>;
  stale: boolean;
  fallback?: boolean;
  feedTimestamp: number | null;
};

function percent(part: number, total: number) {
  if (!total) return "0%";
  const value = (part / total) * 100;
  return value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;
}

const PALETTES: Record<Theme, LayerPalette & { accent: string; network: string; casing: string }> = {
  light: {
    vehicle: "#0e6b78",
    vehicleText: "#ffffff",
    labelText: "#1d3040",
    muted: "#8f9ba6",
    halo: "#ffffff",
    stale: "#6b7785",
    user: "#2563eb",
    accent: "#b42332",
    network: "#7f93a3",
    casing: "#ffffff",
  },
  dark: {
    vehicle: "#4cb8c4",
    vehicleText: "#0b1a1e",
    labelText: "#e6ebf0",
    muted: "#59636e",
    halo: "#16191d",
    stale: "#8a949e",
    user: "#60a5fa",
    accent: "#ff7a6b",
    network: "#5d6b78",
    casing: "#16191d",
  },
};

const subscribeNoop = () => () => {};
const serverTheme = (): Theme => "light";

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function vehicleKey(vehicle: RomaRealtimeVehicle) {
  return vehicle.label || vehicle.id;
}

function freshnessText(f: Freshness) {
  return f === "fresh"
    ? "Posizione recente"
    : f === "aging"
      ? "Posizione di qualche minuto fa"
      : f === "stale"
        ? "Posizione non aggiornata"
        : "Ora della posizione non indicata";
}

function directionLabel(route: NetworkRoute, direction: number) {
  const pattern = route.patterns
    .filter((p) => p.direction === direction)
    .sort((a, b) => b.trips - a.trips)[0];
  return pattern ? displayName(pattern.headsign) : null;
}

function routeTitle(route: NetworkRoute) {
  const a = directionLabel(route, 0);
  const b = directionLabel(route, 1);
  if (a && b) return `${b} ↔ ${a}`;
  return a ?? b ?? (route.longName ? displayName(route.longName) : "");
}

function operatorName(route: NetworkRoute | null) {
  if (!route) return null;
  const name = route.agencyName;
  return name === name.toUpperCase() ? displayName(name) : name;
}

function distanceMetres(a: [number, number], b: [number, number]) {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * 111_320 * Math.cos(lat), (b[1] - a[1]) * 110_540);
}

function formatDistance(m: number) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function patternFeature(pattern: NetworkPattern, props: Record<string, unknown> = {}): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { direction: pattern.direction, ...props },
    geometry: { type: "LineString", coordinates: pattern.coords },
  };
}

function boundsOf(coords: Iterable<[number, number]>): LngLatBoundsLike | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX)
    ? [
        [minX, minY],
        [maxX, maxY],
      ]
    : null;
}

async function loadNetwork(signal: AbortSignal): Promise<RomaNetwork> {
  const response = await fetch(ROMA_NETWORK_ASSET.path, { signal });
  if (!response.ok) throw new Error(`network_${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== ROMA_NETWORK_ASSET.bytes) throw new Error("network_size");
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
    if (hex !== ROMA_NETWORK_ASSET.sha256) throw new Error("network_hash");
  }
  return buildNetwork(JSON.parse(new TextDecoder().decode(bytes)) as RawRomaNetwork);
}

type UrlSelection = { linea: string | null; vettura: string | null; fermata: string | null };

function readUrlSelection(): UrlSelection {
  try {
    const params = new URLSearchParams(window.location.search);
    const linea = params.get("linea");
    const vettura = params.get("vettura");
    const fermata = params.get("fermata");
    return {
      linea: linea && /^[0-9A-Za-z]{1,8}$/.test(linea) ? linea : null,
      vettura: vettura && /^[0-9A-Za-z]{1,12}$/.test(vettura) ? vettura : null,
      fermata: fermata && /^[0-9A-Za-z_-]{1,16}$/.test(fermata) ? fermata : null,
    };
  } catch {
    return { linea: null, vettura: null, fermata: null };
  }
}

async function fetchVerified(path: string, sha256: string, bytes: number, signal: AbortSignal) {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`asset_${response.status}`);
  const body = await response.arrayBuffer();
  if (body.byteLength !== bytes) throw new Error("asset_size");
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
    if (hex !== sha256) throw new Error("asset_hash");
  }
  return JSON.parse(new TextDecoder().decode(body)) as unknown;
}

type CoverageIndex = Omit<RomaCoverage, "dates" | "profiles"> & {
  dates: Record<string, { path: string; sha256: string; bytes: number }>;
};

/** Loads only today's and yesterday's profiles (trips after midnight). */
async function loadCoverage(signal: AbortSignal, nowSeconds: number): Promise<RomaCoverage> {
  const index = (await fetchVerified(
    ROMA_COVERAGE_ASSET.path,
    ROMA_COVERAGE_ASSET.sha256,
    ROMA_COVERAGE_ASSET.bytes,
    signal,
  )) as CoverageIndex;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: index.timezone }).format(new Date(nowSeconds * 1000));
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const profiles: Record<string, string>[] = [];
  const dates: Record<string, number> = {};
  for (const date of [yesterday, today]) {
    const entry = index.dates[date];
    if (!entry) continue;
    profiles.push((await fetchVerified(entry.path, entry.sha256, entry.bytes, signal)) as Record<string, string>);
    dates[date] = profiles.length - 1;
  }
  return { ...index, dates, profiles };
}

function LineBadge({ route, routeId, size = "md" }: { route: NetworkRoute | null; routeId?: string; size?: "sm" | "md" | "lg" }) {
  const text = route?.short ?? routeId ?? "?";
  return (
    <span
      className={styles.lineBadge}
      data-size={size}
      data-long={text.length > 3 ? "true" : undefined}
      style={route?.color ? { background: route.color, borderColor: route.color } : undefined}
    >
      <span className={styles.visuallyHidden}>Linea </span>
      {text}
    </span>
  );
}

function FreshDot({ value }: { value: Freshness }) {
  return <span className={styles.freshDot} data-freshness={value} aria-hidden="true" />;
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Icon({ name }: { name: "close" | "locate" | "search" | "follow" | "link" | "chevron" | "back" }) {
  const paths: Record<string, ReactNode> = {
    close: <path d="M6 6l12 12M18 6L6 18" />,
    search: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4.5 4.5" />
      </>
    ),
    locate: (
      <>
        <circle cx="12" cy="12" r="3.2" />
        <circle cx="12" cy="12" r="7.5" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </>
    ),
    follow: <path d="M12 3l7 17-7-4-7 4z" />,
    link: (
      <>
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
        <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
      </>
    ),
    chevron: <path d="M9 6l6 6-6 6" />,
    back: <path d="M15 6l-6 6 6 6" />,
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function RomaLiveMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const layerRef = useRef<VehicleLayer | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [network, setNetwork] = useState<RomaNetwork | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedState>({ kind: "loading" });
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [follow, setFollow] = useState(true);
  const [query, setQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState<"idle" | "pending" | "denied" | "unavailable">("idle");
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pendingUrl = useRef<UrlSelection | null>(null);
  const [colorMode, setColorMode] = useState<"line" | "delay">("line");
  const [perspective, setPerspective] = useState<"2d" | "3d">("2d");
  const [arrivals, setArrivals] = useState<ArrivalsState>({ kind: "idle" });
  const [coverage, setCoverage] = useState<RomaCoverage | null>(null);
  const [punctuality, setPunctuality] = useState<Punctuality | null>(null);
  const theme = useSyncExternalStore(subscribeToTheme, getTheme, serverTheme);
  const favorites = useSyncExternalStore(subscribeFavorites, getFavorites, getServerFavorites);
  const hydrated = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const now = useNow(1000);
  const palette = PALETTES[theme];

  // ---- Data: static network (once) and live feed (polling while visible) ----
  useEffect(() => {
    const controller = new AbortController();
    pendingUrl.current = readUrlSelection();
    loadNetwork(controller.signal).then(
      (value) => setNetwork(value),
      (error: unknown) => {
        if (!controller.signal.aborted) setNetworkError(error instanceof Error ? error.message : "network_error");
      },
    );
    // Coverage is an extra: on failure the page simply omits the comparison.
    loadCoverage(controller.signal, Date.now() / 1000).then(
      (value) => setCoverage(value),
      () => {},
    );
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let timer = 0;
    let failures = 0;
    let controller: AbortController | null = null;
    let lastOk: RomaRealtimeVehiclesView | null = null;
    let lastAt: number | null = null;
    let lastRun = 0;
    const run = async () => {
      window.clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      lastRun = Date.now();
      try {
        const response = await fetch(VEHICLES_URL, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as
          | RomaRealtimeVehiclesView
          | RomaRealtimeUnavailable
          | null;
        if (!response.ok || !payload || payload.status !== "ok" || !Array.isArray(payload.vehicles)) {
          throw new Error(payload && payload.status === "unavailable" ? payload.error : `http_${response.status}`);
        }
        failures = 0;
        lastOk = payload;
        lastAt = Date.now();
        setFeed({ kind: "ok", view: payload, receivedAt: lastAt });
      } catch (error) {
        if (controller.signal.aborted) return;
        failures += 1;
        setFeed({
          kind: "error",
          error: error instanceof Error ? error.message : "error",
          last: lastOk,
          receivedAt: lastAt,
        });
      }
      if (document.visibilityState === "visible") {
        const delay = failures ? Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** failures) : POLL_MS;
        timer = window.setTimeout(run, delay);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        window.clearTimeout(timer);
        return;
      }
      if (Date.now() - lastRun >= POLL_MS) void run();
      else timer = window.setTimeout(run, POLL_MS - (Date.now() - lastRun));
    };
    void run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Predicted arrivals (heavier feed): only while something on screen uses them.
  const needArrivals = Boolean(selection.vehicleId || selection.stopId || colorMode === "delay");
  useEffect(() => {
    if (!needArrivals) return;
    let timer = 0;
    let failures = 0;
    let controller: AbortController | null = null;
    let last: RomaArrivalsView | null = null;
    const run = async () => {
      window.clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(ARRIVALS_URL, { headers: { Accept: "application/json" }, signal: controller.signal });
        const payload = (await response.json().catch(() => null)) as RomaArrivalsView | null;
        if (!response.ok || !payload || payload.status !== "ok" || !Array.isArray(payload.trips)) {
          throw new Error(`http_${response.status}`);
        }
        failures = 0;
        last = payload;
        setArrivals({ kind: "ok", view: payload, receivedAt: Date.now() });
      } catch {
        if (controller.signal.aborted) return;
        failures += 1;
        setArrivals({ kind: "error", last });
      }
      if (document.visibilityState === "visible") {
        timer = window.setTimeout(run, failures ? Math.min(MAX_BACKOFF_MS, ARRIVALS_POLL_MS * 2 ** failures) : ARRIVALS_POLL_MS);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void run();
      else window.clearTimeout(timer);
    };
    void run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [needArrivals]);

  // Punctuality percentages: a few hundred bytes every 30 s while visible.
  useEffect(() => {
    let timer = 0;
    let controller: AbortController | null = null;
    const run = async () => {
      window.clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(PUNCTUALITY_URL, { headers: { Accept: "application/json" }, signal: controller.signal });
        const payload = (await response.json().catch(() => null)) as Punctuality | null;
        if (response.ok && payload?.status === "ok" && payload.buckets) setPunctuality(payload);
      } catch {
        if (controller.signal.aborted) return;
      }
      if (document.visibilityState === "visible") timer = window.setTimeout(run, ARRIVALS_POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void run();
      else window.clearTimeout(timer);
    };
    void run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const view = feed.kind === "ok" ? feed.view : feed.kind === "error" ? feed.last : null;
  const vehicles = useMemo(() => view?.vehicles ?? [], [view]);

  const enriched = useMemo(() => {
    const out = new Map<string, Enriched>();
    for (const vehicle of vehicles) {
      const route = network && vehicle.routeId ? (network.routes.get(vehicle.routeId) ?? null) : null;
      const match = network ? matchPattern(network, vehicle) : null;
      out.set(vehicle.id, { vehicle, route, match, heading: vehicleHeading(vehicle, match) });
    }
    return out;
  }, [vehicles, network]);

  const active = useMemo(() => activeByRoute(vehicles), [vehicles]);
  const nowSeconds = now / 1000;

  // Resolve ?linea=…&vettura=… once both network and first feed are known.
  useEffect(() => {
    const pending = pendingUrl.current;
    if (!pending || !network || feed.kind === "loading") return;
    pendingUrl.current = null;
    const found = pending.vettura
      ? vehicles.find((v) => v.label === pending.vettura || v.id === pending.vettura)
      : undefined;
    const routeId = found?.routeId ?? (pending.linea && network.routes.has(pending.linea) ? pending.linea : null);
    const stopId = pending.fermata && network.stopById.has(pending.fermata) ? pending.fermata : null;
    if (found || routeId || stopId) {
      queueMicrotask(() =>
        setSelection({ routeId: routeId ?? null, vehicleId: found?.id ?? null, direction: null, stopId }),
      );
    }
  }, [network, feed.kind, vehicles]);

  // Keep the address shareable without a navigation (no RSC request).
  useEffect(() => {
    if (!hydrated || pendingUrl.current) return;
    const url = new URL(window.location.href);
    const followed = selection.vehicleId ? enriched.get(selection.vehicleId)?.vehicle : undefined;
    url.searchParams.delete("linea");
    url.searchParams.delete("vettura");
    url.searchParams.delete("fermata");
    if (selection.routeId) url.searchParams.set("linea", selection.routeId);
    if (followed) url.searchParams.set("vettura", vehicleKey(followed));
    if (selection.stopId) url.searchParams.set("fermata", selection.stopId);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [selection, enriched, hydrated]);

  const selectedRoute = selection.routeId && network ? (network.routes.get(selection.routeId) ?? null) : null;
  const followed = selection.vehicleId ? (enriched.get(selection.vehicleId) ?? null) : null;
  // A followed vehicle that left the feed stays referenced but is reported as missing.
  const followedMissing = Boolean(selection.vehicleId && view && !followed);
  const selectedStop = selection.stopId && network ? (network.stopById.get(selection.stopId) ?? null) : null;

  const arrivalsView = arrivals.kind === "ok" ? arrivals.view : arrivals.kind === "error" ? arrivals.last : null;
  const tripsByVehicle = useMemo(() => {
    const map = new Map<string, CompactTrip>();
    for (const trip of arrivalsView?.trips ?? []) if (trip.v && !trip.c) map.set(trip.v, trip);
    return map;
  }, [arrivalsView]);
  const tripsById = useMemo(() => {
    const map = new Map<string, CompactTrip>();
    for (const trip of arrivalsView?.trips ?? []) map.set(trip.t, trip);
    return map;
  }, [arrivalsView]);
  // Prediction for a vehicle: by trip id first (exact), else by vehicle id.
  const tripFor = useCallback(
    (vehicle: RomaRealtimeVehicle | undefined) =>
      vehicle ? ((vehicle.tripId ? tripsById.get(vehicle.tripId) : undefined) ?? tripsByVehicle.get(vehicle.id)) : undefined,
    [tripsById, tripsByVehicle],
  );
  // Seconds elapsed since the arrivals snapshot, so ETAs count down between polls.
  const arrivalsElapsed = arrivalsView ? Math.max(0, Math.round(nowSeconds - arrivalsView.base)) : 0;

  const stopArrivals = useMemo((): StopArrival[] => {
    if (!selection.stopId || !arrivalsView) return [];
    const out: StopArrival[] = [];
    for (const trip of arrivalsView.trips) {
      if (trip.c) continue;
      const i = trip.s.indexOf(selection.stopId);
      if (i < 0) continue;
      const eta = trip.a[i]! - arrivalsElapsed;
      if (eta < -60) continue;
      out.push({ trip, eta, delay: trip.y[i] ?? null });
    }
    return out.sort((a, b) => a.eta - b.eta).slice(0, 20);
  }, [selection.stopId, arrivalsView, arrivalsElapsed]);

  // Scheduled trips in progress now (bus lines only: trams/metro have no AVM feed).
  const minute = Math.floor(nowSeconds / 60);
  const scheduled = useMemo(() => {
    if (!coverage || !network) return null;
    const now = scheduledNow(coverage, minute * 60);
    if (!now) return null;
    const byRoute = new Map<string, number>();
    let total = 0;
    for (const [routeId, count] of now.byRoute) {
      if (network.routes.get(routeId)?.type !== 3) continue;
      byRoute.set(routeId, count);
      total += count;
    }
    return { byRoute, total };
  }, [coverage, network, minute]);

  // ---- Map lifecycle ----
  useEffect(() => {
    let cancelled = false;
    let loadTimer = 0;
    let map: MapLibreMap | null = null;
    import("maplibre-gl")
      .then((maplibregl) => {
        if (cancelled || !containerRef.current || !canvasRef.current) return;
        // The bundler moves maplibre's module away from its worker file: point
        // to the worker as a same-origin, content-hashed static asset.
        maplibregl.setWorkerUrl(
          new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href,
        );
        const instance = new maplibregl.Map({
          container: containerRef.current,
          style: basemapStyle(getTheme()),
          center: ROMA_CENTER,
          zoom: 11.2,
          minZoom: 9,
          maxZoom: 18.5,
          maxPitch: 60,
          maxBounds: [
            [11.7, 41.3],
            [13.3, 42.5],
          ],
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          cooperativeGestures: false,
        });
        map = instance;
        instance.touchZoomRotate.disableRotation();
        instance.touchPitch.disable();
        instance.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");
        instance.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
        mapRef.current = instance;
        layerRef.current = new VehicleLayer(instance, canvasRef.current, PALETTES[getTheme()]);
        let loaded = false;
        instance.on("load", () => {
          loaded = true;
          // On phones the credits start collapsed behind the (i) button.
          if (window.matchMedia("(max-width: 560px)").matches) {
            instance.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
          }
          if (!cancelled) setMapReady(true);
        });
        // Single tile or glyph failures are recoverable and MapLibre retries
        // them; only a basemap that never finishes loading is reported. The
        // listener also keeps MapLibre from logging each one as console.error.
        instance.on("error", () => {});
        loadTimer = window.setTimeout(() => {
          if (!loaded && !cancelled) setMapError("map_timeout");
        }, 20_000);
      })
      .catch(() => {
        if (!cancelled) setMapError("map_unavailable");
      });
    return () => {
      cancelled = true;
      window.clearTimeout(loadTimer);
      layerRef.current?.destroy();
      layerRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Overlay sources/layers: added once the style is ready; recoloured on theme change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const before = "road-name";
    if (!map.getSource("network")) {
      map.addSource("network", { type: "geojson", data: emptyCollection() });
      map.addSource("route", { type: "geojson", data: emptyCollection() });
      map.addSource("trip", { type: "geojson", data: emptyCollection() });
      map.addSource("stops", { type: "geojson", data: emptyCollection() });
      map.addLayer(
        {
          id: "network-line",
          type: "line",
          source: "network",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.4, 13, 1, 16, 2],
            "line-opacity": 0.35,
          },
        },
        before,
      );
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 10] },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 16, 5.5] },
      });
      map.addLayer({
        id: "trip-done",
        type: "line",
        source: "trip",
        filter: ["==", ["get", "part"], "done"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 16, 4],
          "line-dasharray": [1, 1.6],
          "line-opacity": 0.7,
        },
      });
      map.addLayer({
        id: "trip-todo-casing",
        type: "line",
        source: "trip",
        filter: ["==", ["get", "part"], "todo"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 13] },
      });
      map.addLayer({
        id: "trip-todo",
        type: "line",
        source: "trip",
        filter: ["==", ["get", "part"], "todo"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 16, 8] },
      });
      map.addLayer({
        id: "route-arrows",
        type: "symbol",
        source: "route",
        minzoom: 12.5,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 90,
          "text-field": "›",
          "text-font": ["Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 12.5, 14, 16, 20],
          "text-keep-upright": false,
          "text-allow-overlap": true,
          "text-offset": [0, -0.08],
        },
      });
      map.addLayer({
        id: "stops-circle",
        type: "circle",
        source: "stops",
        minzoom: 11,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            ["case", ["get", "next"], 4, 2],
            16,
            ["case", ["get", "next"], 8, 5],
          ],
          "circle-stroke-width": ["case", ["get", "next"], 3, 2],
        },
      });
      map.addLayer({
        id: "stops-label",
        type: "symbol",
        source: "stops",
        minzoom: 13,
        filter: ["any", ["get", "next"], ["get", "terminus"], [">=", ["zoom"], 14.5]],
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["case", ["get", "next"], ["literal", ["Noto Sans Bold"]], ["literal", ["Noto Sans Regular"]]],
          "text-size": ["case", ["get", "next"], 13, 11.5],
          "text-anchor": "left",
          "text-offset": [0.9, 0],
          "text-max-width": 12,
          "text-optional": true,
        },
      });
    }
    map.setPaintProperty("network-line", "line-color", palette.network);
    map.setPaintProperty("route-casing", "line-color", palette.casing);
    map.setPaintProperty("route-line", "line-color", palette.accent);
    map.setPaintProperty("trip-done", "line-color", palette.accent);
    map.setPaintProperty("trip-todo-casing", "line-color", palette.casing);
    map.setPaintProperty("trip-todo", "line-color", palette.accent);
    map.setPaintProperty("route-arrows", "text-color", palette.casing);
    map.setPaintProperty("stops-circle", "circle-color", palette.casing);
    map.setPaintProperty("stops-circle", "circle-stroke-color", palette.accent);
    map.setPaintProperty("stops-label", "text-color", theme === "dark" ? "#e6ebf0" : "#1d3040");
    map.setPaintProperty("stops-label", "text-halo-color", palette.casing);
    map.setPaintProperty("stops-label", "text-halo-width", 1.6);
    layerRef.current?.setPalette(palette);
  }, [mapReady, palette, theme]);

  // 2D: flat, north up, no rotation. 3D: tilted, rotatable, buildings raised.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const three = perspective === "3d";
    if (map.getLayer("building-3d")) {
      map.setLayoutProperty("building-3d", "visibility", three ? "visible" : "none");
      map.setLayoutProperty("building", "visibility", three ? "none" : "visible");
    }
    if (three) {
      map.dragRotate.enable();
      map.touchZoomRotate.enableRotation();
      map.touchPitch.enable();
    } else {
      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();
      map.touchPitch.disable();
    }
    map.easeTo({
      pitch: three ? 55 : 0,
      bearing: three ? -20 : 0,
      zoom: three ? Math.max(map.getZoom(), 14.5) : map.getZoom(),
      duration: 900,
    });
  }, [perspective, mapReady]);

  // Basemap theme: same layer ids, only paint changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const layer of basemapStyle(theme).layers) {
      if (!map.getLayer(layer.id) || !("paint" in layer) || !layer.paint) continue;
      for (const [key, value] of Object.entries(layer.paint)) {
        map.setPaintProperty(layer.id, key as Parameters<MapLibreMap["setPaintProperty"]>[1], value);
      }
    }
  }, [theme, mapReady]);

  // Whole-network context lines.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !network) return;
    const seen = new Set<string>();
    const features: GeoJSON.Feature[] = [];
    for (const pattern of network.patterns) {
      // Skip near-identical variants to keep the layer light.
      const key = `${pattern.routeId}|${pattern.direction}`;
      if (seen.has(key)) continue;
      seen.add(key);
      features.push(patternFeature(pattern));
    }
    (map.getSource("network") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
  }, [mapReady, network]);

  // Selected route, followed trip and stops.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const routeSource = map.getSource("route") as GeoJSONSource | undefined;
    const tripSource = map.getSource("trip") as GeoJSONSource | undefined;
    const stopSource = map.getSource("stops") as GeoJSONSource | undefined;
    if (!routeSource || !tripSource || !stopSource) return;
    const routeFeatures: GeoJSON.Feature[] = [];
    const tripFeatures: GeoJSON.Feature[] = [];
    const stopFeatures: GeoJSON.Feature[] = [];
    const tripMatch = followed?.match ?? null;
    if (network && tripMatch && followed) {
      const coords = tripMatch.pattern.coords;
      const split = Math.min(coords.length - 1, tripMatch.segment + 1);
      const here: [number, number] = [followed.vehicle.lon, followed.vehicle.lat];
      tripFeatures.push({
        type: "Feature",
        properties: { part: "done" },
        geometry: { type: "LineString", coordinates: [...coords.slice(0, split), here] },
      });
      tripFeatures.push({
        type: "Feature",
        properties: { part: "todo" },
        geometry: { type: "LineString", coordinates: [here, ...coords.slice(split)] },
      });
      const { stops } = upcomingStops(network, tripMatch.pattern, followed.vehicle);
      stops.forEach(({ stop, state }, i) => {
        stopFeatures.push({
          type: "Feature",
          properties: {
            name: displayName(stop.name),
            next: state !== "later",
            terminus: i === stops.length - 1,
          },
          geometry: { type: "Point", coordinates: [stop.lon, stop.lat] },
        });
      });
    } else if (selectedStop) {
      stopFeatures.push({
        type: "Feature",
        properties: { name: displayName(selectedStop.name), next: true, terminus: true },
        geometry: { type: "Point", coordinates: [selectedStop.lon, selectedStop.lat] },
      });
    } else if (network && selectedRoute) {
      const patterns = selectedRoute.patterns.filter(
        (p) => selection.direction === null || p.direction === selection.direction,
      );
      // Main variant per direction drawn strong; minor variants still drawn.
      for (const pattern of patterns) routeFeatures.push(patternFeature(pattern));
      const seen = new Set<number>();
      for (const pattern of patterns) {
        pattern.stops.forEach((index, i) => {
          if (seen.has(index)) return;
          seen.add(index);
          const stop = network.stops[index]!;
          stopFeatures.push({
            type: "Feature",
            properties: {
              name: displayName(stop.name),
              next: false,
              terminus: i === pattern.stops.length - 1 || i === 0,
            },
            geometry: { type: "Point", coordinates: [stop.lon, stop.lat] },
          });
        });
      }
    }
    routeSource.setData({ type: "FeatureCollection", features: routeFeatures });
    tripSource.setData({ type: "FeatureCollection", features: tripFeatures });
    stopSource.setData({ type: "FeatureCollection", features: stopFeatures });
    map.setPaintProperty(
      "network-line",
      "line-opacity",
      selectedRoute || followed ? 0.12 : theme === "dark" ? 0.3 : 0.32,
    );
  }, [mapReady, network, selectedRoute, selection.direction, followed, theme, selectedStop]);

  // Vehicles → canvas layer.
  // Buses whose predicted trip still reaches the selected stop.
  const approaching = useMemo(() => {
    const ids = new Set<string>();
    for (const { trip } of stopArrivals) if (trip.v) ids.add(trip.v);
    return ids;
  }, [stopArrivals]);

  const lastFeedAt = feed.kind === "ok" ? feed.receivedAt : feed.kind === "error" ? feed.receivedAt : null;
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !mapReady) return;
    const display: DisplayVehicle[] = [];
    const seconds = Date.now() / 1000;
    const delayColors = DELAY_COLORS[theme];
    for (const { vehicle, route, heading } of enriched.values()) {
      const isFollowed = vehicle.id === selection.vehicleId;
      const onRoute = selection.routeId !== null && vehicle.routeId === selection.routeId;
      const inDirection = selection.direction === null || vehicle.directionId === selection.direction;
      const emphasis: DisplayVehicle["emphasis"] = isFollowed
        ? "followed"
        : selection.vehicleId
          ? "muted"
          : selection.stopId
            ? approaching.has(vehicle.id)
              ? "selected"
              : "muted"
            : selection.routeId
              ? onRoute && inDirection
                ? "selected"
                : "muted"
              : "normal";
      const delayColor =
        colorMode === "delay" && emphasis !== "muted" ? delayColors[delayBucket(tripFor(vehicle)?.d)] : null;
      display.push({
        id: vehicle.id,
        text: route?.short ?? vehicle.routeId ?? "?",
        lon: vehicle.lon,
        lat: vehicle.lat,
        heading,
        freshness: freshness(vehicleAge(vehicle, seconds)),
        emphasis,
        color:
          delayColor ??
          (emphasis === "followed" || emphasis === "selected" ? (route?.color ?? palette.accent) : palette.vehicle),
      });
    }
    layer.setVehicles(display, true);
    // Freshness is recomputed with each feed; the 1 s clock only updates text.
  }, [enriched, selection, mapReady, palette, lastFeedAt, colorMode, tripFor, theme, approaching]);

  useEffect(() => {
    layerRef.current?.setUser(userPosition);
  }, [userPosition, mapReady]);

  useEffect(() => {
    layerRef.current?.setHover(hovered?.id ?? null);
  }, [hovered]);

  // ---- Camera ----
  const isDesktop = useSyncExternalStore(
    (cb) => {
      const media = window.matchMedia("(min-width: 900px)");
      media.addEventListener("change", cb);
      return () => media.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 900px)").matches,
    () => true,
  );
  const padding = useMemo(
    () =>
      isDesktop
        ? { top: 72, bottom: 48, left: 420, right: 72 }
        : {
            top: 56,
            // Mobile sheet heights mirror roma.module.css.
            bottom: sheetOpen ? 420 : selection.routeId || selection.vehicleId || selection.stopId ? 300 : 190,
            left: 28,
            right: 28,
          },
    [isDesktop, sheetOpen, selection.routeId, selection.vehicleId, selection.stopId],
  );

  const fitRoute = useCallback(
    (route: NetworkRoute, direction: 0 | 1 | null) => {
      const map = mapRef.current;
      if (!map) return;
      const coords = route.patterns
        .filter((p) => direction === null || p.direction === direction)
        .flatMap((p) => p.coords);
      const bounds = boundsOf(coords);
      if (bounds) map.fitBounds(bounds, { padding, maxZoom: 15.5, duration: 900 });
    },
    [padding],
  );

  // Follow: keep the tracked bus in view as fixes arrive.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !followed || !follow) return;
    map.easeTo({
      center: [followed.vehicle.lon, followed.vehicle.lat],
      zoom: Math.max(map.getZoom(), 15),
      padding,
      duration: 1500,
    });
  }, [followed, follow, mapReady, padding]);

  // Manual pan stops following, like any navigation app.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const stop = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) setFollow(false);
    };
    map.on("dragstart", stop);
    return () => {
      map.off("dragstart", stop);
    };
  }, [mapReady]);

  // Pointer: hover tooltip and click to follow.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const canvas = map.getCanvas();
    const onMove = (event: { point: { x: number; y: number } }) => {
      const id = layerRef.current?.hitTest(event.point.x, event.point.y) ?? null;
      canvas.style.cursor = id ? "pointer" : "";
      setHovered((current) =>
        id ? { id, x: event.point.x, y: event.point.y } : current === null ? current : null,
      );
    };
    const onLeave = () => setHovered(null);
    const onClick = (event: { point: { x: number; y: number } }) => {
      const id = layerRef.current?.hitTest(event.point.x, event.point.y);
      if (!id) return;
      const hit = enriched.get(id);
      setSelection({ routeId: hit?.vehicle.routeId ?? null, vehicleId: id, direction: null, stopId: null });
      setFollow(true);
      setSheetOpen(false);
      setHovered(null);
    };
    map.on("mousemove", onMove);
    map.on("mouseout", onLeave);
    map.on("click", onClick);
    return () => {
      map.off("mousemove", onMove);
      map.off("mouseout", onLeave);
      map.off("click", onClick);
    };
  }, [mapReady, enriched]);

  // ---- Actions ----
  const selectRoute = useCallback(
    (routeId: string) => {
      const route = network?.routes.get(routeId);
      setHovered(null);
      setSelection({ routeId, vehicleId: null, direction: null, stopId: null });
      setQuery("");
      setSheetOpen(false);
      if (route) fitRoute(route, null);
    },
    [network, fitRoute],
  );

  // From a stop board the stop is kept, so "back" returns to the board.
  const selectVehicle = useCallback((vehicle: RomaRealtimeVehicle, fromStop: string | null = null) => {
    setSelection({ routeId: vehicle.routeId ?? null, vehicleId: vehicle.id, direction: null, stopId: fromStop });
    setFollow(true);
    setQuery("");
    setSheetOpen(false);
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(NO_SELECTION);
    setFollow(true);
  }, []);

  const selectStop = useCallback(
    (stop: NetworkStop) => {
      setHovered(null);
      setSelection({ routeId: null, vehicleId: null, direction: null, stopId: stop.id });
      setQuery("");
      setSheetOpen(false);
      setFollow(false);
      mapRef.current?.easeTo({ center: [stop.lon, stop.lat], zoom: 16, padding, duration: 900 });
    },
    [padding],
  );

  const backToRoute = useCallback(() => {
    if (selection.stopId) {
      setSelection({ ...NO_SELECTION, stopId: selection.stopId });
      const stop = network?.stopById.get(selection.stopId);
      if (stop) mapRef.current?.easeTo({ center: [stop.lon, stop.lat], zoom: 16, padding, duration: 900 });
      return;
    }
    if (!selection.routeId) return clearSelection();
    setSelection({ routeId: selection.routeId, vehicleId: null, direction: null, stopId: null });
    const route = network?.routes.get(selection.routeId);
    if (route) fitRoute(route, null);
  }, [selection.routeId, selection.stopId, network, fitRoute, clearSelection, padding]);

  const setDirection = useCallback(
    (direction: 0 | 1 | null) => {
      setSelection((current) => ({ ...current, direction }));
      if (selectedRoute) fitRoute(selectedRoute, direction);
    },
    [selectedRoute, fitRoute],
  );

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocating("unavailable");
      return;
    }
    setLocating("pending");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point: [number, number] = [position.coords.longitude, position.coords.latitude];
        setUserPosition(point);
        setLocating("idle");
        setSelection(NO_SELECTION);
        mapRef.current?.easeTo({ center: point, zoom: 15, padding, duration: 1000 });
      },
      (error) => setLocating(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, [padding]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" && (target as HTMLInputElement).value) return;
      if (selection.vehicleId) backToRoute();
      else if (selection.routeId || selection.stopId) clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, backToRoute, clearSelection]);

  // A new selection starts at the top of its card, not at the old scroll.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [selection.routeId, selection.vehicleId, selection.stopId]);

  // ---- Derived panel data ----
  const results = useMemo(
    () => (network && query ? searchRoutes(network, vehicles, query) : []),
    [network, vehicles, query],
  );
  const stopResults = useMemo(() => (network && query ? searchStops(network, query) : []), [network, query]);
  // A line number typed directly beats a stop name; headsign matches come last.
  const [directResults, headsignResults] = useMemo(() => {
    const q = normaliseQuery(query);
    const direct = results.filter(
      (r) => r.kind === "vehicle" || (q !== null && r.route.short.toUpperCase().startsWith(q)),
    );
    return [direct, results.filter((r) => !direct.includes(r))];
  }, [results, query]);
  const queryInvalid = query.trim() !== "" && normaliseQuery(query) === null && stopResults.length === 0;

  // Lines that serve a stop (any pattern), for the stop board header.
  const linesAtStop = useMemo(() => {
    if (!network || !selectedStop) return [];
    const ids = new Set<string>();
    for (const pattern of network.patterns) if (pattern.stops.includes(selectedStop.index)) ids.add(pattern.routeId);
    return [...ids]
      .map((id) => network.routes.get(id)!)
      .sort((a, b) => a.short.localeCompare(b.short, "it", { numeric: true }));
  }, [network, selectedStop]);

  // Bus lines with scheduled trips running now but no vehicle in the feed.
  const coverageGaps = useMemo(() => {
    if (!scheduled || !network) return [];
    return [...scheduled.byRoute]
      .filter(([id, count]) => count >= 3 && (active.get(id) ?? 0) === 0)
      .map(([id, count]) => ({ route: network.routes.get(id)!, count }))
      .filter((g) => g.route)
      .sort((a, b) => b.count - a.count)
      .slice(0, 16);
  }, [scheduled, network, active]);
  const busesInFeed = useMemo(() => {
    if (!network) return 0;
    let n = 0;
    for (const [id, count] of active) if (network.routes.get(id)?.type === 3) n += count;
    return n;
  }, [active, network]);

  const routeVehicles = useMemo(() => {
    if (!selection.routeId) return [];
    return [...enriched.values()]
      .filter(
        (e) =>
          e.vehicle.routeId === selection.routeId &&
          (selection.direction === null || e.vehicle.directionId === selection.direction),
      )
      .sort((a, b) => {
        const da = a.vehicle.directionId ?? 9;
        const db = b.vehicle.directionId ?? 9;
        if (da !== db) return da - db;
        const pa = a.match && network ? upcomingStops(network, a.match.pattern, a.vehicle).passed : 0;
        const pb = b.match && network ? upcomingStops(network, b.match.pattern, b.vehicle).passed : 0;
        return pb - pa;
      });
  }, [enriched, selection.routeId, selection.direction, network]);

  const busiest = useMemo(() => {
    if (!network) return [];
    return [...active.entries()]
      .map(([id, count]) => ({ route: network.routes.get(id), count }))
      .filter((r): r is { route: NetworkRoute; count: number } => Boolean(r.route))
      .sort((a, b) => b.count - a.count || a.route.short.localeCompare(b.route.short, "it", { numeric: true }))
      .slice(0, 12);
  }, [active, network]);

  const nearbyStops = useMemo(() => {
    if (!userPosition || !network) return [];
    return network.stops
      .map((stop) => ({ stop, distance: distanceMetres(userPosition, [stop.lon, stop.lat]) }))
      .filter((e) => e.distance <= 500)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);
  }, [network, userPosition]);

  const nearby = useMemo(() => {
    if (!userPosition) return [];
    return [...enriched.values()]
      .map((e) => ({ ...e, distance: distanceMetres(userPosition, [e.vehicle.lon, e.vehicle.lat]) }))
      .filter((e) => e.distance <= 1500)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8);
  }, [enriched, userPosition]);

  const feedAge = view?.feedTimestamp ? Math.max(0, Math.round(nowSeconds - view.feedTimestamp)) : null;
  const vehiclesFallback = view?.fallback === true;
  const statusFreshness: Freshness =
    feed.kind === "error"
      ? "stale"
      : vehiclesFallback || view?.stale
        ? "stale"
        : freshness(feedAge === null ? null : Math.max(0, feedAge - 60));

  const hoveredInfo = hovered ? enriched.get(hovered.id) : undefined;

  // ---- Render ----
  const statusLine = (() => {
    if (feed.kind === "loading") return "Collegamento al feed ufficiale…";
    if (feed.kind === "error" && !feed.last) return "Posizioni live non disponibili in questo momento";
    const count = view?.vehicleCount ?? 0;
    const prefix =
      feed.kind === "error" || vehiclesFallback
        ? "Ultimo dato ricevuto"
        : view?.stale
          ? "Feed non aggiornato"
          : "In diretta";
    return `${prefix} · ${count.toLocaleString("it-IT")} autobus · dati di ${formatAge(feedAge)}`;
  })();

  let panelBody: ReactNode;
  if (query.trim()) {
    panelBody = (
      <section aria-label="Risultati della ricerca" className={styles.section}>
        {queryInvalid ? (
          <p className={styles.muted}>Scrivi un numero di linea (es. 64, 8, H), di vettura o il nome di una fermata.</p>
        ) : !network ? (
          <p className={styles.muted}>Caricamento della rete…</p>
        ) : results.length === 0 && stopResults.length === 0 ? (
          <p className={styles.muted}>Nessuna linea, fermata o vettura corrisponde a «{query.trim()}».</p>
        ) : (
          <>
            {directResults.length > 0 ? (
              <ul className={styles.resultList} aria-label="Linee e vetture">
                {directResults.map((result) =>
                  result.kind === "route" ? (
                    <li key={`r-${result.route.id}`}>
                      <button type="button" className={styles.resultRow} onClick={() => selectRoute(result.route.id)}>
                        <LineBadge route={result.route} />
                        <span className={styles.resultText}>
                          <span className={styles.resultTitle}>{routeTitle(result.route)}</span>
                          <span className={styles.resultMeta}>
                            {result.route.type === 3
                              ? result.active > 0
                                ? `${result.active} autobus ora`
                                : "Nessun autobus localizzato ora"
                              : "Tram/metro: posizioni non pubblicate"}
                          </span>
                        </span>
                        <Icon name="chevron" />
                      </button>
                    </li>
                  ) : (
                    <li key={`v-${result.vehicle.id}`}>
                      <button type="button" className={styles.resultRow} onClick={() => selectVehicle(result.vehicle)}>
                        <LineBadge route={result.route} routeId={result.vehicle.routeId} />
                        <span className={styles.resultText}>
                          <span className={styles.resultTitle}>Vettura {vehicleKey(result.vehicle)}</span>
                          <span className={styles.resultMeta}>Segui questo mezzo</span>
                        </span>
                        <Icon name="chevron" />
                      </button>
                    </li>
                  ),
                )}
              </ul>
            ) : null}
            {stopResults.length > 0 ? (
              <>
                <h2 className={styles.sectionTitle}>Fermate</h2>
                <ul className={styles.resultList} aria-label="Fermate">
                  {stopResults.map((stop) => (
                    <li key={`s-${stop.id}`}>
                      <button type="button" className={styles.resultRow} onClick={() => selectStop(stop)}>
                        <StopGlyph />
                        <span className={styles.resultText}>
                          <span className={styles.resultTitle}>{displayName(stop.name)}</span>
                          <span className={styles.resultMeta}>Fermata {stop.id} · prossimi arrivi</span>
                        </span>
                        <Icon name="chevron" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {headsignResults.length > 0 ? (
              <>
                <h2 className={styles.sectionTitle}>Linee con capolinea «{query.trim()}»</h2>
                <ul className={styles.resultList} aria-label="Linee per capolinea">
                  {headsignResults.map((result) =>
                    result.kind === "route" ? (
                      <li key={`h-${result.route.id}`}>
                        <button type="button" className={styles.resultRow} onClick={() => selectRoute(result.route.id)}>
                          <LineBadge route={result.route} />
                          <span className={styles.resultText}>
                            <span className={styles.resultTitle}>{routeTitle(result.route)}</span>
                            <span className={styles.resultMeta}>
                              {result.route.type === 3 ? `${result.active} autobus ora` : "Tram/metro"}
                            </span>
                          </span>
                          <Icon name="chevron" />
                        </button>
                      </li>
                    ) : null,
                  )}
                </ul>
              </>
            ) : null}
          </>
        )}
      </section>
    );
  } else if (selection.vehicleId) {
    panelBody = (
      <VehiclePanel
        network={network}
        item={followed}
        trip={tripFor(followed?.vehicle)}
        arrivalsElapsed={arrivalsElapsed}
        arrivalsState={arrivals.kind}
        fromStop={selectedStop}
        missing={followedMissing}
        nowSeconds={nowSeconds}
        follow={follow}
        copied={copied}
        onFollow={() => setFollow((v) => !v)}
        onBack={backToRoute}
        onClose={clearSelection}
        onCopy={copyLink}
        onStop={(lon, lat) => {
          setFollow(false);
          mapRef.current?.easeTo({ center: [lon, lat], zoom: Math.max(16, mapRef.current.getZoom()), padding });
        }}
      />
    );
  } else if (selectedStop) {
    panelBody = (
      <StopPanel
        stop={selectedStop}
        network={network!}
        lines={linesAtStop}
        arrivals={stopArrivals}
        state={arrivals.kind}
        enriched={enriched}
        copied={copied}
        onClose={clearSelection}
        onCopy={copyLink}
        onLine={selectRoute}
        onVehicle={(vehicle) => selectVehicle(vehicle, selectedStop.id)}
      />
    );
  } else if (selectedRoute) {
    panelBody = (
      <RoutePanel
        route={selectedRoute}
        network={network!}
        vehicles={routeVehicles}
        direction={selection.direction}
        favorite={favorites.includes(selectedRoute.id)}
        scheduledNow={scheduled ? (scheduled.byRoute.get(selectedRoute.id) ?? 0) : null}
        nowSeconds={nowSeconds}
        copied={copied}
        onDirection={setDirection}
        onVehicle={selectVehicle}
        onClose={clearSelection}
        onFavorite={() => toggleFavorite(selectedRoute.id)}
        onCopy={copyLink}
        onFit={() => fitRoute(selectedRoute, selection.direction)}
      />
    );
  } else {
    panelBody = (
      <>
        {favorites.length > 0 && network ? (
          <section className={styles.section} aria-labelledby="fav-title">
            <h2 id="fav-title" className={styles.sectionTitle}>
              Le tue linee
            </h2>
            <ul className={styles.chipGrid}>
              {favorites.map((id) => {
                const route = network.routes.get(id);
                return (
                  <li key={id}>
                    <button type="button" className={styles.lineChip} onClick={() => selectRoute(id)}>
                      <LineBadge route={route ?? null} routeId={id} size="sm" />
                      <span>{active.get(id) ?? 0} ora</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        <section className={styles.section} aria-labelledby="near-title">
          <div className={styles.sectionHead}>
            <h2 id="near-title" className={styles.sectionTitle}>
              Vicino a te
            </h2>
            <button type="button" className={styles.ghostButton} onClick={locate} disabled={locating === "pending"}>
              <Icon name="locate" />
              {locating === "pending" ? "Ricerca…" : userPosition ? "Aggiorna" : "Usa la mia posizione"}
            </button>
          </div>
          {locating === "denied" ? (
            <p className={styles.muted}>Permesso di posizione negato. Puoi cercare una linea qui sopra.</p>
          ) : locating === "unavailable" ? (
            <p className={styles.muted}>Posizione non disponibile su questo dispositivo.</p>
          ) : userPosition ? (
            <>
            {nearbyStops.length > 0 ? (
              <ul className={styles.resultList} aria-label="Fermate vicine">
                {nearbyStops.map(({ stop, distance }) => (
                  <li key={`ns-${stop.id}`}>
                    <button type="button" className={styles.resultRow} onClick={() => selectStop(stop)}>
                      <StopGlyph />
                      <span className={styles.resultText}>
                        <span className={styles.resultTitle}>{displayName(stop.name)}</span>
                        <span className={styles.resultMeta}>Fermata · prossimi arrivi</span>
                      </span>
                      <span className={styles.rowExtra}>{formatDistance(distance)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {nearby.length === 0 ? (
              <p className={styles.muted}>Nessun autobus localizzato entro 1,5 km.</p>
            ) : (
              <ul className={styles.vehicleList}>
                {nearby.map((e) => (
                  <li key={e.vehicle.id}>
                    <VehicleRow
                      item={e}
                      network={network}
                      nowSeconds={nowSeconds}
                      extra={formatDistance(e.distance)}
                      onSelect={() => selectVehicle(e.vehicle)}
                    />
                  </li>
                ))}
              </ul>
            )}
            </>
          ) : (
            <p className={styles.muted}>
              Mostra fermate e autobus vicini. La posizione resta nel tuo browser e non viene inviata.
            </p>
          )}
        </section>
        {punctuality && punctuality.total > 0 ? (
          <section className={styles.section} aria-labelledby="punct-title">
            <div className={styles.sectionHead}>
              <h2 id="punct-title" className={styles.sectionTitle}>
                Puntualità ora
              </h2>
              <button
                type="button"
                className={styles.linkButton}
                aria-pressed={colorMode === "delay"}
                onClick={() => setColorMode(colorMode === "delay" ? "line" : "delay")}
              >
                {colorMode === "delay" ? "Nascondi sulla mappa" : "Mostra sulla mappa"}
              </button>
            </div>
            <div className={styles.punctualityBar} role="img" aria-label="Distribuzione degli autobus per ritardo">
              {DELAY_BUCKETS.map((bucket) =>
                punctuality.buckets[bucket] > 0 ? (
                  <span
                    key={bucket}
                    style={{
                      width: `${(punctuality.buckets[bucket] / punctuality.total) * 100}%`,
                      background: DELAY_COLORS[theme][bucket],
                    }}
                  />
                ) : null,
              )}
            </div>
            <ul className={styles.punctualityList}>
              {DELAY_BUCKETS.filter((bucket) => bucket !== "unknown" || punctuality.buckets.unknown > 0).map((bucket) => (
                <li key={bucket}>
                  <span className={styles.delayDot} style={{ background: DELAY_COLORS[theme][bucket] }} aria-hidden="true" />
                  <span className={styles.punctualityLabel}>{DELAY_LABELS[bucket]}</span>
                  <strong>{percent(punctuality.buckets[bucket], punctuality.total)}</strong>
                  <span className={styles.punctualityCount}>{punctuality.buckets[bucket].toLocaleString("it-IT")}</span>
                </li>
              ))}
            </ul>
            <p className={styles.footnote}>
              Stima dell’operatore per la prossima fermata di ciascuno dei{" "}
              {punctuality.total.toLocaleString("it-IT")} autobus con previsione, rispetto all’orario programmato.
              {punctuality.fallback
                ? " Il feed ATAC non risponde, mostriamo l’ultimo dato ricevuto sugli arrivi."
                : punctuality.stale
                  ? " Feed degli arrivi non aggiornato da oltre 5 minuti."
                  : ""}
            </p>
          </section>
        ) : null}
        {scheduled && scheduled.total > 0 ? (
          <section className={styles.section} aria-labelledby="cov-title">
            <h2 id="cov-title" className={styles.sectionTitle}>
              Servizio in questo momento
            </h2>
            <p className={styles.coverageLine}>
              <strong>{busesInFeed.toLocaleString("it-IT")}</strong> autobus trasmettono la posizione su{" "}
              <strong>{scheduled.total.toLocaleString("it-IT")}</strong> corse programmate in corso
            </p>
            <div
              className={styles.coverageBar}
              role="img"
              aria-label={`${Math.round((Math.min(busesInFeed, scheduled.total) / scheduled.total) * 100)} per cento`}
            >
              <span style={{ width: `${Math.min(100, (busesInFeed / scheduled.total) * 100)}%` }} />
            </div>
            {coverageGaps.length > 0 ? (
              <>
                <p className={styles.muted}>
                  Linee con corse programmate ora ma nessun autobus nel feed. Possono circolare senza trasmettere la
                  posizione: il dato non dice che sono ferme.
                </p>
                <ul className={styles.chipGrid} aria-label="Linee senza autobus nel feed">
                  {coverageGaps.map(({ route, count }) => (
                    <li key={route.id}>
                      <button type="button" className={styles.lineChip} onClick={() => selectRoute(route.id)}>
                        <LineBadge route={route} size="sm" />
                        <span>0 su {count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}
        {busiest.length > 0 ? (
          <section className={styles.section} aria-labelledby="busy-title">
            <h2 id="busy-title" className={styles.sectionTitle}>
              Linee con più autobus in servizio ora
            </h2>
            <ul className={styles.chipGrid}>
              {busiest.map(({ route, count }) => (
                <li key={route.id}>
                  <button type="button" className={styles.lineChip} onClick={() => selectRoute(route.id)}>
                    <LineBadge route={route} size="sm" />
                    <span>{count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <Explainer />
      </>
    );
  }

  return (
    <div className={styles.shell}>
      <div className={styles.mapArea}>
        <div ref={containerRef} className={styles.map} aria-label="Mappa di Roma con gli autobus in tempo reale" role="region" />
        <canvas ref={canvasRef} className={styles.vehicleCanvas} aria-hidden="true" />
        {hoveredInfo && hovered ? (
          <div
            className={styles.tooltip}
            style={{ transform: `translate(${Math.round(hovered.x + 14)}px, ${Math.round(hovered.y - 14)}px)` }}
            aria-hidden="true"
          >
            <LineBadge route={hoveredInfo.route} routeId={hoveredInfo.vehicle.routeId} size="sm" />
            <span>
              <strong>
                {hoveredInfo.match ? `→ ${displayName(hoveredInfo.match.pattern.headsign)}` : "Percorso non disponibile"}
              </strong>
              <small>
                Vettura {vehicleKey(hoveredInfo.vehicle)} · {formatAge(vehicleAge(hoveredInfo.vehicle, nowSeconds))}
              </small>
            </span>
          </div>
        ) : null}
        {mapError ? (
          <div className={styles.mapNotice} role="alert">
            La cartografia non si è caricata. L’elenco dei mezzi nel pannello resta disponibile.
          </div>
        ) : null}
        {/* Controls stay put; the legend below may grow as data arrives. */}
        <div className={styles.mapControls}>
          <div className={styles.colorToggle} role="group" aria-label="Prospettiva della mappa">
            <button type="button" aria-pressed={perspective === "2d"} onClick={() => setPerspective("2d")}>
              2D
            </button>
            <button type="button" aria-pressed={perspective === "3d"} onClick={() => setPerspective("3d")}>
              3D
            </button>
          </div>
          <div className={styles.colorToggle} role="group" aria-label="Colore dei mezzi">
            <button type="button" aria-pressed={colorMode === "line"} onClick={() => setColorMode("line")}>
              Aggiornamento
            </button>
            <button type="button" aria-pressed={colorMode === "delay"} onClick={() => setColorMode("delay")}>
              Ritardo
            </button>
          </div>
        </div>
        <div className={styles.legend}>
          {colorMode === "delay" ? (
            <span className={styles.legendItems}>
              {DELAY_BUCKETS.filter(
                (bucket) => bucket !== "unknown" || !punctuality || punctuality.buckets.unknown > 0,
              ).map((bucket) => (
                <span key={bucket}>
                  <span className={styles.delayDot} style={{ background: DELAY_COLORS[theme][bucket] }} aria-hidden="true" />
                  {DELAY_LABELS[bucket]}
                  {punctuality && punctuality.total > 0 ? (
                    <strong className={styles.legendPercent}>
                      {percent(punctuality.buckets[bucket], punctuality.total)}
                    </strong>
                  ) : null}
                </span>
              ))}
            </span>
          ) : (
            <span className={styles.legendItems} aria-hidden="true">
              <span>
                <FreshDot value="fresh" /> &lt; 2 min
              </span>
              <span>
                <FreshDot value="aging" /> 2-5 min
              </span>
              <span>
                <FreshDot value="stale" /> più vecchia
              </span>
              <span className={styles.legendArrow}>▲ direzione</span>
            </span>
          )}
        </div>
      </div>

      <aside
        className={styles.panel}
        data-open={sheetOpen ? "true" : "false"}
        data-selected={selection.routeId || selection.vehicleId || selection.stopId ? "true" : "false"}
        aria-label="Autobus di Roma in tempo reale"
        onPointerEnter={() => setHovered(null)}
      >
        <button
          type="button"
          className={styles.sheetHandle}
          aria-expanded={sheetOpen}
          aria-controls="roma-live-panel-body"
          onClick={() => setSheetOpen((v) => !v)}
        >
          <span aria-hidden="true" />
          <span className={styles.visuallyHidden}>{sheetOpen ? "Riduci il pannello" : "Espandi il pannello"}</span>
        </button>
        <header className={styles.panelHeader}>
          <h1 className={styles.title}>Autobus di Roma, ora</h1>
          <p className={styles.status} data-freshness={statusFreshness}>
            <span className={styles.pulse} aria-hidden="true" />
            <span>{statusLine}</span>
          </p>
          {feed.kind === "error" ? (
            <p className={styles.warning} role="status">
              {feed.last
                ? "Il feed ufficiale non risponde: mostriamo l’ultimo dato ricevuto, riproviamo a breve."
                : "Il feed ufficiale non risponde. Riproviamo automaticamente."}
            </p>
          ) : vehiclesFallback ? (
            <p className={styles.warning} role="status">
              Il feed ATAC non risponde, mostriamo l’ultimo dato ricevuto.
            </p>
          ) : view?.stale ? (
            <p className={styles.warning} role="status">
              Il feed ufficiale non si aggiorna da oltre 5 minuti: le posizioni potrebbero non essere attuali.
            </p>
          ) : null}
          {networkError ? (
            <p className={styles.warning} role="status">
              Percorsi e fermate non disponibili: restano le sole posizioni.
            </p>
          ) : null}
          <form
            role="search"
            className={styles.searchBox}
            onSubmit={(event) => {
              event.preventDefault();
              const first = directResults[0];
              if (first?.kind === "route") selectRoute(first.route.id);
              else if (first) selectVehicle(first.vehicle);
              else if (stopResults[0]) selectStop(stopResults[0]);
              else if (headsignResults[0]?.kind === "route") selectRoute(headsignResults[0].route.id);
              else return;
              (document.activeElement as HTMLElement | null)?.blur?.();
            }}
          >
            <Icon name="search" />
            <label className={styles.visuallyHidden} htmlFor="roma-live-search">
              Cerca una linea, una fermata o una vettura
            </label>
            <input
              id="roma-live-search"
              type="search"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Linea (64, H…), fermata o vettura"
              value={query}
              maxLength={24}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSheetOpen(true)}
              enterKeyHint="search"
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
            />
            {query ? (
              <button type="button" className={styles.iconButton} onClick={() => setQuery("")} aria-label="Cancella ricerca">
                <Icon name="close" />
              </button>
            ) : null}
          </form>
        </header>
        <div id="roma-live-panel-body" ref={bodyRef} className={styles.panelBody}>
          {panelBody}
        </div>
      </aside>
    </div>
  );
}

function VehicleRow({
  item,
  network,
  nowSeconds,
  extra,
  onSelect,
}: {
  item: Enriched;
  network: RomaNetwork | null;
  nowSeconds: number;
  extra?: string;
  onSelect: () => void;
}) {
  const age = vehicleAge(item.vehicle, nowSeconds);
  const f = freshness(age);
  const next =
    network && item.vehicle.stopId ? network.stopById.get(item.vehicle.stopId) : undefined;
  return (
    <button type="button" className={styles.vehicleRow} onClick={onSelect}>
      <LineBadge route={item.route} routeId={item.vehicle.routeId} size="sm" />
      <span className={styles.resultText}>
        <span className={styles.resultTitle}>
          {item.match ? `→ ${displayName(item.match.pattern.headsign)}` : "Percorso non disponibile"}
        </span>
        <span className={styles.resultMeta}>
          {next ? `${item.vehicle.status === "stopped" ? "a" : "verso"} ${displayName(next.name)}` : `Vettura ${vehicleKey(item.vehicle)}`}
        </span>
      </span>
      <span className={styles.rowAside}>
        {extra ? <span className={styles.rowExtra}>{extra}</span> : null}
        <span className={styles.age} data-freshness={f}>
          <FreshDot value={f} />
          {formatAge(age)}
        </span>
      </span>
    </button>
  );
}

function StopPanel({
  stop,
  network,
  lines,
  arrivals,
  state,
  enriched,
  copied,
  onClose,
  onCopy,
  onLine,
  onVehicle,
}: {
  stop: NetworkStop;
  network: RomaNetwork;
  lines: NetworkRoute[];
  arrivals: StopArrival[];
  state: ArrivalsState["kind"];
  enriched: Map<string, Enriched>;
  copied: boolean;
  onClose: () => void;
  onCopy: () => void;
  onLine: (routeId: string) => void;
  onVehicle: (vehicle: RomaRealtimeVehicle) => void;
}) {
  return (
    <section className={styles.section} aria-labelledby="stop-title">
      <div className={styles.cardHead}>
        <StopGlyph />
        <div className={styles.cardTitleBlock}>
          <h2 id="stop-title" className={styles.cardTitle}>
            {displayName(stop.name)}
          </h2>
          <p className={styles.resultMeta}>Fermata {stop.id}</p>
        </div>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Chiudi la fermata">
          <Icon name="close" />
        </button>
      </div>
      <h3 className={styles.sectionTitle}>Prossimi arrivi previsti</h3>
      {state === "idle" || (state === "loading" && arrivals.length === 0) ? (
        <p className={styles.muted}>Caricamento degli arrivi…</p>
      ) : state === "error" && arrivals.length === 0 ? (
        <p className={styles.warning}>Il feed degli arrivi non risponde. Riproviamo a breve.</p>
      ) : arrivals.length === 0 ? (
        <p className={styles.notice}>
          {lines.length > 0 && lines.every((route) => route.type !== 3)
            ? "Fermata di metro o tram: il feed ufficiale pubblica arrivi previsti solo per gli autobus."
            : "Nessun arrivo previsto nelle prossime 2 ore nel feed ufficiale per questa fermata."}
        </p>
      ) : (
        <ul className={styles.vehicleList} aria-label="Arrivi">
          {arrivals.map(({ trip, eta, delay }) => {
            const route = trip.r ? (network.routes.get(trip.r) ?? null) : null;
            const pattern =
              route?.patterns.find((p) => p.direction === trip.k && p.stops.includes(stop.index)) ??
              route?.patterns.find((p) => p.stops.includes(stop.index));
            const live = trip.v ? enriched.get(trip.v)?.vehicle : undefined;
            const content = (
              <>
                <LineBadge route={route} routeId={trip.r} size="sm" />
                <span className={styles.resultText}>
                  <span className={styles.resultTitle}>
                    {pattern ? `→ ${displayName(pattern.headsign)}` : `Linea ${trip.r ?? "?"}`}
                  </span>
                  <span className={styles.resultMeta}>
                    {live ? "Localizzato · seguilo" : "Senza posizione live"}
                  </span>
                </span>
                <span className={styles.rowAside}>
                  <span className={styles.eta}>{formatEta(eta)}</span>
                  <DelayChip delay={delay} />
                </span>
              </>
            );
            return (
              <li key={trip.t}>
                {live ? (
                  <button type="button" className={styles.vehicleRow} onClick={() => onVehicle(live)}>
                    {content}
                  </button>
                ) : (
                  <div className={styles.vehicleRow} data-static="true">
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className={styles.footnote}>
        Stime dell’operatore dal feed ufficiale degli arrivi, aggiornate ogni 30 secondi. Possono cambiare o mancare.
      </p>
      {lines.length > 0 ? (
        <>
          <h3 className={styles.sectionTitle}>Linee che fermano qui</h3>
          <ul className={styles.chipGrid} aria-label="Linee che fermano qui">
            {lines.map((route) => (
              <li key={route.id}>
                <button
                  type="button"
                  className={styles.badgeButton}
                  onClick={() => onLine(route.id)}
                  aria-label={`Apri la linea ${route.short}`}
                >
                  <LineBadge route={route} size="sm" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className={styles.actionsRow}>
        <button type="button" className={styles.ghostButton} onClick={onCopy}>
          <Icon name="link" />
          {copied ? "Link copiato" : "Copia link della fermata"}
        </button>
      </div>
    </section>
  );
}

function groupByDirection(items: Enriched[]): [string, Enriched[]][] {
  const groups = new Map<string, Enriched[]>();
  for (const item of items) {
    const key = item.vehicle.directionId === undefined ? "x" : String(item.vehicle.directionId);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()];
}

function RoutePanel({
  scheduledNow,
  route,
  network,
  vehicles,
  direction,
  favorite,
  nowSeconds,
  copied,
  onDirection,
  onVehicle,
  onClose,
  onFavorite,
  onCopy,
  onFit,
}: {
  route: NetworkRoute;
  network: RomaNetwork;
  vehicles: Enriched[];
  direction: 0 | 1 | null;
  favorite: boolean;
  scheduledNow: number | null;
  nowSeconds: number;
  copied: boolean;
  onDirection: (d: 0 | 1 | null) => void;
  onVehicle: (v: RomaRealtimeVehicle) => void;
  onClose: () => void;
  onFavorite: () => void;
  onCopy: () => void;
  onFit: () => void;
}) {
  const directions = ([0, 1] as const).filter((d) => route.patterns.some((p) => p.direction === d));
  const live = route.type === 3;
  return (
    <section className={styles.section} aria-labelledby="route-title">
      <div className={styles.cardHead}>
        <LineBadge route={route} size="lg" />
        <div className={styles.cardTitleBlock}>
          <h2 id="route-title" className={styles.cardTitle}>
            {routeTitle(route) || `Linea ${route.short}`}
          </h2>
          <p className={styles.resultMeta}>{operatorName(route)}</p>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-pressed={favorite}
          aria-label={favorite ? `Togli la linea ${route.short} dalle tue linee` : `Salva la linea ${route.short} nelle tue linee`}
          onClick={onFavorite}
          data-active={favorite ? "true" : undefined}
        >
          <StarIcon filled={favorite} />
        </button>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Chiudi la linea">
          <Icon name="close" />
        </button>
      </div>
      {directions.length > 1 ? (
        <div className={styles.segmented} role="group" aria-label="Direzione">
          <button type="button" aria-pressed={direction === null} onClick={() => onDirection(null)}>
            Entrambe
          </button>
          {directions.map((d) => (
            <button key={d} type="button" aria-pressed={direction === d} onClick={() => onDirection(d)}>
              → {directionLabel(route, d)}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.actionsRow}>
        <button type="button" className={styles.ghostButton} onClick={onFit}>
          Inquadra il percorso
        </button>
        <button type="button" className={styles.ghostButton} onClick={onCopy}>
          <Icon name="link" />
          {copied ? "Link copiato" : "Copia link"}
        </button>
      </div>
      {live && scheduledNow !== null ? (
        <p className={styles.coverageLine}>
          Corse programmate in corso ora: <strong>{scheduledNow}</strong> · autobus nel feed:{" "}
          <strong>{vehicles.length}</strong>
        </p>
      ) : null}
      {!live ? (
        <p className={styles.notice}>
          Tram e metro non pubblicano la posizione dei mezzi nel feed ufficiale: qui vedi solo il percorso.
        </p>
      ) : vehicles.length === 0 ? (
        <p className={styles.notice}>
          In questo momento nessun autobus della linea {route.short} compare nel feed ufficiale delle posizioni. La
          linea può essere fuori servizio a quest’ora, oppure i suoi mezzi non stanno trasmettendo: alcune linee
          mancano spesso dal feed. Il percorso resta visibile sulla mappa.
        </p>
      ) : (
        <>
          <h3 className={styles.sectionTitle}>
            {vehicles.length} autobus in servizio · tocca per seguirlo
          </h3>
          {groupByDirection(vehicles).map(([dir, items]) => (
            <div key={dir} className={styles.group}>
              <h4 className={styles.groupTitle}>
                {dir === "x" ? "Direzione non indicata" : `Verso ${directionLabel(route, Number(dir)) ?? "capolinea"}`}
                <span>{items.length}</span>
              </h4>
              <ul className={styles.vehicleList}>
                {items.map((item) => (
                  <li key={item.vehicle.id}>
                    <VehicleRow
                      item={item}
                      network={network}
                      nowSeconds={nowSeconds}
                      onSelect={() => onVehicle(item.vehicle)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function clock(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  });
}

function DelayChip({ delay }: { delay: number | null | undefined }) {
  const text = formatDelay(delay);
  if (!text) return null;
  return (
    <span className={styles.delayChip} data-bucket={delayBucket(delay)}>
      {text}
    </span>
  );
}

function StopGlyph() {
  return (
    <span className={styles.stopGlyph} aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="6" y="3" width="12" height="11" rx="2" />
        <path d="M12 14v7M9 7h6" />
      </svg>
    </span>
  );
}

function VehiclePanel({
  network,
  item,
  trip,
  arrivalsElapsed,
  arrivalsState,
  fromStop,
  missing,
  nowSeconds,
  follow,
  copied,
  onFollow,
  onBack,
  onClose,
  onCopy,
  onStop,
}: {
  network: RomaNetwork | null;
  item: Enriched | null;
  trip: CompactTrip | undefined;
  arrivalsElapsed: number;
  arrivalsState: ArrivalsState["kind"];
  fromStop: NetworkStop | null;
  missing: boolean;
  nowSeconds: number;
  follow: boolean;
  copied: boolean;
  onFollow: () => void;
  onBack: () => void;
  onClose: () => void;
  onCopy: () => void;
  onStop: (lon: number, lat: number) => void;
}) {
  const [showPassed, setShowPassed] = useState(false);
  if (!item) {
    return (
      <section className={styles.section}>
        <div className={styles.cardHead}>
          <button type="button" className={styles.iconButton} onClick={onBack} aria-label="Indietro">
            <Icon name="back" />
          </button>
          <h2 className={styles.cardTitle}>{missing ? "Mezzo non più visibile" : "Caricamento…"}</h2>
        </div>
        {missing ? (
          <p className={styles.notice}>
            Questo mezzo non compare nell’ultimo aggiornamento: ha probabilmente terminato la corsa o smesso di
            trasmettere la posizione.
          </p>
        ) : null}
      </section>
    );
  }
  const { vehicle, route, match } = item;
  const age = vehicleAge(vehicle, nowSeconds);
  const f = freshness(age);
  const upcoming = network && match ? upcomingStops(network, match.pattern, vehicle) : null;
  const passedStops =
    upcoming && match && network
      ? match.pattern.stops.slice(0, upcoming.passed).map((s) => network.stops[s]!)
      : [];
  const nextStop = upcoming?.stops[0];
  const occupancy = occupancyLabel(vehicle.occupancy);
  return (
    <section className={styles.section} aria-labelledby="vehicle-title">
      <div className={styles.cardHead}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onBack}
          aria-label={fromStop ? "Torna alla fermata" : "Torna alla linea"}
        >
          <Icon name="back" />
        </button>
        <LineBadge route={route} routeId={vehicle.routeId} size="lg" />
        <div className={styles.cardTitleBlock}>
          <h2 id="vehicle-title" className={styles.cardTitle}>
            {match ? `→ ${displayName(match.pattern.headsign)}` : `Linea ${route?.short ?? vehicle.routeId ?? "?"}`}
          </h2>
          <p className={styles.resultMeta}>
            Vettura {vehicleKey(vehicle)}
            {route ? ` · ${operatorName(route)}` : ""}
          </p>
        </div>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Chiudi">
          <Icon name="close" />
        </button>
      </div>

      <div className={styles.liveCard} data-freshness={f}>
        <p className={styles.liveMain}>
          {nextStop && nextStop.state !== "later" ? (
            <>
              {vehicle.status === "stopped" ? "Fermo a " : vehicle.status === "incoming" ? "In arrivo a " : "In viaggio verso "}
              <strong>{displayName(nextStop.stop.name)}</strong>
            </>
          ) : (
            "Prossima fermata non indicata dal feed"
          )}
        </p>
        <p className={styles.liveMeta}>
          <span className={styles.age} data-freshness={f}>
            <FreshDot value={f} />
            {freshnessText(f)} · {formatAge(age)}
          </span>
          {vehicle.startTime ? <span>Partito dal capolinea alle {vehicle.startTime.slice(0, 5)} (orario programmato)</span> : null}
          {occupancy ? <span>Affollamento dichiarato: {occupancy}</span> : null}
          {trip ? (
            <span className={styles.delayLine}>
              Rispetto all’orario: <DelayChip delay={trip.d} />
              {trip.d === null ? "non indicato" : null}
            </span>
          ) : arrivalsState === "loading" || arrivalsState === "idle" ? (
            <span>Caricamento degli arrivi previsti…</span>
          ) : null}
        </p>
        {f === "stale" ? (
          <p className={styles.warning}>
            La posizione non si aggiorna da oltre 5 minuti: il mezzo potrebbe essere fermo, deviato o senza segnale.
          </p>
        ) : null}
      </div>

      <div className={styles.actionsRow}>
        <button type="button" className={styles.primaryButton} aria-pressed={follow} onClick={onFollow}>
          <Icon name="follow" />
          {follow ? "Lo stai seguendo" : "Segui sulla mappa"}
        </button>
        <button type="button" className={styles.ghostButton} onClick={onCopy}>
          <Icon name="link" />
          {copied ? "Link copiato" : "Copia link"}
        </button>
      </div>

      {upcoming && match ? (
        <>
          <h3 className={styles.sectionTitle}>Prossime fermate</h3>
          {passedStops.length > 0 ? (
            <button type="button" className={styles.passedToggle} aria-expanded={showPassed} onClick={() => setShowPassed((v) => !v)}>
              {showPassed ? "Nascondi" : "Mostra"} {passedStops.length} {passedStops.length === 1 ? "fermata già passata" : "fermate già passate"}
            </button>
          ) : null}
          <ol className={styles.timeline}>
            {showPassed
              ? passedStops.map((stop) => (
                  <li key={`p-${stop.id}-${stop.index}`} data-state="passed">
                    <button type="button" onClick={() => onStop(stop.lon, stop.lat)}>
                      {displayName(stop.name)}
                    </button>
                  </li>
                ))
              : null}
            {upcoming.stops.map(({ stop, state }, i) => (
              <li
                key={`u-${stop.id}-${i}`}
                data-state={state}
                data-terminus={i === upcoming.stops.length - 1 ? "true" : undefined}
              >
                <button type="button" onClick={() => onStop(stop.lon, stop.lat)}>
                  <span className={styles.timelineName}>
                    {displayName(stop.name)}
                    {state === "here" ? <em> · qui ora</em> : state === "next" ? <em> · prossima</em> : null}
                    {i === upcoming.stops.length - 1 ? <em> · capolinea</em> : null}
                  </span>
                  {(() => {
                    const k = trip ? trip.s.indexOf(stop.id) : -1;
                    if (!trip || k < 0) return null;
                    const eta = trip.a[k]! - arrivalsElapsed;
                    return (
                      <span className={styles.timelineEta}>
                        {formatEta(eta)}
                        <small>{clock(Math.round(Date.now() / 1000 + eta))}</small>
                      </span>
                    );
                  })()}
                </button>
              </li>
            ))}
          </ol>
          <p className={styles.footnote}>
            {trip
              ? "Orari previsti dal feed ufficiale degli arrivi (stime dell’operatore, aggiornate ogni 30 secondi)."
              : "Ordine delle fermate dal percorso programmato (GTFS). Arrivi previsti non disponibili per questa corsa."}
          </p>
        </>
      ) : (
        <p className={styles.notice}>Percorso di questa corsa non trovato nella rete pubblicata.</p>
      )}
    </section>
  );
}

function Explainer() {
  return (
    <section className={styles.explainer} aria-labelledby="explain-title">
      <h2 id="explain-title" className={styles.sectionTitle}>
        Come leggere la mappa
      </h2>
      <ul>
        <li>
          Ogni segno è un autobus ATAC o Roma TPL che trasmette la sua posizione. La punta indica la direzione di marcia.
        </li>
        <li>
          Avvicinandoti compare il numero di linea. Tocca un mezzo per seguirlo con gli orari previsti alle prossime
          fermate, oppure cerca una fermata per vedere i prossimi arrivi.
        </li>
        <li>
          Le posizioni arrivano con 30-60 secondi di ritardo. Un mezzo tratteggiato non si aggiorna da oltre 5 minuti.
        </li>
        <li>
          Con «Ritardo» i mezzi si colorano secondo la stima dell’operatore: verde in orario (±2 min), arancione
          2-5 min, rosso 5-10 min, bordeaux oltre 10 min, blu in anticipo, grigio non indicato.
        </li>
        <li>Tram e metro non sono nel feed delle posizioni né in quello degli arrivi.</li>
      </ul>
    </section>
  );
}
