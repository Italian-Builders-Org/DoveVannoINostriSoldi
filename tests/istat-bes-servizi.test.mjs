import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { istatBesServiziData: data, istatBesServiziMetadata: metadata, queryIstatBesServizi: query } =
  await import("../src/lib/istat-bes-servizi-snapshot.ts");
const { validateIstatBesServiziBundle: validate } = await import("../src/lib/data/istat-bes-servizi-contract.ts");
const { GET } = await import("../src/app/api/territori/bes-servizi/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") => GET(new NextRequest(`http://localhost/api/territori/bes-servizi${params}`));

test("Qualità dei servizi preserves eight measures, units, periods and explicit provenance dates", () => {
  assert.equal(data.observations.length, 15858);
  assert.equal(data.domain.code, "BES_12");
  assert.equal(data.indicators.length, 8);
  const indicators = new Map(data.indicators.map((item) => [item.code, item]));
  assert.equal(indicators.get("12SER002P").unit, "PER_10THOU_INHA");
  assert.equal(indicators.get("12SER024").unit, "VAL_PERC");
  assert.equal(indicators.get("12SER007").period.from, 2004);
  assert.equal(indicators.get("12SER020").period.from, 2020);
  assert.equal(indicators.get("12SER020").period.to, 2024);
  assert.deepEqual(indicators.get("12SER002P").sexes, ["T"]);
  assert.match(indicators.get("12SER024").description, /raccolta differenziata/i);
  assert.equal(metadata.source.publicationDate, "2025-07-01");
  assert.equal(metadata.source.dataflowLastUpdate, "2025-06-30T15:22:06.201Z");
  assert.equal(metadata.source.acquisitionDate, "2026-09-16");
  assert.equal(metadata.source.licenseId, "not-declared");
  assert.equal(metadata.semantics.soldi.present, false);
});

test("geography preserves composites, external parents and historical identities", () => {
  assert.equal(data.territories.length, 139);
  assert.equal(data.territories.filter((item) => item.kind === "provincia").length, 111);
  const territories = new Map(data.territories.map((item) => [item.code, item]));
  assert.equal(territories.get("ITCD").kind, "composite");
  assert.deepEqual(territories.get("ITFG").parts, ["ITF", "ITG"]);
  assert.equal(territories.get("ITD10").parentOutsideDataset, "ITD1");
  assert.equal(territories.get("ITD20").parentOutsideDataset, "ITD2");
  assert.ok(query({ territory: "ITG25" }).pagination.total > 0);
  assert.throws(() => query({ territory: "015146" }), /Territorio non riconosciuto/);
});

test("HTTP and MCP agree on n/g null while absent years and sexes stay absent", async () => {
  const params = "?territorio=ITD43&indicatore=12SER020&sesso=T&anno=2020";
  const http = await get(params).json();
  const mcp = await queryPublicDataset({
    dataset: "istat_bes_servizi",
    territory: "ITD43",
    measure: "12SER020",
    sex: "T",
    year: 2020,
  });
  const { dataset, ...projection } = mcp;
  assert.equal(dataset, "istat_bes_servizi");
  assert.deepEqual(projection, http);
  assert.deepEqual(http.observations, [{
    indicator: "12SER020",
    territory: "ITD43",
    sex: "T",
    year: 2020,
    valueTenths: null,
    status: "n",
  }]);
  assert.equal(data.observations.filter((row) => row.valueTenths === null).length, 76);
  assert.deepEqual((await get("?territorio=IT&indicatore=12SER020&anno=2019").json()).observations, []);
  assert.equal((await get("?territorio=IT&sesso=F")).status, 400);
});

test("public entry points require bounded supported filters", async () => {
  for (const params of ["", "?anno=2024x", "?anno=2003", "?anno=2025", "?sesso=X", "?indicatore=09PAE002",
    "?comune=Milano", "?anno=2022&anno=2023", "?territorio=IT&extra=1", "?territorio=IT&limit=101"]) {
    const response = get(params);
    assert.equal(response.status, 400, params);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_servizi" }), /almeno un filtro/);
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_servizi", code: "015146" }), /Filtri non supportati/);
  const descriptor = datasetCatalog.find((item) => item.id === "istat_bes_servizi");
  assert.deepEqual(descriptor.sourceIds, ["istat-bes-servizi"]);
  assert.ok((await queryPublicDataset(descriptor.exampleQuery)).observations.length > 0);
});

test("runtime rejects value, flag, geography, unit and provenance tampering", () => {
  for (const mutate of [
    (copy) => { copy.observations[0].valueTenths = (copy.observations[0].valueTenths ?? 0) + 1; },
    (copy) => { copy.observations.find((row) => row.status === "n").valueTenths = 0; },
    (copy) => { copy.territories.find((item) => item.code === "ITCD").kind = "regione"; },
    (copy) => { copy.indicators.find((item) => item.code === "12SER024").unit = "PER_10THOU_INHA"; },
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
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_servizi", territory: "IT" }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(GET(new NextRequest("http://localhost/api/territori/bes-servizi?territorio=IT", { signal: controller.signal })).status, 499);
  assert.ok(query({ territory: "IT" }).observations.length > 0);
});
