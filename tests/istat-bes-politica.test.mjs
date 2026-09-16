import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { istatBesPoliticaData: data, istatBesPoliticaMetadata: metadata, queryIstatBesPolitica: query } =
  await import("../src/lib/istat-bes-politica-snapshot.ts");
const { validateIstatBesPoliticaBundle: validate } = await import("../src/lib/data/istat-bes-politica-contract.ts");
const { GET } = await import("../src/app/api/territori/bes-politica/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") => GET(new NextRequest(`http://localhost/api/territori/bes-politica${params}`));

test("Politica preserves seven measures, units, periods and explicit provenance dates", () => {
  assert.equal(data.observations.length, 15818);
  assert.equal(data.domain.code, "BES_06");
  assert.equal(data.indicators.length, 7);
  const indicators = new Map(data.indicators.map((item) => [item.code, item]));
  assert.equal(indicators.get("06POL001").unit, "I_VOTERS");
  assert.equal(indicators.get("06POL001P").unit, "I_VOTERS_RC");
  assert.equal(indicators.get("06POL007P").period.from, 2007);
  assert.equal(indicators.get("06POL007P").period.to, 2022);
  assert.deepEqual(indicators.get("06POL012P").sexes, ["T"]);
  assert.equal(indicators.get("06POL012P").unit, "I_PRISON");
  assert.match(indicators.get("06POL012P").description, /detenuti/);
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

test("HTTP and MCP agree on empty null cells while absent years and sexes stay absent", async () => {
  const sample = data.observations.find((row) => row.valueTenths === null);
  assert.ok(sample);
  const params = `?territorio=${sample.territory}&indicatore=${sample.indicator}&sesso=T&anno=${sample.year}`;
  const http = await get(params).json();
  const mcp = await queryPublicDataset({
    dataset: "istat_bes_politica",
    territory: sample.territory,
    measure: sample.indicator,
    sex: "T",
    year: sample.year,
  });
  const { dataset, ...projection } = mcp;
  assert.equal(dataset, "istat_bes_politica");
  assert.deepEqual(projection, http);
  assert.deepEqual(http.observations, [{
    indicator: sample.indicator,
    territory: sample.territory,
    sex: "T",
    year: sample.year,
    valueTenths: null,
    status: null,
  }]);
  assert.equal(data.observations.filter((row) => row.valueTenths === null).length, 2115);
  assert.deepEqual((await get("?territorio=IT&indicatore=06POL007P&anno=2024").json()).observations, []);
  assert.equal((await get("?territorio=IT&sesso=F")).status, 400);
});

test("public entry points require bounded supported filters", async () => {
  for (const params of ["", "?anno=2024x", "?anno=2003", "?anno=2025", "?sesso=X", "?indicatore=05REL008",
    "?comune=Milano", "?anno=2022&anno=2023", "?territorio=IT&extra=1", "?territorio=IT&limit=101"]) {
    const response = get(params);
    assert.equal(response.status, 400, params);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_politica" }), /almeno un filtro/);
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_politica", code: "015146" }), /Filtri non supportati/);
  const descriptor = datasetCatalog.find((item) => item.id === "istat_bes_politica");
  assert.deepEqual(descriptor.sourceIds, ["istat-bes-politica"]);
  assert.ok((await queryPublicDataset(descriptor.exampleQuery)).observations.length > 0);
});

test("runtime rejects value, geography, unit and provenance tampering", () => {
  for (const mutate of [
    (copy) => { copy.observations[0].valueTenths = (copy.observations[0].valueTenths ?? 0) + 1; },
    (copy) => { copy.observations.find((row) => row.valueTenths === null).valueTenths = 0; },
    (copy) => { copy.territories.find((item) => item.code === "ITCD").kind = "regione"; },
    (copy) => { copy.indicators.find((item) => item.code === "06POL012P").unit = "VAL_PERC"; },
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
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_politica", territory: "IT" }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(GET(new NextRequest("http://localhost/api/territori/bes-politica?territorio=IT", { signal: controller.signal })).status, 499);
  assert.ok(query({ territory: "IT" }).observations.length > 0);
});
