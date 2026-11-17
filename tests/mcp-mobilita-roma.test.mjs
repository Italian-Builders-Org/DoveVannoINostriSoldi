import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { fField, mField, sField, vField } from "./helpers/gtfs-rt-encoder.mjs";

const {
  mobilitaRomaBusLiveInputSchema,
  queryMobilitaRomaBusLive,
} = await import("../src/lib/mcp/mobilita-roma-bus-live.ts");
const { resetRomaMobilitaRealtimeForTests } = await import("../src/lib/mobilita/roma-vehicles-shared.ts");
const { measureMcpToolWireBytes, MAX_MCP_TOOL_RESPONSE_BYTES } = await import("../src/lib/mcp/server.ts");
const {
  mobilityLiveToolsCatalog,
  MOBILITA_ROMA_BUS_LIVE_UI_URI,
  MOBILITY_LIVE_TOOLS_URI,
} = await import("../src/lib/mcp/mobility-live-catalog.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
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

test("mobilita MCP catalog entry is discoverable via mobility live tools resource", () => {
  assert.equal(MOBILITY_LIVE_TOOLS_URI, "dvns://mobility-live-tools");
  assert.ok(mobilityLiveToolsCatalog.some((entry) => entry.mcpTool === "mobilita_roma_bus_live"));
  assert.equal(mobilityLiveToolsCatalog[0].uiResource, MOBILITA_ROMA_BUS_LIVE_UI_URI);
  assert.ok(Array.isArray(datasetCatalog));
  assert.ok(datasetCatalog.length > 0);
});

test("mobilita tool input schema rejects unknown fields and malformed linea", () => {
  const parsed = mobilitaRomaBusLiveInputSchema.safeParse({ linea: "64", limit: 50 });
  assert.equal(parsed.success, true);
  assert.equal(mobilitaRomaBusLiveInputSchema.safeParse({ linea: "64", extra: true }).success, false);
  assert.equal(mobilitaRomaBusLiveInputSchema.safeParse({ linea: "linea-lunga-invalida" }).success, false);
});

test("mobilita tool filters by linea", async () => {
  resetRomaMobilitaRealtimeForTests();
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
  resetRomaMobilitaRealtimeForTests();
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
  assert.match(result.error ?? "", /non è raggiungibile/i);
  assert.equal(result.notice.length > 0, true);
});

test("mobilita tool uses a feed budget below the MCP handler deadline", async () => {
  const { MCP_VEHICLES_FEED_FETCH_BUDGET_MS } = await import("../src/lib/mobilita/roma-gtfs-realtime.ts");
  assert.equal(MCP_VEHICLES_FEED_FETCH_BUDGET_MS, 10_000);
});

test("mobilita tool serves last-good on slow body within its feed budget", async () => {
  resetRomaMobilitaRealtimeForTests();
  const bytes = feed([
    vehicleEntity({ entityId: "1", routeId: "64", vehicleId: "v1", lat: 41.9012, lon: 12.5004, timestamp: 1_794_840_562 }),
  ]);
  const tick = { now: 1_794_840_620_000 };
  await queryMobilitaRomaBusLive({}, {
    fetchImpl: okFetch(bytes),
    now: () => tick.now,
  });
  const started = Date.now();
  tick.now += 11_000;
  const slow = await queryMobilitaRomaBusLive({}, {
    fetchImpl: async (_url, init) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "TimeoutError"));
          });
        }),
    }),
    now: () => tick.now,
    feedFetchBudgetMs: 800,
  });
  assert.ok(Date.now() - started < 12_000, "tool must finish before MCP handler timeout");
  assert.equal(slow.ok, true);
  assert.equal(slow.fallback, true);
  assert.equal(slow.returned, 1);
});

test("mobilita tool returns ok false on timeout without last-good", async () => {
  resetRomaMobilitaRealtimeForTests();
  const started = Date.now();
  const timeout = await queryMobilitaRomaBusLive({}, {
    fetchImpl: async () => {
      throw new DOMException("aborted", "TimeoutError");
    },
    now: () => Date.now(),
    feedFetchBudgetMs: 300,
  });
  assert.ok(Date.now() - started < 12_000);
  assert.equal(timeout.ok, false);
  assert.match(timeout.error ?? "", /lento a rispondere/i);
  assert.ok(!timeout.error?.includes("-32000"));
});

test("mobilita tool reports a slow upstream separately from unreachable errors", async () => {
  resetRomaMobilitaRealtimeForTests();
  const timeout = await queryMobilitaRomaBusLive({}, {
    fetchImpl: async () => {
      throw new DOMException("aborted", "TimeoutError");
    },
    now: () => Date.now(),
  });
  assert.equal(timeout.ok, false);
  assert.match(timeout.error ?? "", /lento a rispondere/i);
});

test("mobilita tool wire payload stays below 750000 bytes with ~1500 vehicles", async () => {
  resetRomaMobilitaRealtimeForTests();
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

test("mobilita MCP App CSP declares OpenFreeMap domains for Liberty tiles", () => {
  assert.deepEqual(MOBILITA_ROMA_MCP_APP_CSP.connectDomains, ["https://tiles.openfreemap.org"]);
  assert.deepEqual(MOBILITA_ROMA_MCP_APP_CSP.resourceDomains, ["blob:", "https://tiles.openfreemap.org"]);
});