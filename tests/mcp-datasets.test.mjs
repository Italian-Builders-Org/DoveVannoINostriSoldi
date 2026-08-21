import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { DATASET_IDS, datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { publicSources } = await import("../src/lib/sources.ts");

test("MCP catalog has one descriptor per stable dataset id and valid source references", () => {
  assert.deepEqual(datasetCatalog.map((dataset) => dataset.id).sort(), [...DATASET_IDS].sort());
  assert.equal(new Set(DATASET_IDS).size, DATASET_IDS.length);
  const knownSources = new Set(publicSources.map((source) => source.slug));
  for (const dataset of datasetCatalog) {
    assert.ok(dataset.title.length > 0);
    assert.ok(dataset.summary.length > 0);
    assert.equal(dataset.exampleQuery.dataset, dataset.id);
    for (const key of Object.keys(dataset.exampleQuery)) {
      if (key !== "dataset") assert.ok(dataset.filters.includes(key), `${dataset.id}: ${key}`);
    }
    for (const sourceId of dataset.sourceIds) assert.ok(knownSources.has(sourceId), sourceId);
    assert.equal(dataset.sources.length, dataset.sourceIds.length);
    for (const source of dataset.sources) {
      assert.match(source.url, /^https:\/\//);
      assert.ok(source.owner.length > 0);
    }
  }
});

test("SIOPE query validates years and can filter a region", async () => {
  await assert.rejects(
    queryPublicDataset({ dataset: "siope_comuni", year: 1999 }),
    /Anno SIOPE non disponibile/,
  );
  const result = await queryPublicDataset({ dataset: "siope_comuni", year: 2025, region: "Lazio" });
  assert.equal(result.year, 2025);
  assert.ok(result.regions.length <= 1);
  assert.ok(result.regions.every((item) => item.region === "Lazio"));
  assert.ok(result.topMunicipalities.every((item) => item.region === "Lazio"));
  assert.ok(result.topMunicipalitiesByValue.every((item) => item.region === "Lazio"));
  assert.ok(result.topMunicipalitiesByPerCapita.every((item) => item.region === "Lazio"));
  assert.ok(result.topMunicipalitiesByPerCapita.every((item) => item.province.length > 0));
  assert.equal(result.queryLimitations.regionAggregateComplete, true);
  assert.match(result.queryLimitations.municipalityLists, /non elenco completo/i);
});

test("OpenCivitas query bounds pagination and rejects unavailable years", async () => {
  await assert.rejects(
    queryPublicDataset({ dataset: "opencivitas_fabbisogni", year: 2020 }),
    /OpenCivitas è disponibile/,
  );
  const result = await queryPublicDataset({
    dataset: "opencivitas_fabbisogni",
    limit: 10_000,
    offset: -10,
  });
  assert.equal(result.pagination.limit, 100);
  assert.equal(result.pagination.offset, 0);
  assert.ok(result.data.length <= 100);
});

test("datasets requiring a domain identifier fail closed", async () => {
  await assert.rejects(
    queryPublicDataset({ dataset: "ipa_struttura" }),
    /filtro code è obbligatorio/,
  );
  await assert.rejects(
    queryPublicDataset({ dataset: "openbdap_opere_pubbliche" }),
    /filtro cup è obbligatorio/,
  );
});

test("OpenBDAP month cannot be detached from its reference year", async () => {
  await assert.rejects(
    queryPublicDataset({ dataset: "openbdap_spesa_stato", month: 3 }),
    /indicare anche l’anno/,
  );
});

test("dataset adapters reject filters they do not implement", async () => {
  await assert.rejects(
    queryPublicDataset({ dataset: "siope_comuni", year: 2025, month: 1 }),
    /Filtri non supportati.*month/,
  );
  await assert.rejects(
    queryPublicDataset({ dataset: "opencoesione_progetti", year: 2025 }),
    /Filtri non supportati.*year/,
  );
});

test("IPA entity lookup does not silently ignore an ambiguous search filter", async () => {
  await assert.rejects(
    queryPublicDataset({ dataset: "ipa_enti", code: "agid", query: "ministero" }),
    /code oppure query, non entrambi/,
  );
});

test("every snapshot-backed MCP adapter returns real structured data", async () => {
  const [cohesion, anac, inps, cpt, irpef, participations, appointments, parliament, controls, sources] = await Promise.all([
    queryPublicDataset({ dataset: "opencoesione_progetti" }),
    queryPublicDataset({ dataset: "anac_cig_snapshot", year: 2025 }),
    queryPublicDataset({ dataset: "inps_invalidita_civile", year: 2023, region: "Calabria" }),
    queryPublicDataset({ dataset: "cpt_finanza_regionale", year: 2023, region: "Calabria" }),
    queryPublicDataset({ dataset: "mef_irpef_comunale", year: 2024 }),
    queryPublicDataset({ dataset: "mef_partecipazioni" }),
    queryPublicDataset({ dataset: "consulenti_incarichi" }),
    queryPublicDataset({ dataset: "parlamento_bilanci" }),
    queryPublicDataset({ dataset: "controlli_segnali" }),
    queryPublicDataset({ dataset: "registro_fonti" }),
  ]);

  assert.ok(cohesion.totals.publicCostCents > 0);
  assert.equal(cohesion.derived.themes.length, cohesion.themes.length);
  assert.match(
    cohesion.derived.definitions.costPaymentDifferenceCents,
    /non è debito né arretrato/i,
  );
  assert.equal(anac.coverage.completeYear, true);
  assert.equal(anac.inputs.length, 12);
  assert.ok(participations.totals.participationRecords > 0);
  assert.deepEqual(inps.regionalNewPensions.regions, [{ region: "Calabria", values: [8789] }]);
  assert.equal(inps.spending.geographicScope.level, "country");
  assert.equal(inps.regionalNewPensions.geographicScopes.rows.level, "region");
  assert.equal(inps.regionalNewPensions.geographicScopes.nationalTotals.level, "covered-regions");
  assert.deepEqual(inps.spending.change, {
    fromYear: 2022,
    toYear: 2023,
    amountCents: 108_400_000_000,
    percent: 5.3,
  });
  assert.equal(inps.benefitsStock, null);
  assert.deepEqual(inps.regionalNewPensions.provisionalYears, []);
  assert.match(inps.methodology.interpretation, /non provano frode/i);
  assert.equal(cpt.rows.length, 1);
  assert.equal(cpt.rows[0].region, "Calabria");
  assert.equal(cpt.rows[0].balanceCents, cpt.rows[0].revenueCents - cpt.rows[0].expenditureCents);
  assert.match(cpt.methodology.notFiscalResidual, /non è il residuo fiscale/i);
  assert.equal(irpef.dataset, "mef_irpef_comunale");
  assert.equal(irpef.pagination.returned, 20);
  assert.ok(irpef.data.every((item) => item.territory.level === "region"));
  assert.equal(
    irpef.national.assigned.taxpayers + irpef.national.unassigned.taxpayers,
    irpef.national.allSource.taxpayers,
  );
  assert.ok(appointments.externalAppointments.length > 0);
  assert.ok(parliament.chambers.length > 0);
  assert.ok(controls.signals.length > 0);
  assert.ok(sources.length > 0);
});

test("MEF IRPEF MCP adapter delegates to the bounded domain query", async () => {
  const result = await queryPublicDataset({
    dataset: "mef_irpef_comunale",
    year: 2024,
    level: "municipality",
    code: "001019",
  });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].territory.name, "BALME");
  assert.deepEqual(result.data[0].measures.municipalSurtaxDue, {
    coverage: "partial",
    knownFrequency: 0,
    knownAmountCents: 0,
    suppressedRows: 1,
  });
  assert.match(result.caveats.join(" "), /non è il gettito fiscale totale/i);
  await assert.rejects(
    queryPublicDataset({
      dataset: "mef_irpef_comunale",
      level: "municipality",
      query: "Roma",
      limit: 101,
    }),
    /limit/,
  );
});

test("every snapshot catalog example is executable offline", async () => {
  for (const dataset of datasetCatalog.filter((item) => item.freshness === "snapshot")) {
    const result = await queryPublicDataset(dataset.exampleQuery);
    assert.notEqual(result, undefined, dataset.id);
  }
});

test("MCP fails closed for an unknown runtime dataset", async () => {
  await assert.rejects(
    queryPublicDataset({ dataset: "dataset_inesistente" }),
    /Dataset non supportato/,
  );
});

test("ANAC snapshot rejects unavailable years instead of returning stale data", async () => {
  await assert.rejects(
    queryPublicDataset({ dataset: "anac_cig_snapshot", year: 2024 }),
    /disponibile solo per il 2025/,
  );
});
