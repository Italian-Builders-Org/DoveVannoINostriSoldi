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
    for (const sourceId of dataset.sourceIds) assert.ok(knownSources.has(sourceId), sourceId);
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
  const [cohesion, anac, participations, appointments, parliament, controls, sources] = await Promise.all([
    queryPublicDataset({ dataset: "opencoesione_progetti" }),
    queryPublicDataset({ dataset: "anac_cig_snapshot", year: 2025 }),
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
  assert.ok(appointments.externalAppointments.length > 0);
  assert.ok(parliament.chambers.length > 0);
  assert.ok(controls.signals.length > 0);
  assert.ok(sources.length > 0);
});

test("ANAC snapshot rejects unavailable years instead of returning stale data", async () => {
  await assert.rejects(
    queryPublicDataset({ dataset: "anac_cig_snapshot", year: 2024 }),
    /disponibile solo per il 2025/,
  );
});
