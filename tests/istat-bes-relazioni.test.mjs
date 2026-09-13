import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { istatBesRelazioniData: data, istatBesRelazioniMetadata: metadata, queryIstatBesRelazioni: query } =
  await import("../src/lib/istat-bes-relazioni-snapshot.ts");
const { validateIstatBesRelazioniBundle: validate } = await import("../src/lib/data/istat-bes-relazioni-contract.ts");
const { GET } = await import("../src/app/api/territori/bes-relazioni/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") => GET(new NextRequest(`http://localhost/api/territori/bes-relazioni${params}`));

test("Relazioni preserves two measures, units, periods and explicit provenance dates", () => {
  assert.equal(data.observations.length, 1330);
  assert.equal(data.domain.code, "BES_05");
  assert.equal(data.indicators.length, 2);
  const indicators = new Map(data.indicators.map((item) => [item.code, item]));
  assert.equal(indicators.get("05REL007P").unit, "VAL_PERC");
  assert.equal(indicators.get("05REL007P").period.from, 2024);
  assert.equal(indicators.get("05REL007P").period.to, 2024);
  assert.deepEqual(indicators.get("05REL007P").sexes, ["T"]);
  assert.equal(indicators.get("05REL008").unit, "PER_10THOU_INHA");
  assert.equal(indicators.get("05REL008").period.from, 2011);
  assert.equal(indicators.get("05REL008").period.to, 2022);
  assert.match(indicators.get("05REL007P").description, /barriere/);
  assert.equal(metadata.source.publicationDate, "2025-07-01");
  assert.equal(metadata.source.dataflowLastUpdate, "2025-06-30T15:22:06.201Z");
  assert.equal(metadata.source.acquisitionDate, "2026-09-13");
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

test("HTTP and MCP agree on n null while absent years and sexes stay absent", async () => {
  const params = "?territorio=ITC33&indicatore=05REL007P&sesso=T&anno=2024";
  const http = await get(params).json();
  const mcp = await queryPublicDataset({
    dataset: "istat_bes_relazioni",
    territory: "ITC33",
    measure: "05REL007P",
    sex: "T",
    year: 2024,
  });
  const { dataset, ...projection } = mcp;
  assert.equal(dataset, "istat_bes_relazioni");
  assert.deepEqual(projection, http);
  assert.deepEqual(http.observations, [{
    indicator: "05REL007P",
    territory: "ITC33",
    sex: "T",
    year: 2024,
    valueTenths: null,
    status: "n",
  }]);
  assert.equal(data.observations.filter((row) => row.valueTenths === null).length, 8);
  assert.deepEqual((await get("?territorio=IT&indicatore=05REL008&anno=2024").json()).observations, []);
  assert.equal((await get("?territorio=IT&sesso=F")).status, 400);
});

test("public entry points require bounded supported filters", async () => {
  for (const params of ["", "?anno=2024x", "?anno=2010", "?anno=2025", "?sesso=X", "?indicatore=03LAV001-N22",
    "?comune=Milano", "?anno=2022&anno=2023", "?territorio=IT&extra=1", "?territorio=IT&limit=101"]) {
    const response = get(params);
    assert.equal(response.status, 400, params);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_relazioni" }), /almeno un filtro/);
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_relazioni", code: "015146" }), /Filtri non supportati/);
  const descriptor = datasetCatalog.find((item) => item.id === "istat_bes_relazioni");
  assert.deepEqual(descriptor.sourceIds, ["istat-bes-relazioni"]);
  assert.ok((await queryPublicDataset(descriptor.exampleQuery)).observations.length > 0);
});

test("runtime rejects value, flag, geography, unit and provenance tampering", () => {
  for (const mutate of [
    (copy) => { copy.observations[0].valueTenths += 1; },
    (copy) => { copy.observations.find((row) => row.status === "n").valueTenths = 0; },
    (copy) => { copy.territories.find((item) => item.code === "ITCD").kind = "regione"; },
    (copy) => { copy.indicators.find((item) => item.code === "05REL008").unit = "VAL_PERC"; },
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
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_relazioni", territory: "IT" }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(GET(new NextRequest("http://localhost/api/territori/bes-relazioni?territorio=IT", { signal: controller.signal })).status, 499);
  assert.ok(query({ territory: "IT" }).observations.length > 0);
});
