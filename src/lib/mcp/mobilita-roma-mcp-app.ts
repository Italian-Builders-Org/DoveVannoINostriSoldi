import { MOBILITA_ROMA_BUS_LIVE_UI_URI } from "@/lib/mcp/mobility-live-catalog";

/** CSP allowlists for the MCP App map (OpenFreeMap tiles + MapLibre from jsDelivr). */
export const MOBILITA_ROMA_MCP_APP_CSP = {
  connectDomains: ["https://tiles.openfreemap.org"],
  resourceDomains: [
    "https://cdn.jsdelivr.net",
    "https://tiles.openfreemap.org",
  ],
} as const;

const MAPLIBRE_VERSION = "4.7.1";

export function mobilitaRomaBusLiveAppHtml(): string {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Bus Roma live</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css" />
  <style>
    html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
  </style>
</head>
<body>
  <div id="map" style="display:block;width:100%;height:100%"></div>
  <script type="module">
    import maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/+esm";

    const mapEl = document.getElementById("map");
    const workerUrl = "https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl-csp-worker.js";
    maplibregl.setWorkerUrl(workerUrl);

    const map = new maplibregl.Map({
      container: mapEl,
      style: {
        version: 8,
        sources: {
          openfreemap: {
            type: "vector",
            url: "https://tiles.openfreemap.org/planet",
          },
        },
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#e8e0d8" },
          },
        ],
      },
      center: [12.4964, 41.8986],
      zoom: 11,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");

    let markers = [];

    function clearMarkers() {
      for (const marker of markers) marker.remove();
      markers = [];
    }

    function renderVehicles(vehicles) {
      clearMarkers();
      if (!Array.isArray(vehicles) || vehicles.length === 0) return;
      const bounds = new maplibregl.LngLatBounds();
      for (const vehicle of vehicles) {
        if (typeof vehicle.lon !== "number" || typeof vehicle.lat !== "number") continue;
        const el = document.createElement("div");
        el.textContent = vehicle.linea ?? "?";
        el.style.cssText =
          "background:#1d4ed8;color:#fff;font-size:11px;font-weight:600;padding:2px 5px;border-radius:999px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)";
        markers.push(new maplibregl.Marker({ element: el }).setLngLat([vehicle.lon, vehicle.lat]).addTo(map));
        bounds.extend([vehicle.lon, vehicle.lat]);
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
    }

    function applyPayload(payload) {
      if (!payload || typeof payload !== "object") return;
      if (payload.ok === true && Array.isArray(payload.vehicles)) renderVehicles(payload.vehicles);
    }

    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.structuredContent) applyPayload(data.structuredContent);
      else if (data.type === "tool-result" && data.result?.structuredContent) {
        applyPayload(data.result.structuredContent);
      }
    });

    if (window.parent !== window) {
      window.parent.postMessage({ type: "mcp-app:ready", uri: ${JSON.stringify(MOBILITA_ROMA_BUS_LIVE_UI_URI)} }, "*");
    }
  </script>
</body>
</html>`;
}