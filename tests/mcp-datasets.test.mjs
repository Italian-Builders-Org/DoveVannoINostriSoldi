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
    if (dataset.id.startsWith("company_") || dataset.id.startsWith("education_")) {
      assert.ok(dataset.sources.length > 0, `${dataset.id}: custom source metadata missing`);
    } else {
      assert.equal(dataset.sources.length, dataset.sourceIds.length);
    }
    for (const source of dataset.sources) {
      assert.match(source.url, /^https:\/\//);
      assert.ok(source.owner.length > 0);
    }
  }
  const siope = datasetCatalog.find((dataset) => dataset.id === "siope_comuni");
  assert.match(siope.caveat, /distribution/i);
  assert.match(siope.caveat, /primi 100/i);
  const ssn = datasetCatalog.find((dataset) => dataset.id === "openbdap_ssn_conto_economico");
  assert.match(ssn.summary, /Consuntivo 2024 OpenBDAP/i);
  assert.match(ssn.caveat, /gettonisti.*cooperative/i);
  assert.deepEqual(ssn.filters, ["year", "region", "code", "limit", "offset"]);
  const debt = datasetCatalog.find((dataset) => dataset.id === "debito_pubblico_italiano");
  assert.deepEqual(debt.filters, []);
  assert.deepEqual(debt.sourceIds, ["bancaditalia", "eurostat"]);
  const pensionBenefits = datasetCatalog.find((dataset) => dataset.id === "istat_pensioni_prestazioni");
  assert.deepEqual(pensionBenefits.sourceIds, ["istat-casellario-pensioni"]);
  assert.deepEqual(pensionBenefits.filters, ["year"]);
  assert.match(pensionBenefits.caveat, /denominatore.*prestazioni/i);
  assert.match(pensionBenefits.caveat, /importi.*lordi/i);
  assert.match(pensionBenefits.caveat, /non.*sommabile/i);
  const pensioners = datasetCatalog.find((dataset) => dataset.id === "istat_pensionati_persone");
  assert.deepEqual(pensioners.sourceIds, ["istat-casellario-pensioni"]);
  assert.deepEqual(pensioners.filters, ["year"]);
  assert.match(pensioners.caveat, /denominatore.*persone/i);
  assert.match(pensioners.caveat, /importi.*lordi/i);
  assert.match(pensioners.caveat, /non.*sommabile/i);
});

test("ISTAT pension MCP projections keep benefits and persons separate", async () => {
  const benefits = await queryPublicDataset({
    dataset: "istat_pensioni_prestazioni",
    year: 2022,
  });
  assert.equal(benefits.dataset, "istat_pensioni_prestazioni");
  assert.deepEqual(benefits.period, { from: 2012, to: 2022 });
  assert.equal(benefits.pensionBenefits.length, 8);
  assert.equal(benefits.pensionBenefits.every((row) => row.year === 2022), true);
  assert.equal(Object.hasOwn(benefits, "pensioners"), false);

  const pensioners = await queryPublicDataset({
    dataset: "istat_pensionati_persone",
    year: 2022,
  });
  assert.equal(pensioners.dataset, "istat_pensionati_persone");
  assert.deepEqual(pensioners.period, { from: 2012, to: 2022 });
  assert.equal(pensioners.pensioners.length, 1);
  assert.equal(pensioners.pensioners[0].year, 2022);
  assert.equal(Object.hasOwn(pensioners, "pensionBenefits"), false);

  await assert.rejects(
    queryPublicDataset({ dataset: "istat_pensioni_prestazioni", region: "Lazio" }),
    /Filtri non supportati/,
  );
  await assert.rejects(
    queryPublicDataset({ dataset: "istat_pensionati_persone", year: 2011 }),
    /anno ISTAT pensioni.*intero tra 2012 e 2022/i,
  );
});

test("public debt MCP reuses the shared view and accepts no filters", async () => {
  const result = await queryPublicDataset({ dataset: "debito_pubblico_italiano" });
  assert.equal(result.ok, true);
  assert.equal(result.stock.totalCents, 320_724_730_000_000);
  assert.equal(result.citizenImpact.annualInterest.euroPerHundredEuro, 7.54);
  await assert.rejects(queryPublicDataset({ dataset: "debito_pubblico_italiano", year: 2025 }), /Filtri non supportati/);
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
  assert.equal(result.queryLimitations.regionAggregateComplete, false);
  assert.match(result.queryLimitations.regionAggregateCompleteDeprecated, /campo legacy/i);
  assert.equal(result.queryLimitations.regionAggregateCompleteWithinIpaJoin, true);
  assert.match(result.queryLimitations.regionAggregateCoverage, /non vengono distribuiti/i);
  assert.match(result.queryLimitations.municipalityLists, /non elenco completo/i);
  assert.equal(Object.hasOwn(result, "distribution"), false);
  assert.match(result.queryLimitations.distribution, /non è pubblicata|risposta nazionale/i);
});

test("SIOPE query resolves common region aliases and rejects unknown regions", async () => {
  const aliased = await queryPublicDataset({
    dataset: "siope_comuni",
    year: 2025,
    region: "Emilia Romagna",
  });
  assert.equal(aliased.regionFilter.resolved, "Emilia-Romagna");
  assert.equal(aliased.regionFilter.matched, true);
  assert.equal(aliased.regions.length, 1);
  assert.equal(aliased.regions[0].region, "Emilia-Romagna");

  await assert.rejects(
    queryPublicDataset({ dataset: "siope_comuni", year: 2025, region: "Atlantide" }),
    /Regione non trovata: Atlantide/,
  );
});

test("OpenCivitas query resolves region aliases and rejects unknown regions", async () => {
  const aliased = await queryPublicDataset({
    dataset: "opencivitas_fabbisogni",
    region: "Emilia Romagna",
    limit: 5,
  });
  assert.ok(aliased.data.length > 0);
  assert.ok(aliased.data.every((item) => item.region === "EMILIA-ROMAGNA"));

  await assert.rejects(
    queryPublicDataset({ dataset: "opencivitas_fabbisogni", region: "Sardegna" }),
    /Regione non trovata: Sardegna/,
  );
});

test("SIOPE national MCP query carries only compact full-population aggregates", async () => {
  const result = await queryPublicDataset({ dataset: "siope_comuni", year: 2026 });
  assert.equal(result.distribution.schemaVersion, 2);
  assert.equal(result.distribution.regions.length, 20);
  assert.equal(result.distribution.populationBands.length, 8);
  assert.equal(Object.hasOwn(result.distribution, "municipalities"), false);
  assert.ok(JSON.stringify(result.distribution).length < 64 * 1024);
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

test("OpenBDAP SSN MCP query preserves accounting scope and official geography", async () => {
  const result = await queryPublicDataset({
    dataset: "openbdap_ssn_conto_economico",
    year: 2024,
    region: "P. A. Trento",
    limit: 2,
  });
  assert.equal(result.referenceYear, 2024);
  assert.equal(result.observation.type, "CONSUNTIVO");
  assert.match(result.observation.accountingBasis, /competenza economica/);
  assert.deepEqual(result.regions.map((region) => region.code), ["042"]);
  assert.equal(result.entities.length, 1);
  assert.equal(result.selectedAggregate.level, "region");
  assert.equal(result.selectedAggregate.code, "042");
  assert.deepEqual(result.selectedAggregate.values, result.regions[0].values);
  assert.match(result.methodology.externalStaffBoundary, /non usa.*gettonisti.*cooperative/i);
  assert.ok(JSON.stringify(result).length < 750 * 1024);
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
  await assert.rejects(
    queryPublicDataset({ dataset: "spesa_pa_dettaglio" }),
    /filtro code è obbligatorio/,
  );
});

test("integrated spending MCP adapter delegates to the same bounded public selector", async () => {
  const result = await queryPublicDataset({
    dataset: "spesa_pa_dettaglio",
    code: "consulenze-legali",
    query: "2024",
    limit: 5,
  });

  assert.equal(result.dataset.id, "consulenze-legali");
  assert.equal(result.limit, 5);
  assert.ok(result.rows.length <= 5);
  assert.equal(result.matchedRows, null);
  assert.equal(typeof result.pagination.nextCursor, "string");
  assert.ok(result.rows.every((row) => row.evidenceLabel === "documented-fact"));

  const continued = await queryPublicDataset({
    dataset: "spesa_pa_dettaglio",
    code: "consulenze-legali",
    query: "2024",
    limit: 5,
    cursor: result.pagination.nextCursor,
  });
  assert.ok(
    continued.rows[0].sourceRow > result.rows.at(-1).sourceRow,
    "la continuazione deve avanzare oltre l'ultima corrispondenza senza duplicarla",
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

  const detailed = await queryPublicDataset({
    dataset: "mef_irpef_comunale",
    year: 2024,
    level: "municipality",
    code: "028001",
    detail: "income-sources",
  });
  assert.ok(detailed.data[0].breakdowns.incomeSources.employmentIncome.amountCents > 0);
  assert.equal(detailed.data[0].breakdowns.incomeBands, undefined);
  assert.deepEqual(
    detailed.national.unassigned.breakdowns.incomeSources.selfEmploymentIncome,
    {
      coverage: "partial",
      knownFrequency: 0,
      knownAmountCents: 0,
      suppressedRows: 1,
      suppressedFrequencyRows: 1,
      suppressedAmountRows: 0,
    },
  );
  await assert.rejects(
    queryPublicDataset({
      dataset: "mef_irpef_comunale",
      level: "municipality",
      query: "Roma",
      limit: 101,
    }),
    /limit/,
  );
  await assert.rejects(
    queryPublicDataset({ dataset: "siope_comuni", detail: "all" }),
    /Filtri non supportati.*detail/,
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

test("il dataset MCP consip_ordini dichiara fonte, filtri e caveat sui limiti", () => {
  const consip = datasetCatalog.find((dataset) => dataset.id === "consip_ordini");
  assert.deepEqual(consip.sourceIds, ["consip"]);
  assert.deepEqual(consip.filters, ["year", "channel"]);
  assert.match(consip.caveat, /limiti inferiori/i);
  assert.match(consip.caveat, /ordinato non è pagato/i);
  assert.equal(consip.freshness, "snapshot");
});

test("la proiezione MCP consip_ordini filtra per anno e canale e porta i caveat", async () => {
  const result = await queryPublicDataset({ dataset: "consip_ordini", year: 2025, channel: "mepa" });
  assert.equal(result.dataset, "consip_ordini");
  assert.equal(result.totals.length, 1);
  assert.equal(result.totals[0].year, 2025);
  assert.equal(result.totals[0].channel, "mepa");
  assert.equal(result.byRegion.every((row) => row.channel === "mepa"), true);
  assert.equal(result.caveats.length > 0, true);
  assert.equal(result.source.licenseId, "CC-BY-4.0");
});

test("il dataset MCP eurostat_cofog dichiara fonte, filtri e caveat sul perimetro", () => {
  const cofog = datasetCatalog.find((dataset) => dataset.id === "eurostat_cofog");
  assert.deepEqual(cofog.sourceIds, ["eurostat-cofog"]);
  assert.deepEqual(cofog.filters, ["country", "year", "cofog"]);
  assert.match(cofog.caveat, /non sono pagamenti di cassa/i);
  assert.match(cofog.caveat, /non misura efficienza/i);
  assert.match(cofog.caveat, /interruzione della serie/i);
  assert.equal(cofog.freshness, "snapshot");
});

test("la proiezione MCP eurostat_cofog filtra per paese, anno e funzione", async () => {
  const result = await queryPublicDataset({ dataset: "eurostat_cofog", country: "IT", year: 2024 });
  assert.equal(result.dataset, "eurostat_cofog");
  assert.equal(result.observations.length, 11);
  assert.equal(result.observations.every((row) => row.geo === "IT" && row.year === 2024), true);
  assert.equal(result.caveats.length > 0, true);
  assert.equal(result.source.licenseId, "CC-BY-4.0");

  const health = await queryPublicDataset({ dataset: "eurostat_cofog", country: "IT", cofog: "GF07" });
  assert.equal(health.observations.every((row) => row.function === "GF07"), true);
});

test("la proiezione MCP eurostat_cofog rifiuta filtri non dichiarati", async () => {
  await assert.rejects(
    () => queryPublicDataset({ dataset: "eurostat_cofog", region: "Lazio" }),
    /Filtri non supportati/,
  );
});

test("il dataset MCP inps_naspi dichiara fonte, filtri e caveat sulle due misure", () => {
  const naspi = datasetCatalog.find((dataset) => dataset.id === "inps_naspi");
  assert.deepEqual(naspi.sourceIds, ["inps-naspi"]);
  assert.deepEqual(naspi.filters, ["table", "measure", "year", "territory"]);
  assert.match(naspi.caveat, /misure diverse/);
  assert.match(naspi.caveat, /NON euro/);
  assert.match(naspi.caveat, /soppresse/);
  assert.equal(naspi.freshness, "snapshot");
});

test("la proiezione MCP inps_naspi filtra per tabella, anno e territorio", async () => {
  const result = await queryPublicDataset({ dataset: "inps_naspi", table: "beneficiari_02", year: 2022, territory: "ITF3" });
  assert.equal(result.dataset, "inps_naspi");
  assert.equal(result.observations.length, 2);
  assert.equal(result.observations.every((row) => row.territorio === "ITF3"), true);
  assert.equal(result.source.licenseId, "IODL-2.0");
  assert.equal(result.caveats.length > 0, true);
});

test("la proiezione MCP inps_naspi rifiuta filtri non dichiarati", async () => {
  await assert.rejects(
    () => queryPublicDataset({ dataset: "inps_naspi", region: "Lazio" }),
    /Filtri non supportati/,
  );
});

test("il dataset MCP istat_cofog dichiara fonte, filtri e caveat sul perimetro", () => {
  const cofog = datasetCatalog.find((dataset) => dataset.id === "istat_cofog");
  assert.deepEqual(cofog.sourceIds, ["istat-cofog"]);
  assert.deepEqual(cofog.filters, ["territory", "year", "cofog"]);
  assert.match(cofog.caveat, /NON la spesa pubblica totale/);
  assert.match(cofog.caveat, /doppio conteggio|non vanno sommate/i);
  assert.match(cofog.caveat, /revisione/);
  assert.equal(cofog.freshness, "snapshot");
});

test("la proiezione MCP istat_cofog filtra per territorio, anno e funzione", async () => {
  const result = await queryPublicDataset({ dataset: "istat_cofog", territory: "IT", year: 2023 });
  assert.equal(result.dataset, "istat_cofog");
  assert.equal(result.observations.length, 11);
  assert.equal(result.observations.every((row) => row.area === "IT" && row.year === 2023), true);
  assert.equal(result.caveats.length > 0, true);
  assert.equal(result.source.licenseId, "not-declared");

  const sanita = await queryPublicDataset({ dataset: "istat_cofog", territory: "ITF3", cofog: "G070" });
  assert.equal(sanita.observations.every((row) => row.function === "G070"), true);
});

test("la proiezione MCP istat_cofog rifiuta filtri non dichiarati", async () => {
  await assert.rejects(
    () => queryPublicDataset({ dataset: "istat_cofog", region: "Lazio" }),
    /Filtri non supportati/,
  );
});

test("la proiezione MCP consip_ordini rifiuta filtri non dichiarati", async () => {
  await assert.rejects(
    () => queryPublicDataset({ dataset: "consip_ordini", region: "Lazio" }),
    /Filtri non supportati/,
  );
});
