import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { istatBesInnovazioneData: data, istatBesInnovazioneMetadata: metadata, queryIstatBesInnovazione: query } =
  await import("../src/lib/istat-bes-innovazione-snapshot.ts");
const { validateIstatBesInnovazioneBundle: validate } = await import("../src/lib/data/istat-bes-innovazione-contract.ts");
const { GET } = await import("../src/app/api/territori/bes-innovazione/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") => GET(new NextRequest(`http://localhost/api/territori/bes-innovazione${params}`));

test("Innovazione preserves four measures, signed mobility, periods and provenance dates", () => {
  assert.equal(data.observations.length, 5413);
  assert.equal(data.domain.code, "BES_11");
  assert.equal(data.indicators.length, 4);
  const indicators = new Map(data.indicators.map((item) => [item.code, item]));
  assert.equal(indicators.get("11RIC002").unit, "PER_MILLION_INHA");
  assert.equal(indicators.get("11RIC004P").unit, "VAL_PERC");
  assert.equal(indicators.get("11RIC022").period.from, 2018);
  assert.equal(indicators.get("11RIC025").period.to, 2023);
  assert.deepEqual(indicators.get("11RIC002").sexes, ["T"]);
  assert.match(indicators.get("11RIC025").description, /mobilità dei laureati/i);
  assert.equal(data.observations.filter((row) => row.valueTenths !== null && row.valueTenths < 0).length, 495);
  assert.equal(metadata.source.publicationDate, "2025-07-01");
  assert.equal(metadata.source.dataflowLastUpdate, "2025-06-30T15:22:06.201Z");
  assert.equal(metadata.source.acquisitionDate, "2026-09-17");
  assert.equal(metadata.source.licenseId, "not-declared");
  assert.equal(metadata.semantics.soldi.present, false);
});

test("geography preserves composites, external parents and excludes absent Sardinian provinces", () => {
  assert.equal(data.territories.length, 135);
  assert.equal(data.territories.filter((item) => item.kind === "provincia").length, 107);
  const territories = new Map(data.territories.map((item) => [item.code, item]));
  assert.equal(territories.get("ITCD").kind, "composite");
  assert.deepEqual(territories.get("ITFG").parts, ["ITF", "ITG"]);
  assert.equal(territories.get("ITD10").parentOutsideDataset, "ITD1");
  assert.equal(territories.get("ITD20").parentOutsideDataset, "ITD2");
  assert.equal(territories.has("ITG29"), false);
  assert.ok(query({ territory: "IT" }).pagination.total > 0);
  assert.throws(() => query({ territory: "ITG29" }), /Territorio non riconosciuto/);
  assert.throws(() => query({ territory: "015146" }), /Territorio non riconosciuto/);
});

test("HTTP and MCP agree on signed mobility while absent years stay absent", async () => {
  const params = "?territorio=IT&indicatore=11RIC025&sesso=T&anno=2019";
  const http = await get(params).json();
  const mcp = await queryPublicDataset({
    dataset: "istat_bes_innovazione",
    territory: "IT",
    measure: "11RIC025",
    sex: "T",
    year: 2019,
  });
  const { dataset, ...projection } = mcp;
  assert.equal(dataset, "istat_bes_innovazione");
  assert.deepEqual(projection, http);
  assert.deepEqual(http.observations, [{
    indicator: "11RIC025",
    territory: "IT",
    sex: "T",
    year: 2019,
    valueTenths: -49,
    status: null,
  }]);
  assert.deepEqual((await get("?territorio=IT&indicatore=11RIC022&anno=2019").json()).observations, []);
  assert.equal((await get("?territorio=IT&sesso=F")).status, 400);
});

test("public entry points require bounded supported filters", async () => {
  for (const params of ["", "?anno=2023x", "?anno=2003", "?anno=2024", "?sesso=X", "?indicatore=12SER024",
    "?comune=Milano", "?anno=2022&anno=2023", "?territorio=IT&extra=1", "?territorio=IT&limit=101"]) {
    const response = get(params);
    assert.equal(response.status, 400, params);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_innovazione" }), /almeno un filtro/);
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_innovazione", code: "015146" }), /Filtri non supportati/);
  const descriptor = datasetCatalog.find((item) => item.id === "istat_bes_innovazione");
  assert.deepEqual(descriptor.sourceIds, ["istat-bes-innovazione"]);
  assert.ok((await queryPublicDataset(descriptor.exampleQuery)).observations.length > 0);
});

test("runtime rejects value, geography, unit and provenance tampering", () => {
  for (const mutate of [
    (copy) => { copy.observations[0].valueTenths = (copy.observations[0].valueTenths ?? 0) + 1; },
    (copy) => {
      const peer = copy.observations.find((row) => row.indicator === "11RIC002");
      peer.valueTenths = -1;
    },
    (copy) => { copy.territories.find((item) => item.code === "ITCD").kind = "regione"; },
    (copy) => { copy.indicators.find((item) => item.code === "11RIC002").unit = "VAL_PERC"; },
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
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_innovazione", territory: "IT" }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(GET(new NextRequest("http://localhost/api/territori/bes-innovazione?territorio=IT", { signal: controller.signal })).status, 499);
  assert.ok(query({ territory: "IT" }).observations.length > 0);
});
