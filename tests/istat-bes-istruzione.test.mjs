import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { istatBesIstruzioneData: data, istatBesIstruzioneMetadata: metadata, queryIstatBesIstruzione: query } =
  await import("../src/lib/istat-bes-istruzione-snapshot.ts");
const { validateIstatBesIstruzioneBundle: validate } = await import("../src/lib/data/istat-bes-istruzione-contract.ts");
const { GET } = await import("../src/app/api/territori/bes-istruzione/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") => GET(new NextRequest(`http://localhost/api/territori/bes-istruzione${params}`));

test("Istruzione preserves all nine official measures, denominators and sparse periods", () => {
  assert.equal(data.observations.length, 14952);
  assert.equal(data.domain.code, "BES_02");
  assert.equal(data.domain.edition, "2025");
  assert.equal(data.indicators.length, 9);
  const indicators = new Map(data.indicators.map((i) => [i.code, i]));
  assert.equal(indicators.get("02IST004").unit, "SPEC_COHORT_RATE");
  assert.match(indicators.get("02IST004").description, /sono esclusi/);
  assert.equal(indicators.get("12SER002").period.from, 2004);
  assert.match(indicators.get("12SER002").description, /0-2 anni/);
  assert.deepEqual(indicators.get("02IST002-N22").sexes, ["T"]);
  assert.equal(indicators.get("02IST010P").coverage["T/2020"], undefined);
  assert.equal(metadata.semantics.soldi.present, false);
  assert.equal(metadata.source.licenseId, "not-declared");
  assert.equal(metadata.source.publicationDate, null);
  assert.equal(data.reconciliation.totalBetweenSexes, false);
  assert.equal(data.observations.filter((r) => r.valueTenths > 1000).length, 136);
  assert.equal(Math.max(...data.observations.map((r) => r.valueTenths ?? 0)), 1137);
});

test("education geography preserves composites and external parents including historical provinces", () => {
  assert.equal(data.territories.length, 139);
  assert.equal(data.territories.filter((t) => t.kind === "provincia").length, 111);
  const territories = new Map(data.territories.map((t) => [t.code, t]));
  assert.equal(territories.get("ITCD").kind, "composite");
  assert.deepEqual(territories.get("ITFG").parts, ["ITF", "ITG"]);
  assert.equal(territories.get("ITD10").parent, null);
  assert.equal(territories.get("ITD10").parentOutsideDataset, "ITD1");
  assert.equal(territories.get("ITG2A").kind, "provincia");
  assert.ok(query({ territory: "ITG2A" }).pagination.total > 0);
  assert.throws(() => query({ territory: "015146" }), /Territorio non riconosciuto/);
});

test("HTTP and MCP agree on the unknown cell and keep absent rows distinct", async () => {
  const response = get("?territorio=IT108&indicatore=02IST004&sesso=F&anno=2017");
  assert.equal(response.status, 200);
  const http = await response.json();
  const mcp = await queryPublicDataset({ dataset: "istat_bes_istruzione", territory: "IT108", measure: "02IST004", sex: "F", year: 2017 });
  const { dataset, ...mcpProjection } = mcp;
  assert.equal(dataset, "istat_bes_istruzione");
  assert.deepEqual(mcpProjection, http);
  assert.deepEqual(http.observations, [{ indicator: "02IST004", territory: "IT108", sex: "F", year: 2017, valueTenths: null, status: "g" }]);
  assert.equal(data.observations.filter((row) => row.valueTenths === null).length, 76);
  assert.match(http.flags.knownValues.g, /non si conoscono/);
});

test("missing indicator-year remains empty rather than zero or imputed", async () => {
  const result = await get("?indicatore=02IST010P&anno=2020&territorio=IT").json();
  assert.deepEqual(result.observations, []);
  assert.equal(result.indicators[0].period.to, 2024);
  assert.match(result.periodNote, /non vale per tutti/);
});

test("both public entry points reject economic measures, municipal filters and unbounded queries", async () => {
  for (const params of ["", "?anno=2024x", "?anno=2003", "?anno=2025", "?sesso=X", "?indicatore=04BEC001P",
    "?territorio=", "?comune=Milano", "?anno=2022&anno=2023", "?territorio=IT&extra=1"]) {
    const response = get(params);
    assert.equal(response.status, 400, params);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_istruzione" }), /almeno un filtro/);
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_istruzione", measure: "04BEC001P" }), /Indicatore non riconosciuto/);
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_istruzione", code: "015146" }), /Filtri non supportati/);
  const descriptor = datasetCatalog.find((d) => d.id === "istat_bes_istruzione");
  assert.deepEqual(descriptor.sourceIds, ["istat-bes-istruzione"]);
  assert.deepEqual(descriptor.filters, ["territory", "year", "measure", "sex", "limit", "offset"]);
  assert.ok((await queryPublicDataset(descriptor.exampleQuery)).observations.length > 0);
});

test("bounded pages preserve all matches without ranking or overlapping rows", async () => {
  const first = query({ territory: "IT", limit: 100 });
  const expected = data.observations.filter((row) => row.territory === "IT");
  const rows = [...first.observations];
  let next = first.pagination.nextOffset;
  while (next !== null) {
    const page = query({ territory: "IT", limit: 100, offset: next });
    assert.equal(page.pagination.total, expected.length);
    rows.push(...page.observations);
    next = page.pagination.nextOffset;
  }
  assert.deepEqual(rows, expected);
  assert.equal(query({ territory: "IT", offset: 100000 }).pagination.nextOffset, null);
  const http = await get("?territorio=IT&limit=2&offset=2").json();
  assert.deepEqual(http.observations, expected.slice(2, 4));
  for (const suffix of ["limit=0", "limit=101", "limit=", "offset=-1", "offset=100001", "offset=1.5"]) {
    assert.equal(get(`?territorio=IT&${suffix}`).status, 400);
  }
});

test("runtime rejects altered values, flags, hierarchy, units and provenance", () => {
  for (const mutate of [
    (copy) => { copy.observations[0].valueTenths += 1; },
    (copy) => { copy.observations.find((r) => r.status === "g").valueTenths = 0; },
    (copy) => { copy.territories.find((t) => t.code === "ITCD").kind = "regione"; },
    (copy) => { copy.indicators[1].unit = "EURO"; },
  ]) {
    const copy = structuredClone(data);
    mutate(copy);
    assert.throws(() => validate(copy, metadata));
  }
  const badMetadata = structuredClone(metadata);
  badMetadata.source.assets.structure.sha256 = "0".repeat(64);
  assert.throws(() => validate(data, badMetadata), /metadati diversi/);
});

test("cancelled selectors and MCP calls stop, while an independent caller succeeds", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("Cancelled", "AbortError"));
  assert.throws(() => query({ territory: "IT" }, { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_istruzione", territory: "IT" }, { signal: controller.signal }), { name: "AbortError" });
  const response = GET(new NextRequest("http://localhost/api/territori/bes-istruzione?territorio=IT", { signal: controller.signal }));
  assert.equal(response.status, 499);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(query({ territory: "IT" }).observations.length > 0);
});
