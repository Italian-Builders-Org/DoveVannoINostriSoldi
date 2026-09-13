import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  istatPensionsData,
  istatPensionsMetadata,
  queryIstatPensions,
} = await import("../src/lib/istat-pensions-snapshot.ts");
const {
  validateIstatPensionsBundle,
  validateIstatPensionsMetadata,
  validateIstatPensionsSnapshot,
} = await import("../src/lib/data/istat-pensions-contract.ts");

test("il bundle ISTAT pensioni mantiene flussi, periodo e fonti distinti", () => {
  const validated = validateIstatPensionsBundle(istatPensionsData, istatPensionsMetadata);
  assert.equal(validated.data.schemaVersion, 1);
  assert.deepEqual(validated.data.period, { from: 2012, to: 2022 });
  // Lo snapshot copre 142 territori: le righe nazionali restano 88 e 11.
  assert.equal(validated.data.pensionBenefits.observations.length, 12_224);
  assert.equal(validated.data.pensioners.observations.length, 1_537);
  assert.equal(validated.data.territories.length, 142);
  assert.equal(
    validated.data.pensionBenefits.observations.filter((row) => row.territory === "IT").length,
    88,
  );
  assert.equal(
    validated.data.pensioners.observations.filter((row) => row.territory === "IT").length,
    11,
  );
  assert.equal(validated.metadata.source.assets.pensionBenefits.dataflowId, "IT1,46_813,1.0");
  assert.equal(validated.metadata.source.assets.pensionBenefits.dsd, "DCAR_PENSIONI2");
  assert.equal(validated.metadata.source.assets.pensioners.dataflowId, "IT1,46_812,1.0");
  assert.equal(validated.metadata.source.assets.pensioners.dsd, "DCAR_PENSIONATI2");
  assert.equal(validated.metadata.source.licenseStatus, "not-declared");
  assert.equal(validated.metadata.overlap.additive, false);
});

test("queryIstatPensions filtra l'anno e proietta fonti con titolo, URL, periodo e hash", () => {
  const all = queryIstatPensions();
  // Il default della query resta il nazionale: una chiamata invariata non deve
  // ricevere d'un tratto 142 volte le righe.
  assert.equal(all.territory, "IT");
  assert.equal(all.pensionBenefits.length, 88);
  assert.equal(all.pensioners.length, 11);
  assert.equal(all.sources.length, 2);
  assert.deepEqual(all.sources.map((source) => source.id), [
    "istat-pension-benefits-2012-2022",
    "istat-pensioners-2012-2022",
  ]);
  assert.deepEqual(all.sources[0].period, { from: 2012, to: 2022 });
  assert.match(all.sources[0].url, /A\.\.P_NSNU\+ANP_NS\+AMEP_NS/);
  assert.match(all.sources[1].url, /A\.\.P_RSNU\+ANP_RS\+AMEP_RS/);

  const latest = queryIstatPensions({ year: 2022 });
  assert.equal(latest.pensionBenefits.length, 8);
  assert.equal(latest.pensioners.length, 1);
  assert.equal(latest.pensionBenefits.find((row) => row.pensionType === "ALL").pensionCount, 22_365_288);
  assert.equal(latest.pensioners[0].pensionerCount, 15_759_676);
  assert.throws(() => queryIstatPensions({ year: 2011 }), /intero tra 2012 e 2022/);
  assert.throws(() => queryIstatPensions({ year: 2022.5 }), /intero tra 2012 e 2022/);
});

test("il contratto fallisce chiuso su schema, categorie, duplicati, anni e riconciliazioni", () => {
  const missingField = structuredClone(istatPensionsData);
  delete missingField.pensionBenefits.observations[0].grossAnnualMeanEuros;
  assert.throws(() => validateIstatPensionsSnapshot(missingField));

  const unknownCategory = structuredClone(istatPensionsData);
  unknownCategory.pensionBenefits.observations[0].pensionType = "UNKNOWN";
  assert.throws(() => validateIstatPensionsSnapshot(unknownCategory));

  // La chiave ora include il territorio: un doppione vero copia tutte e tre le
  // coordinate, non solo la categoria.
  const duplicate = structuredClone(istatPensionsData);
  const [first] = duplicate.pensionBenefits.observations;
  Object.assign(duplicate.pensionBenefits.observations[1], {
    territory: first.territory,
    year: first.year,
    pensionType: first.pensionType,
  });
  assert.throws(() => validateIstatPensionsSnapshot(duplicate), /duplicata/i);

  const foreignTerritory = structuredClone(istatPensionsData);
  foreignTerritory.pensionBenefits.observations[0].territory = "ITZZZ";
  assert.throws(() => validateIstatPensionsSnapshot(foreignTerritory), /anagrafica/i);

  // Un territorio soppresso non puo comparire fuori dalla sua finestra.
  const outOfCoverage = structuredClone(istatPensionsData);
  const abolished = outOfCoverage.pensionBenefits.observations.find((row) => row.territory === "ITG2A");
  abolished.year = 2022;
  assert.throws(() => validateIstatPensionsSnapshot(outOfCoverage), /copertura dichiarata/i);

  const missingYear = structuredClone(istatPensionsData);
  missingYear.pensionBenefits.observations[8].year = 2012;
  assert.throws(() => validateIstatPensionsSnapshot(missingYear), /copertura|duplicata/i);

  const brokenAmount = structuredClone(istatPensionsData);
  brokenAmount.pensionBenefits.observations[1].grossAnnualThousandEuros += 100;
  assert.throws(() => validateIstatPensionsSnapshot(brokenAmount), /riconcilia|Riconciliazione/i);

  const brokenMean = structuredClone(istatPensionsData);
  brokenMean.pensioners.observations[0].grossAnnualMeanEuros += 100;
  assert.throws(() => validateIstatPensionsSnapshot(brokenMean), /media pensionati/i);
});

test("il contratto dei metadati fallisce su hash, byte, schema e query wildcard", () => {
  const wrongHash = structuredClone(istatPensionsMetadata);
  wrongHash.source.assets.pensionBenefits.sha256 = "0".repeat(64);
  assert.throws(() => validateIstatPensionsMetadata(wrongHash));

  const wrongBytes = structuredClone(istatPensionsMetadata);
  wrongBytes.source.assets.pensioners.bytes += 1;
  assert.throws(() => validateIstatPensionsMetadata(wrongBytes));

  const wrongSchema = structuredClone(istatPensionsMetadata);
  wrongSchema.schemaVersion = 2;
  assert.throws(() => validateIstatPensionsMetadata(wrongSchema));

  const wildcard = structuredClone(istatPensionsMetadata);
  wildcard.source.assets.pensionBenefits.queryKey = "all";
  assert.throws(() => validateIstatPensionsMetadata(wildcard), /wildcard|non ammessa/i);

  const wrongHost = structuredClone(istatPensionsMetadata);
  wrongHost.source.assets.pensionBenefits.url = wrongHost.source.assets.pensionBenefits.url
    .replace("https://esploradati.istat.it", "https://example.org");
  assert.throws(() => validateIstatPensionsMetadata(wrongHost), /non autorizzata/i);

  const driftedArtifact = structuredClone(istatPensionsData);
  driftedArtifact.caveats.nominal += " Testo alterato.";
  assert.throws(
    () => validateIstatPensionsBundle(driftedArtifact, istatPensionsMetadata),
    /Binding byte\/SHA-256/i,
  );
});

test("il taglio territoriale copre 142 codici e distingue cio che non e un luogo", () => {
  const byCode = new Map(istatPensionsData.territories.map((entry) => [entry.code, entry]));
  assert.equal(byCode.size, 142);

  // ITTOT non e l'Italia: e Italia piu Estero piu Non indicato.
  for (const code of ["ITTOT", "ITS", "ITNI"]) {
    assert.equal(byCode.get(code).geographic, false, code);
  }
  assert.equal(byCode.get("IT").geographic, true);
  assert.equal(byCode.get("ITS").kind, "estero");
  assert.equal(byCode.get("ITNI").kind, "non-indicato");
  assert.equal(byCode.get("ITTOT").kind, "totale");

  const kinds = {};
  for (const entry of byCode.values()) kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1;
  assert.deepEqual(kinds, {
    totale: 1, country: 1, ripartizione: 5, regione: 22, provincia: 111, estero: 1, "non-indicato": 1,
  });
});

test("le identita territoriali sono esatte sui conteggi e arrotondate sugli importi", () => {
  const cell = new Map(
    istatPensionsData.pensionBenefits.observations
      .filter((row) => row.pensionType === "ALL")
      .map((row) => [`${row.territory}|${row.year}`, row]),
  );
  for (const identity of istatPensionsData.territorialIdentities) {
    assert.equal(identity.exactOn, "conteggi");
    const bound = Math.ceil((identity.parts.length + 1) / 2);
    let checked = 0;
    for (let year = 2012; year <= 2022; year += 1) {
      const total = cell.get(`${identity.whole}|${year}`);
      const parts = identity.parts.map((part) => cell.get(`${part}|${year}`));
      if (!total || parts.some((row) => !row)) continue;
      checked += 1;
      // Esatta sui conteggi: qui non si concede nulla.
      assert.equal(total.pensionCount, parts.reduce((sum, row) => sum + row.pensionCount, 0));
      // Sugli importi vale solo l'arrotondamento al migliaio.
      const delta = Math.abs(
        total.grossAnnualThousandEuros - parts.reduce((sum, row) => sum + row.grossAnnualThousandEuros, 0),
      );
      assert.ok(delta <= bound, `${identity.whole}/${year}: scarto ${delta}`);
    }
    assert.equal(checked, 11);
  }
});

test("ITTOT eccede l'Italia esattamente delle pensioni pagate all'estero", () => {
  const at = (territory, year) => istatPensionsData.pensionBenefits.observations
    .find((row) => row.territory === territory && row.year === year && row.pensionType === "ALL");
  for (const year of [2012, 2017, 2022]) {
    const gap = at("ITTOT", year).pensionCount - at("IT", year).pensionCount;
    const outside = at("ITS", year).pensionCount + at("ITNI", year).pensionCount;
    assert.equal(gap, outside);
    // Non e una differenza trascurabile: sono centinaia di migliaia di pensioni.
    assert.ok(gap > 300_000, `${year}: ${gap}`);
  }
});

test("la riforma sarda del 2016 e dichiarata, e le due fonti non chiudono lo stesso anno", () => {
  const { pensionBenefits, pensioners } = istatPensionsData.partialCoverage;
  for (const code of ["ITG29", "ITG2A", "ITG2B", "ITG2C"]) {
    assert.deepEqual(pensionBenefits[code], [2012, 2016], code);
    assert.deepEqual(pensioners[code], [2012, 2017], code);
  }
  assert.deepEqual(pensionBenefits.IT111, [2017, 2022]);
  assert.deepEqual(pensioners.IT111, [2017, 2022]);

  // E il dato rispetta la finestra dichiarata.
  for (const row of istatPensionsData.pensionBenefits.observations) {
    const span = pensionBenefits[row.territory];
    if (span) assert.ok(row.year >= span[0] && row.year <= span[1], `${row.territory}/${row.year}`);
  }
});

test("la query territoriale resta nazionale per difetto", () => {
  assert.equal(queryIstatPensions().territory, "IT");
  const province = queryIstatPensions({ territory: "itf33" });
  assert.equal(province.territory, "ITF33");
  assert.ok(province.pensionBenefits.every((row) => row.territory === "ITF33"));
  assert.ok(province.pensionBenefits.length > 0);
  assert.throws(() => queryIstatPensions({ territory: "ITZZZ" }), /Territorio non riconosciuto/);
});

test("i metadati descrivono le righe territoriali e tutte le riconciliazioni restano richieste", () => {
  assert.equal(istatPensionsMetadata.transformation.pensionBenefitsRows, istatPensionsData.pensionBenefits.observations.length);
  assert.equal(istatPensionsMetadata.transformation.pensionerRows, istatPensionsData.pensioners.observations.length);
  const incomplete = structuredClone(istatPensionsData);
  incomplete.pensionBenefits.amountReconciliations.pop();
  assert.throws(() => validateIstatPensionsSnapshot(incomplete), /riconciliazioni incomplete/i);
});

test("il catalogo MCP dichiara e applica il territorio senza mescolare prestazioni e persone", async () => {
  const { datasetCatalog } = await import('../src/lib/mcp/catalog.ts');
  const { queryPublicDataset } = await import('../src/lib/mcp/datasets.ts');
  for (const [dataset, field, other] of [
    ['istat_pensioni_prestazioni', 'pensionBenefits', 'pensioners'],
    ['istat_pensionati_persone', 'pensioners', 'pensionBenefits'],
  ]) {
    assert.ok(datasetCatalog.find((entry) => entry.id === dataset).filters.includes('territory'));
    const result = await queryPublicDataset({ dataset, territory: 'ITF3', year: 2022 });
    assert.equal(result.territory, 'ITF3');
    assert.ok(result[field].length > 0);
    assert.ok(result[field].every((row) => row.territory === 'ITF3' && row.year === 2022));
    assert.equal(result[other], undefined);
  }
});
