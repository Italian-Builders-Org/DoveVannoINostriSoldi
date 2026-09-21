import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const {
  istatPovertaSogliaRelativaData: data,
  istatPovertaSogliaRelativaMetadata: metadata,
  queryIstatPovertaSogliaRelativa: query,
} = await import("../src/lib/istat-poverta-soglia-relativa-snapshot.ts");
const { validateIstatPovertaSogliaRelativaBundle: validate } =
  await import("../src/lib/data/istat-poverta-soglia-relativa-contract.ts");
const { GET } = await import("../src/app/api/territori/poverta-soglia-relativa/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") => GET(new NextRequest(`http://localhost/api/territori/poverta-soglia-relativa${params}`));

test("soglia relativa preserves monetary scale, excludes 2021 and declares soldi", () => {
  assert.equal(data.observations.length, 70);
  assert.equal(data.domain.code, "34_727_DF_DCCV_POVERTA_11");
  assert.equal(data.scale.factor, 100);
  assert.equal(data.excludedYear, 2021);
  assert.equal(data.observations.filter((row) => row.year === 2021).length, 0);
  assert.equal(metadata.source.acquisitionDate, "2026-09-21");
  assert.equal(metadata.source.dataflowLastUpdate, "2025-10-14T08:02:20.381Z");
  assert.equal(metadata.source.licenseId, "not-declared");
  assert.equal(metadata.semantics.soldi.present, true);
  assert.equal(data.indicators[0].unit, "");
});

test("only Italia is published and 2021 queries fail closed", () => {
  assert.equal(data.territories.length, 1);
  assert.equal(data.territories[0].code, "IT");
  assert.ok(query({ territory: "IT", year: 2024 }).pagination.total > 0);
  assert.throws(() => query({ territory: "ITC1" }), /solo Italia/);
  assert.throws(() => query({ year: 2021 }), /escluso dal prodotto/);
});

test("HTTP and MCP agree on a filled threshold cell", async () => {
  const params = "?territorio=IT&ampiezza=N1&anno=2024";
  const http = await get(params).json();
  const mcp = await queryPublicDataset({
    dataset: "istat_poverta_soglia_relativa",
    territory: "IT",
    band: "N1",
    year: 2024,
  });
  const { dataset, ...projection } = mcp;
  assert.equal(dataset, "istat_poverta_soglia_relativa");
  assert.deepEqual(projection, http);
  assert.deepEqual(http.observations, [{
    territory: "IT",
    householdComposition: "N1",
    year: 2024,
    valueHundredths: 73084,
    status: null,
  }]);
});

test("public entry points require bounded supported filters", async () => {
  for (const params of ["", "?anno=2024x", "?anno=2013", "?anno=2025", "?anno=2021",
    "?ampiezza=TOT", "?territorio=ITC1", "?anno=2022&anno=2023", "?territorio=IT&extra=1",
    "?territorio=IT&limit=101"]) {
    const response = get(params);
    assert.equal(response.status, 400, params);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  await assert.rejects(queryPublicDataset({ dataset: "istat_poverta_soglia_relativa" }), /almeno un filtro/);
  const descriptor = datasetCatalog.find((item) => item.id === "istat_poverta_soglia_relativa");
  assert.deepEqual(descriptor.sourceIds, ["istat-poverta-soglia-relativa"]);
  assert.ok((await queryPublicDataset(descriptor.exampleQuery)).observations.length > 0);
});

test("catalog publicMetadata derives from generated metadata projection", () => {
  const descriptor = datasetCatalog.find((item) => item.id === "istat_poverta_soglia_relativa");
  assert.ok(metadata.publicMetadata, "publicMetadata projection missing in generated metadata");
  assert.ok(!Object.hasOwn(metadata.publicMetadata, "queryNotes"));
  const { queryNotes, ...sourceProjection } = descriptor.publicMetadata;
  assert.deepEqual(sourceProjection, metadata.publicMetadata);
  assert.deepEqual(queryNotes, [
    "Specificare almeno un filtro fra territory, year e band; limit massimo 100 righe per pagina.",
    "L'anno 2021 è escluso dal prodotto; band=N1…N6 o N7_GE; solo territorio IT.",
  ]);
});

test("runtime rejects value and provenance tampering", () => {
  for (const mutate of [
    (copy) => { copy.observations[0].valueHundredths += 1; },
    (copy) => { copy.observations[0].year = 2021; },
    (copy) => { copy.indicators[0].unit = "EURO"; },
  ]) {
    const copy = structuredClone(data);
    mutate(copy);
    assert.throws(() => validate(copy, metadata));
  }
  const badMetadata = structuredClone(metadata);
  badMetadata.source.acquisitionDate = "2026-09-20";
  assert.throws(() => validate(data, badMetadata), /metadati diversi/);
});

test("cancellation stops selectors and MCP without affecting another caller", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("Cancelled", "AbortError"));
  assert.throws(() => query({ territory: "IT" }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(
    (await GET(new NextRequest("http://localhost/api/territori/poverta-soglia-relativa?territorio=IT", {
      signal: controller.signal,
    }))).status,
    499,
  );
  assert.ok((await get("?territorio=IT&anno=2024").json()).observations.length > 0);
});
