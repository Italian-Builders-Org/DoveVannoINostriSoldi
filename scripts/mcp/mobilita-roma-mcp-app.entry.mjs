/**
 * Bundled into the MCP App HTML resource (see scripts/ci/build-mcp-mobilita-app.mjs).
 * Uses ext-apps handshake and MapLibre 6.x with an inline worker blob (no CDN).
 */
import { App } from "@modelcontextprotocol/ext-apps/app-with-deps";
import { Map, NavigationControl, setWorkerUrl } from "maplibre-gl";

const OPENFREEMAP_LIBERTY = "https://tiles.openfreemap.org/styles/liberty";

if (typeof __MAPLIBRE_WORKER__ === "string" && __MAPLIBRE_WORKER__.length > 0) {
  setWorkerUrl(
    URL.createObjectURL(new Blob([__MAPLIBRE_WORKER__], { type: "text/javascript" })),
  );
}

function vehiclesToGeoJSON(vehicles) {
  return {
    type: "FeatureCollection",
    features: vehicles
      .filter((v) => typeof v?.lon === "number" && typeof v?.lat === "number")
      .map((v) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [v.lon, v.lat] },
        properties: { linea: v.linea ?? "?" },
      })),
  };
}

function fitMapToVehicles(map, geojson) {
  const coords = geojson.features
    .map((feature) => feature.geometry?.coordinates)
    .filter((pair) => Array.isArray(pair) && pair.length >= 2);
  if (coords.length === 0) return;
  if (coords.length === 1) {
    map.easeTo({ center: coords[0], zoom: Math.max(map.getZoom(), 13) });
    return;
  }
  let minLon = coords[0][0];
  let minLat = coords[0][1];
  let maxLon = coords[0][0];
  let maxLat = coords[0][1];
  for (const [lon, lat] of coords) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  map.fitBounds(
    [
      [minLon, minLat],
      [maxLon, maxLat],
    ],
    { padding: 48, maxZoom: 15, duration: 0 },
  );
}

function ensureVehicleLayers(map, geojson, options = {}) {
  const source = map.getSource("vehicles");
  if (source) {
    source.setData(geojson);
    if (options.fitBounds) fitMapToVehicles(map, geojson);
    return;
  }
  map.addSource("vehicles", { type: "geojson", data: geojson });
  map.addLayer({
    id: "vehicles-circles",
    type: "circle",
    source: "vehicles",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 7],
      "circle-color": "#1d4ed8",
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });
}

function applyToolResult(params) {
  const structured = params?.structuredContent;
  if (!structured?.ok || !Array.isArray(structured.vehicles)) return;
  const fitBounds = typeof structured.linea === "string" && structured.linea.length > 0;
  if (!window.__dvnsMobilitaMap || !window.__dvnsMobilitaMapReady) {
    window.__dvnsMobilitaPendingVehicles = structured.vehicles;
    window.__dvnsMobilitaPendingFitBounds = fitBounds;
    return;
  }
  ensureVehicleLayers(
    window.__dvnsMobilitaMap,
    vehiclesToGeoJSON(structured.vehicles),
    { fitBounds },
  );
}

const app = new App(
  { name: "dvns-mobilita-roma-bus", version: "1.0.0" },
  {},
  { autoResize: true, allowUnsafeEval: false },
);

app.addEventListener("toolresult", applyToolResult);

async function boot() {
  await app.connect();

  const map = new Map({
    container: "map",
    style: OPENFREEMAP_LIBERTY,
    center: [12.4964, 41.8986],
    zoom: 11,
    attributionControl: true,
  });
  window.__dvnsMobilitaMap = map;
  map.addControl(new NavigationControl({ showCompass: true }), "top-right");

  map.on("load", () => {
    window.__dvnsMobilitaMapReady = true;
    const pending = window.__dvnsMobilitaPendingVehicles;
    const pendingFit = window.__dvnsMobilitaPendingFitBounds === true;
    if (Array.isArray(pending)) {
      ensureVehicleLayers(map, vehiclesToGeoJSON(pending), { fitBounds: pendingFit });
      delete window.__dvnsMobilitaPendingVehicles;
      delete window.__dvnsMobilitaPendingFitBounds;
    }
    window.__dvnsMapReady = true;
  });
}

boot().catch((error) => {
  console.error("MCP mobilita app failed", error);
  window.__dvnsMobilitaBootError = String(error);
});
