import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { istatBesPaesaggioData: data, istatBesPaesaggioMetadata: metadata, queryIstatBesPaesaggio: query } =
  await import("../src/lib/istat-bes-paesaggio-snapshot.ts");
const { validateIstatBesPaesaggioBundle: validate } = await import("../src/lib/data/istat-bes-paesaggio-contract.ts");
const { GET } = await import("../src/app/api/territori/bes-paesaggio/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") => GET(new NextRequest(`http://localhost/api/territori/bes-paesaggio${params}`));

test("Paesaggio preserves three measures, hundredths scale, periods and provenance", () => {
  assert.equal(data.observations.length, 3760);
  assert.equal(data.domain.code, "BES_09");
  assert.equal(data.scale.factor, 100);
  assert.equal(data.indicators.length, 3);
  const indicators = new Map(data.indicators.map((item) => [item.code, item]));
  assert.equal(indicators.get("09PAE002").unit, "PER_100_KM2");
  assert.equal(indicators.get("09PAE008").unit, "PER_100_KM2");
  assert.equal(indicators.get("09PAE009-N25").unit, "PER_100_M2");
  assert.equal(indicators.get("09PAE009-N25").period.from, 2021);
  assert.deepEqual(indicators.get("09PAE008").sexes, ["T"]);
  assert.match(indicators.get("09PAE002").description, /museale|muse/);
  assert.equal(metadata.source.publicationDate, "2025-07-01");
  assert.equal(metadata.source.acquisitionDate, "2026-09-16");
  assert.equal(metadata.source.licenseId, "not-declared");
  assert.equal(metadata.semantics.soldi.present, false);
});

test("geography preserves composites and external parents", () => {
  assert.equal(data.territories.length, 139);
  assert.equal(data.territories.filter((item) => item.kind === "provincia").length, 111);
  const territories = new Map(data.territories.map((item) => [item.code, item]));
  assert.equal(territories.get("ITCD").kind, "composite");
  assert.equal(territories.get("ITD10").parentOutsideDataset, "ITD1");
  assert.ok(query({ territory: "ITG25" }).pagination.total > 0);
  assert.throws(() => query({ territory: "015146" }), /Territorio non riconosciuto/);
});

test("HTTP and MCP agree on n/g null cells while absent years stay absent", async () => {
  const params = "?territorio=ITE42&indicatore=09PAE009-N25&sesso=T&anno=2021";
  const http = await get(params).json();
  const mcp = await queryPublicDataset({
    dataset: "istat_bes_paesaggio",
    territory: "ITE42",
    measure: "09PAE009-N25",
    sex: "T",
    year: 2021,
  });
  const { dataset, ...projection } = mcp;
  assert.equal(dataset, "istat_bes_paesaggio");
  assert.deepEqual(projection, http);
  assert.deepEqual(http.observations, [{
    indicator: "09PAE009-N25",
    territory: "ITE42",
    sex: "T",
    year: 2021,
    valueHundredths: null,
    status: "n",
  }]);
  assert.equal(data.observations.filter((row) => row.valueHundredths === null).length, 3);
  assert.deepEqual((await get("?territorio=IT&indicatore=09PAE002&anno=2004").json()).observations, []);
  assert.equal((await get("?territorio=IT&sesso=F")).status, 400);
});

test("public entry points require bounded supported filters", async () => {
  for (const params of ["", "?anno=2024x", "?anno=2003", "?anno=2024", "?sesso=X", "?indicatore=07SIC001P",
    "?comune=Milano", "?anno=2022&anno=2023", "?territorio=IT&extra=1", "?territorio=IT&limit=101"]) {
    const response = get(params);
    assert.equal(response.status, 400, params);
  }
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_paesaggio" }), /almeno un filtro/);
  const descriptor = datasetCatalog.find((item) => item.id === "istat_bes_paesaggio");
  assert.deepEqual(descriptor.sourceIds, ["istat-bes-paesaggio"]);
  assert.ok((await queryPublicDataset(descriptor.exampleQuery)).observations.length > 0);
});

test("runtime rejects value, flag, geography, unit and provenance tampering", () => {
  for (const mutate of [
    (copy) => { copy.observations[0].valueHundredths = (copy.observations[0].valueHundredths ?? 0) + 1; },
    (copy) => { copy.observations.find((row) => row.status === "n").valueHundredths = 0; },
    (copy) => { copy.territories.find((item) => item.code === "ITCD").kind = "regione"; },
    (copy) => { copy.indicators.find((item) => item.code === "09PAE008").unit = "VAL_PERC"; },
  ]) {
    const copy = structuredClone(data);
    mutate(copy);
    assert.throws(() => validate(copy, metadata));
  }
  const badMetadata = structuredClone(metadata);
  badMetadata.source.publicationDate = "2025-06-30";
  assert.throws(() => validate(data, badMetadata), /metadati diversi/);
});

test("cancellation stops selectors and MCP without affecting another caller", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("Cancelled", "AbortError"));
  assert.throws(() => query({ territory: "IT" }, { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_paesaggio", territory: "IT" }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(GET(new NextRequest("http://localhost/api/territori/bes-paesaggio?territorio=IT", { signal: controller.signal })).status, 499);
  assert.ok(query({ territory: "IT" }).observations.length > 0);
});
