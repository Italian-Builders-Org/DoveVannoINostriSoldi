import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { istatBesLavoroData: data, istatBesLavoroMetadata: metadata, queryIstatBesLavoro: query } =
  await import("../src/lib/istat-bes-lavoro-snapshot.ts");
const { validateIstatBesLavoroBundle: validate } = await import("../src/lib/data/istat-bes-lavoro-contract.ts");
const { GET } = await import("../src/app/api/territori/bes-lavoro/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") => GET(new NextRequest(`http://localhost/api/territori/bes-lavoro${params}`));

test("Lavoro preserves six measures, units, periods and explicit provenance dates", () => {
  assert.equal(data.observations.length, 19120);
  assert.equal(data.domain.code, "BES_03");
  assert.equal(data.indicators.length, 6);
  const indicators = new Map(data.indicators.map((item) => [item.code, item]));
  assert.equal(indicators.get("03LAV007").unit, "PER_10THOU_EMPL");
  assert.equal(indicators.get("03LAV007").period.to, 2022);
  assert.equal(indicators.get("03LAV004P").period.from, 2008);
  assert.match(indicators.get("03LAV004P").description, /312 giorni/);
  assert.equal(metadata.source.publicationDate, "2025-07-01");
  assert.equal(metadata.source.dataflowLastUpdate, "2025-06-30T15:22:06.201Z");
  assert.equal(metadata.source.acquisitionDate, "2026-09-12");
  assert.equal(metadata.source.licenseId, "not-declared");
  assert.equal(metadata.semantics.soldi.present, false);
});

test("geography preserves composites, external parents and historical identities", () => {
  assert.equal(data.territories.length, 135);
  assert.equal(data.territories.filter((item) => item.kind === "provincia").length, 107);
  const territories = new Map(data.territories.map((item) => [item.code, item]));
  assert.equal(territories.get("ITCD").kind, "composite");
  assert.deepEqual(territories.get("ITFG").parts, ["ITF", "ITG"]);
  assert.equal(territories.get("ITD10").parentOutsideDataset, "ITD1");
  assert.equal(territories.get("ITD20").parentOutsideDataset, "ITD2");
  assert.ok(query({ territory: "ITG25" }).pagination.total > 0);
  assert.throws(() => query({ territory: "015146" }), /Territorio non riconosciuto/);
});

test("HTTP and MCP agree on g null while absent years stay absent", async () => {
  const params = "?territorio=IT108&indicatore=03LAV004P&sesso=F&anno=2018";
  const http = await get(params).json();
  const mcp = await queryPublicDataset({ dataset: "istat_bes_lavoro", territory: "IT108", measure: "03LAV004P", sex: "F", year: 2018 });
  const { dataset, ...projection } = mcp;
  assert.equal(dataset, "istat_bes_lavoro");
  assert.deepEqual(projection, http);
  assert.deepEqual(http.observations, [{ indicator: "03LAV004P", territory: "IT108", sex: "F", year: 2018, valueTenths: null, status: "g" }]);
  assert.equal(data.observations.filter((row) => row.valueTenths === null).length, 122);
  assert.deepEqual((await get("?territorio=IT&indicatore=03LAV007&anno=2024").json()).observations, []);
});

test("public entry points require bounded supported filters", async () => {
  for (const params of ["", "?anno=2024x", "?anno=2007", "?anno=2025", "?sesso=X", "?indicatore=04BEC001P",
    "?comune=Milano", "?anno=2022&anno=2023", "?territorio=IT&extra=1", "?territorio=IT&limit=101"]) {
    const response = get(params);
    assert.equal(response.status, 400, params);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_lavoro" }), /almeno un filtro/);
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_lavoro", code: "015146" }), /Filtri non supportati/);
  const descriptor = datasetCatalog.find((item) => item.id === "istat_bes_lavoro");
  assert.deepEqual(descriptor.sourceIds, ["istat-bes-lavoro"]);
  assert.ok((await queryPublicDataset(descriptor.exampleQuery)).observations.length > 0);
});

test("runtime rejects value, flag, geography, unit and provenance tampering", () => {
  for (const mutate of [
    (copy) => { copy.observations[0].valueTenths += 1; },
    (copy) => { copy.observations.find((row) => row.status === "g").valueTenths = 0; },
    (copy) => { copy.territories.find((item) => item.code === "ITCD").kind = "regione"; },
    (copy) => { copy.indicators.find((item) => item.code === "03LAV007").unit = "VAL_PERC"; },
  ]) {
    const copy = structuredClone(data);
    mutate(copy);
    assert.throws(() => validate(copy, metadata));
  }
  const badMetadata = structuredClone(metadata);
  badMetadata.source.publicationDate = "2025-06-30";
  assert.throws(() => validate(data, badMetadata), /metadati diversi/);
});

test("large snapshot stays out of TypeScript inference and is traced into every server entry point", () => {
  const runtime = readFileSync(new URL("../src/lib/istat-bes-lavoro-snapshot.ts", import.meta.url), "utf8");
  assert.doesNotMatch(runtime, /import dataArtifact from/);
  assert.match(runtime, /openSync\(join\(process\.cwd\(\), ISTAT_BES_LAVORO_DATA_PATH\)/);
});

test("Next traces the runtime-loaded snapshot into every server entry point", async () => {
  const { default: config } = await import("../next.config.ts");
  const tracing = config.outputFileTracingIncludes;
  for (const route of ["/api/territori/bes-lavoro", "/api/assistant/chat", "/mcp", "/api/mcp"]) {
    assert.ok(tracing[route].includes("src/data/generated/istat-bes-lavoro-2008-2024.data.json"), route);
  }
});

test("cancellation stops selectors and MCP without affecting another caller", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("Cancelled", "AbortError"));
  assert.throws(() => query({ territory: "IT" }, { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_lavoro", territory: "IT" }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(GET(new NextRequest("http://localhost/api/territori/bes-lavoro?territorio=IT", { signal: controller.signal })).status, 499);
  assert.ok(query({ territory: "IT" }).observations.length > 0);
});
