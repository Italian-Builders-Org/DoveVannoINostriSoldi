import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { fField, mField, sField, vField } from "./helpers/gtfs-rt-encoder.mjs";

const {
  mobilitaRomaBusLiveInputSchema,
  queryMobilitaRomaBusLive,
} = await import("../src/lib/mcp/mobilita-roma-bus-live.ts");
const { measureMcpToolWireBytes, MAX_MCP_TOOL_RESPONSE_BYTES } = await import("../src/lib/mcp/server.ts");
const { mobilityLiveToolsCatalog, MOBILITA_ROMA_BUS_LIVE_UI_URI } = await import("../src/lib/mcp/mobility-live-catalog.ts");
const { dvnsMcpCatalogPayload } = await import("../src/lib/mcp/catalog-payload.ts");
const { MOBILITA_ROMA_MCP_APP_CSP } = await import("../src/lib/mcp/mobilita-roma-mcp-app.ts");

function vehicleEntity({ entityId, routeId, vehicleId, lat, lon, timestamp }) {
  const trip = [...sField(5, routeId), ...vField(6, 0)];
  const position = [...fField(1, lat), ...fField(2, lon)];
  const descriptor = [...sField(1, vehicleId)];
  const vehicle = [
    ...mField(1, trip),
    ...mField(8, descriptor),
    ...mField(2, position),
    ...vField(4, 2),
    ...vField(5, timestamp),
  ];
  return mField(2, [...sField(1, entityId), ...vField(2, 0), ...mField(4, vehicle)]);
}

function feed(entities, timestamp = 1_794_840_598) {
  const header = [...sField(1, "2.0"), ...vField(2, 0), ...vField(3, timestamp)];
  return Uint8Array.from([...mField(1, header), ...entities.flat()]);
}

function okFetch(bytes) {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
}

test("mobilita MCP catalog entry is discoverable in dvns://datasets payload", () => {
  assert.ok(dvnsMcpCatalogPayload.mobilityLiveTools.some((entry) => entry.mcpTool === "mobilita_roma_bus_live"));
  assert.equal(mobilityLiveToolsCatalog[0].uiResource, MOBILITA_ROMA_BUS_LIVE_UI_URI);
});

test("mobilita tool input schema rejects unknown fields and malformed linea", () => {
  const parsed = mobilitaRomaBusLiveInputSchema.safeParse({ linea: "64", limit: 50 });
  assert.equal(parsed.success, true);
  assert.equal(mobilitaRomaBusLiveInputSchema.safeParse({ linea: "64", extra: true }).success, false);
  assert.equal(mobilitaRomaBusLiveInputSchema.safeParse({ linea: "linea-lunga-invalida" }).success, false);
});

test("mobilita tool filters by linea", async () => {
  const entities = [
    vehicleEntity({ entityId: "1", routeId: "64", vehicleId: "v1", lat: 41.9012, lon: 12.5004, timestamp: 1_794_840_562 }),
    vehicleEntity({ entityId: "2", routeId: "492", vehicleId: "v2", lat: 41.905, lon: 12.51, timestamp: 1_794_840_562 }),
  ];
  const bytes = feed(entities);
  const result = await queryMobilitaRomaBusLive({ linea: "64" }, {
    fetchImpl: okFetch(bytes),
    now: () => 1_794_840_620_000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.returned, 1);
  assert.equal(result.vehicles?.[0]?.linea, "64");
  assert.match(result.portalUrl, /linea=64/);
});

test("mobilita tool fails closed when the upstream feed is down", async () => {
  const result = await queryMobilitaRomaBusLive({}, {
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    }),
    now: () => Date.now(),
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /feed_mobilita_non_disponibile/i);
  assert.equal(result.notice.length > 0, true);
});

test("mobilita tool wire payload stays below 750000 bytes with ~1500 vehicles", async () => {
  const entities = [];
  for (let index = 0; index < 1_500; index += 1) {
    const routeId = String((index % 120) + 1);
    const lat = 41.9 + (index % 50) * 0.002;
    const lon = 12.45 + (index % 50) * 0.002;
    entities.push(vehicleEntity({
      entityId: String(index + 1),
      routeId,
      vehicleId: `bus-${index}`,
      lat,
      lon,
      timestamp: 1_794_840_562,
    }));
  }
  const bytes = feed(entities);
  const result = await queryMobilitaRomaBusLive({}, {
    fetchImpl: okFetch(bytes),
    now: () => 1_794_840_620_000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.returned, 1_500);
  const wireBytes = measureMcpToolWireBytes(result);
  assert.ok(
    wireBytes <= MAX_MCP_TOOL_RESPONSE_BYTES,
    `payload troppo grande: ${wireBytes} byte`,
  );
});

test("mobilita MCP App CSP declares OpenFreeMap and MapLibre CDN domains", () => {
  assert.ok(MOBILITA_ROMA_MCP_APP_CSP.connectDomains.includes("https://tiles.openfreemap.org"));
  assert.ok(MOBILITA_ROMA_MCP_APP_CSP.resourceDomains.includes("https://cdn.jsdelivr.net"));
  assert.ok(MOBILITA_ROMA_MCP_APP_CSP.resourceDomains.includes("https://tiles.openfreemap.org"));
});