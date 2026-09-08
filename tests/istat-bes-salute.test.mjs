import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { istatBesSaluteData: data, istatBesSaluteMetadata: metadata, queryIstatBesSalute: query } =
  await import("../src/lib/istat-bes-salute-snapshot.ts");
const { validateIstatBesSaluteBundle: validate } = await import("../src/lib/data/istat-bes-salute-contract.ts");
const { GET } = await import("../src/app/api/territori/bes-salute/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") => GET(new NextRequest(`http://localhost/api/territori/bes-salute${params}`));

test("Salute preserves its six indicators, independent units and coverage", () => {
  assert.equal(data.observations.length, 46157);
  assert.equal(data.domain.code, "BES_01");
  assert.equal(data.domain.edition, "2025");
  assert.equal(data.indicators.length, 6);
  const indicators = new Map(data.indicators.map((i) => [i.code, i]));
  assert.equal(indicators.get("01SAL001").unit, "AVG_NY");
  assert.equal(indicators.get("01SAL001").period.to, 2024);
  assert.equal(indicators.get("01SAL004").unit, "PER_1THOU_LBIRTHS");
  assert.match(indicators.get("01SAL004").description, /1.000 nati vivi/);
  assert.equal(indicators.get("01SAL004").period.to, 2022);
  assert.equal(indicators.get("01SAL005").unit, "STA_RA_PER_10THOU");
  assert.match(indicators.get("01SAL005").description, /europea al 2013/);
  assert.equal(indicators.get("01SAL005").period.to, 2023);
  assert.equal(metadata.semantics.soldi.present, false);
  assert.equal(metadata.source.licenseId, "not-declared");
  assert.equal(metadata.source.publicationDate, null);
  assert.equal(data.reconciliation.totalBetweenSexes, false);
});

test("health geography preserves composites and external parents without borrowing economic provinces", () => {
  assert.equal(data.territories.length, 135);
  assert.equal(data.territories.filter((t) => t.kind === "provincia").length, 107);
  const territories = new Map(data.territories.map((t) => [t.code, t]));
  assert.equal(territories.get("ITCD").kind, "composite");
  assert.deepEqual(territories.get("ITFG").parts, ["ITF", "ITG"]);
  assert.equal(territories.get("ITD10").parent, null);
  assert.equal(territories.get("ITD10").parentOutsideDataset, "ITD1");
  assert.equal(territories.has("ITG2A"), false);
  assert.throws(() => query({ territory: "ITG2A" }), /Territorio non riconosciuto/);
  assert.throws(() => query({ territory: "015146" }), /Territorio non riconosciuto/);
});

test("HTTP and MCP agree on the statistically insignificant cell and keep zero distinct", async () => {
  const response = get("?territorio=ITC45&indicatore=01SAL005&sesso=F&anno=2021");
  assert.equal(response.status, 200);
  const http = await response.json();
  const mcp = await queryPublicDataset({ dataset: "istat_bes_salute", territory: "ITC45", measure: "01SAL005", sex: "F", year: 2021 });
  const { dataset, ...mcpProjection } = mcp;
  assert.equal(dataset, "istat_bes_salute");
  assert.deepEqual(mcpProjection, http);
  assert.deepEqual(http.observations, [{ indicator: "01SAL005", territory: "ITC45", sex: "F", year: 2021, valueTenths: null, status: "n" }]);
  assert.ok(data.observations.some((row) => row.valueTenths === 0 && row.status === null));
  assert.match(http.flags.knownValues.n, /statisticamente non significativo/);
});

test("missing indicator-year remains empty rather than zero or imputed", async () => {
  const result = await get("?indicatore=01SAL004&anno=2024&territorio=IT").json();
  assert.deepEqual(result.observations, []);
  assert.equal(result.indicators[0].period.to, 2022);
  assert.match(result.periodNote, /non vale per tutti/);
});

test("both public entry points reject economic measures, municipal filters and unbounded queries", async () => {
  for (const params of ["", "?anno=2024x", "?anno=2003", "?anno=2025", "?sesso=X", "?indicatore=04BEC001P",
    "?territorio=", "?comune=Milano", "?anno=2022&anno=2023", "?territorio=IT&extra=1"]) {
    const response = get(params);
    assert.equal(response.status, 400, params);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_salute" }), /almeno un filtro/);
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_salute", measure: "04BEC001P" }), /Indicatore non riconosciuto/);
  await assert.rejects(queryPublicDataset({ dataset: "istat_bes_salute", code: "015146" }), /Filtri non supportati/);
  const descriptor = datasetCatalog.find((d) => d.id === "istat_bes_salute");
  assert.deepEqual(descriptor.sourceIds, ["istat-bes-salute"]);
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
    (copy) => { copy.observations.find((r) => r.status === "n").valueTenths = 0; },
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
