import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const {
  istatPovertaSogliaAssolutaData: data,
  istatPovertaSogliaAssolutaMetadata: metadata,
  queryIstatPovertaSogliaAssoluta: query,
} = await import("../src/lib/istat-poverta-soglia-assoluta-snapshot.ts");
const { validateIstatPovertaSogliaAssolutaBundle: validate } =
  await import("../src/lib/data/istat-poverta-soglia-assoluta-contract.ts");
const { GET } = await import("../src/app/api/territori/poverta-soglia-assoluta/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") => GET(new NextRequest(`http://localhost/api/territori/poverta-soglia-assoluta${params}`));

test("soglia preserves monetary scale, null cells, provenance and soldi.present", () => {
  assert.equal(data.observations.length, 36078);
  assert.equal(data.domain.code, "34_211");
  assert.equal(data.scale.factor, 100);
  assert.equal(data.observations.filter((row) => row.valueHundredths === null).length, 6050);
  assert.equal(metadata.source.acquisitionDate, "2026-09-17");
  assert.equal(metadata.source.dataflowLastUpdate, "2025-10-14T08:00:39.239Z");
  assert.equal(metadata.source.licenseId, "not-declared");
  assert.equal(metadata.semantics.soldi.present, true);
  assert.equal(data.indicators[0].unit, "");
});

test("geography preserves composites and rejects inventing national totals", () => {
  assert.equal(data.territories.length, 23);
  const territories = new Map(data.territories.map((item) => [item.code, item]));
  assert.equal(territories.get("ITCD").kind, "composite");
  assert.deepEqual(territories.get("ITFG").parts, ["ITF", "ITG"]);
  assert.equal(territories.get("ITE").kind, "macro");
  assert.equal(territories.has("IT"), false);
  assert.ok(query({ territory: "ITC1", year: 2024 }).pagination.total > 0);
  assert.throws(() => query({ territory: "IT" }), /Territorio non riconosciuto/);
});

test("HTTP and MCP agree on a filled threshold cell", async () => {
  const params = "?territorio=ITC1&tipologia=2&ampiezza=2&anno=2014";
  const http = await get(params).json();
  const mcp = await queryPublicDataset({
    dataset: "istat_poverta_soglia_assoluta",
    territory: "ITC1",
    family: "2",
    band: "2",
    year: 2014,
  });
  const { dataset, ...projection } = mcp;
  assert.equal(dataset, "istat_poverta_soglia_assoluta");
  assert.deepEqual(projection, http);
  assert.deepEqual(http.observations, [{
    territory: "ITC1",
    householdTypology: "2",
    municipalitySize: "2",
    year: 2014,
    valueHundredths: 73582,
    status: null,
  }]);
  assert.equal(
    (await get("?territorio=ITC2&tipologia=2&ampiezza=2&anno=2014").json()).observations[0].valueHundredths,
    null,
  );
});

test("public entry points require bounded supported filters", async () => {
  for (const params of ["", "?anno=2024x", "?anno=2004", "?anno=2025", "?tipologia=999",
    "?ampiezza=XYZ", "?comune=Milano", "?anno=2022&anno=2023", "?territorio=ITC1&extra=1",
    "?territorio=ITC1&limit=101"]) {
    const response = get(params);
    assert.equal(response.status, 400, params);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  await assert.rejects(queryPublicDataset({ dataset: "istat_poverta_soglia_assoluta" }), /almeno un filtro/);
  await assert.rejects(
    queryPublicDataset({ dataset: "istat_poverta_soglia_assoluta", code: "015146" }),
    /Filtri non supportati/,
  );
  const descriptor = datasetCatalog.find((item) => item.id === "istat_poverta_soglia_assoluta");
  assert.deepEqual(descriptor.sourceIds, ["istat-poverta-soglia-assoluta"]);
  assert.ok((await queryPublicDataset(descriptor.exampleQuery)).observations.length > 0);
});

test("runtime rejects value, geography and provenance tampering", () => {
  for (const mutate of [
    (copy) => { copy.observations[0].valueHundredths = (copy.observations[0].valueHundredths ?? 0) + 1; },
    (copy) => {
      const nullRow = copy.observations.find((row) => row.valueHundredths === null);
      nullRow.valueHundredths = 0;
    },
    (copy) => { copy.territories.find((item) => item.code === "ITCD").kind = "regione"; },
    (copy) => { copy.indicators[0].unit = "EURO"; },
  ]) {
    const copy = structuredClone(data);
    mutate(copy);
    assert.throws(() => validate(copy, metadata));
  }
  const badMetadata = structuredClone(metadata);
  badMetadata.source.acquisitionDate = "2026-09-16";
  assert.throws(() => validate(data, badMetadata), /metadati diversi/);
});

test("cancellation stops selectors and MCP without affecting another caller", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("Cancelled", "AbortError"));
  assert.throws(() => query({ territory: "ITC1" }, { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(
    queryPublicDataset({ dataset: "istat_poverta_soglia_assoluta", territory: "ITC1" }, { signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(
    GET(new NextRequest("http://localhost/api/territori/poverta-soglia-assoluta?territorio=ITC1", {
      signal: controller.signal,
    })).status,
    499,
  );
  assert.ok(query({ territory: "ITC1" }).observations.length > 0);
});
