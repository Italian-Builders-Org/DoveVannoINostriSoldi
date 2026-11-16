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
  displayName,
  formatAge,
  freshness,
  matchPattern,
  normaliseQuery,
  occupancyLabel,
  searchRoutes,
  upcomingStops,
  vehicleAge,
  vehicleHeading,
  type Freshness,
  type NetworkPattern,
  type NetworkRoute,
  type PatternMatch,
  type RawRomaNetwork,
  type RomaNetwork,
} from "@/lib/mobilita/roma-live-model";
import { ROMA_NETWORK_ASSET } from "@/lib/mobilita/roma-network-asset";
import { getTheme, subscribeToTheme, type Theme } from "@/lib/theme";
import { basemapStyle } from "./map-style";
import { getFavorites, getServerFavorites, subscribeFavorites, toggleFavorite } from "./live-store";
import { VehicleLayer, type DisplayVehicle, type LayerPalette } from "./vehicle-layer";
import styles from "./roma.module.css";

const VEHICLES_URL = "/api/mobilita/roma/vehicles";
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

type Selection = { routeId: string | null; vehicleId: string | null; direction: 0 | 1 | null };

const NO_SELECTION: Selection = { routeId: null, vehicleId: null, direction: null };

const PALETTES: Record<Theme, LayerPalette & { accent: string; network: string; casing: string }> = {
  light: {
    vehicle: "#0e6b78",
    vehicleText: "#ffffff",
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

function readUrlSelection(): { linea: string | null; vettura: string | null } {
  try {
    const params = new URLSearchParams(window.location.search);
    const linea = params.get("linea");
    const vettura = params.get("vettura");
    return {
      linea: linea && /^[0-9A-Za-z]{1,8}$/.test(linea) ? linea : null,
      vettura: vettura && /^[0-9A-Za-z]{1,12}$/.test(vettura) ? vettura : null,
    };
  } catch {
    return { linea: null, vettura: null };
  }
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
  const pendingUrl = useRef<{ linea: string | null; vettura: string | null } | null>(null);
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
    if (found || routeId) {
      queueMicrotask(() =>
        setSelection({ routeId: routeId ?? null, vehicleId: found?.id ?? null, direction: null }),
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
    if (selection.routeId) url.searchParams.set("linea", selection.routeId);
    if (followed) url.searchParams.set("vettura", vehicleKey(followed));
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [selection, enriched, hydrated]);

  const selectedRoute = selection.routeId && network ? (network.routes.get(selection.routeId) ?? null) : null;
  const followed = selection.vehicleId ? (enriched.get(selection.vehicleId) ?? null) : null;
  // A followed vehicle that left the feed stays referenced but is reported as missing.
  const followedMissing = Boolean(selection.vehicleId && view && !followed);

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
        instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
        instance.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
        mapRef.current = instance;
        layerRef.current = new VehicleLayer(instance, canvasRef.current, PALETTES[getTheme()]);
        let loaded = false;
        instance.on("load", () => {
          loaded = true;
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
  }, [mapReady, network, selectedRoute, selection.direction, followed, theme]);

  // Vehicles → canvas layer.
  const lastFeedAt = feed.kind === "ok" ? feed.receivedAt : feed.kind === "error" ? feed.receivedAt : null;
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !mapReady) return;
    const display: DisplayVehicle[] = [];
    const seconds = Date.now() / 1000;
    for (const { vehicle, route, heading } of enriched.values()) {
      const isFollowed = vehicle.id === selection.vehicleId;
      const onRoute = selection.routeId !== null && vehicle.routeId === selection.routeId;
      const inDirection = selection.direction === null || vehicle.directionId === selection.direction;
      const emphasis: DisplayVehicle["emphasis"] = isFollowed
        ? "followed"
        : selection.routeId
          ? onRoute && inDirection
            ? "selected"
            : "muted"
          : selection.vehicleId
            ? "muted"
            : "normal";
      display.push({
        id: vehicle.id,
        text: route?.short ?? vehicle.routeId ?? "?",
        lon: vehicle.lon,
        lat: vehicle.lat,
        heading,
        freshness: freshness(vehicleAge(vehicle, seconds)),
        emphasis,
        color:
          emphasis === "followed" || emphasis === "selected" ? (route?.color ?? palette.accent) : palette.vehicle,
      });
    }
    layer.setVehicles(display, true);
    // Freshness is recomputed with each feed; the 1 s clock only updates text.
  }, [enriched, selection, mapReady, palette, lastFeedAt]);

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
            bottom: sheetOpen ? 420 : selection.routeId || selection.vehicleId ? 300 : 190,
            left: 28,
            right: 28,
          },
    [isDesktop, sheetOpen, selection.routeId, selection.vehicleId],
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
      setSelection({ routeId: hit?.vehicle.routeId ?? null, vehicleId: id, direction: null });
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
      setSelection({ routeId, vehicleId: null, direction: null });
      setQuery("");
      setSheetOpen(false);
      if (route) fitRoute(route, null);
    },
    [network, fitRoute],
  );

  const selectVehicle = useCallback((vehicle: RomaRealtimeVehicle) => {
    setSelection({ routeId: vehicle.routeId ?? null, vehicleId: vehicle.id, direction: null });
    setFollow(true);
    setQuery("");
    setSheetOpen(false);
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(NO_SELECTION);
    setFollow(true);
  }, []);

  const backToRoute = useCallback(() => {
    if (!selection.routeId) return clearSelection();
    setSelection({ routeId: selection.routeId, vehicleId: null, direction: null });
    const route = network?.routes.get(selection.routeId);
    if (route) fitRoute(route, null);
  }, [selection.routeId, network, fitRoute, clearSelection]);

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
      else if (selection.routeId) clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, backToRoute, clearSelection]);

  // A new selection starts at the top of its card, not at the old scroll.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [selection.routeId, selection.vehicleId]);

  // ---- Derived panel data ----
  const results = useMemo(
    () => (network && query ? searchRoutes(network, vehicles, query) : []),
    [network, vehicles, query],
  );
  const queryInvalid = query.trim() !== "" && normaliseQuery(query) === null;

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

  const nearby = useMemo(() => {
    if (!userPosition) return [];
    return [...enriched.values()]
      .map((e) => ({ ...e, distance: distanceMetres(userPosition, [e.vehicle.lon, e.vehicle.lat]) }))
      .filter((e) => e.distance <= 1500)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8);
  }, [enriched, userPosition]);

  const feedAge = view?.feedTimestamp ? Math.max(0, Math.round(nowSeconds - view.feedTimestamp)) : null;
  const statusFreshness: Freshness =
    feed.kind === "error" ? "stale" : view?.stale ? "stale" : freshness(feedAge === null ? null : Math.max(0, feedAge - 60));

  const hoveredInfo = hovered ? enriched.get(hovered.id) : undefined;

  // ---- Render ----
  const statusLine = (() => {
    if (feed.kind === "loading") return "Collegamento al feed ufficiale…";
    if (feed.kind === "error" && !feed.last) return "Posizioni live non disponibili in questo momento";
    const count = view?.vehicleCount ?? 0;
    const prefix = feed.kind === "error" ? "Ultimo dato ricevuto" : view?.stale ? "Feed non aggiornato" : "In diretta";
    return `${prefix} · ${count.toLocaleString("it-IT")} autobus · dati di ${formatAge(feedAge)}`;
  })();

  let panelBody: ReactNode;
  if (query.trim()) {
    panelBody = (
      <section aria-label="Risultati della ricerca" className={styles.section}>
        {queryInvalid ? (
          <p className={styles.muted}>Scrivi un numero di linea (es. 64, 8, H, C2) o di vettura.</p>
        ) : !network ? (
          <p className={styles.muted}>Caricamento della rete…</p>
        ) : results.length === 0 ? (
          <p className={styles.muted}>Nessuna linea o vettura corrisponde a «{query.trim()}».</p>
        ) : (
          <ul className={styles.resultList}>
            {results.map((result) =>
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
        )}
      </section>
    );
  } else if (selection.vehicleId) {
    panelBody = (
      <VehiclePanel
        network={network}
        item={followed}
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
  } else if (selectedRoute) {
    panelBody = (
      <RoutePanel
        route={selectedRoute}
        network={network!}
        vehicles={routeVehicles}
        direction={selection.direction}
        favorite={favorites.includes(selectedRoute.id)}
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
            nearby.length === 0 ? (
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
            )
          ) : (
            <p className={styles.muted}>
              Mostra gli autobus entro 1,5 km. La posizione resta nel tuo browser e non viene inviata.
            </p>
          )}
        </section>
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
        <div className={styles.legend} aria-hidden="true">
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
        </div>
      </div>

      <aside
        className={styles.panel}
        data-open={sheetOpen ? "true" : "false"}
        data-selected={selection.routeId || selection.vehicleId ? "true" : "false"}
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
              const first = results[0];
              if (!first) return;
              if (first.kind === "route") selectRoute(first.route.id);
              else selectVehicle(first.vehicle);
              (document.activeElement as HTMLElement | null)?.blur?.();
            }}
          >
            <Icon name="search" />
            <label className={styles.visuallyHidden} htmlFor="roma-live-search">
              Cerca una linea o una vettura
            </label>
            <input
              id="roma-live-search"
              type="search"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Cerca linea (64, 8, H…) o vettura"
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

function groupByDirection(items: Enriched[]): [string, Enriched[]][] {
  const groups = new Map<string, Enriched[]>();
  for (const item of items) {
    const key = item.vehicle.directionId === undefined ? "x" : String(item.vehicle.directionId);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()];
}

function RoutePanel({
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

function VehiclePanel({
  network,
  item,
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
        <button type="button" className={styles.iconButton} onClick={onBack} aria-label="Torna alla linea">
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
                  {displayName(stop.name)}
                  {state === "here" ? <em> · qui ora</em> : state === "next" ? <em> · prossima</em> : null}
                  {i === upcoming.stops.length - 1 ? <em> · capolinea</em> : null}
                </button>
              </li>
            ))}
          </ol>
          <p className={styles.footnote}>
            Ordine delle fermate dal percorso programmato (GTFS). Gli orari di arrivo non sono stimati qui.
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
        <li>Avvicinandoti compare il numero di linea. Tocca un mezzo per seguirlo e vedere le prossime fermate.</li>
        <li>
          Le posizioni arrivano con 30-60 secondi di ritardo. Un mezzo tratteggiato non si aggiorna da oltre 5 minuti.
        </li>
        <li>Tram e metro non sono nel feed delle posizioni.</li>
      </ul>
    </section>
  );
}
