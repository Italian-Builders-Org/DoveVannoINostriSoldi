import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { istatPovertaData, istatPovertaMetadata, queryIstatPovertaAssoluta } = await import(
  "../src/lib/istat-poverta-snapshot.ts"
);
const { istatPovertaRelativaData, istatPovertaRelativaMetadata, queryIstatPovertaRelativa } = await import(
  "../src/lib/istat-poverta-relativa-snapshot.ts"
);
const { validateIstatPovertaBundle, validateIstatPovertaRelativaBundle } = await import(
  "../src/lib/data/istat-poverta-contract.ts"
);

const MACRO = ["ITC", "ITD", "ITE", "ITF", "ITG"];

// Le due famiglie condividono il motore, non il dato: la stessa batteria di
// controlli gira su entrambe.
const FAMILIES = [
  {
    label: "assoluta",
    token: "POVASS",
    otherToken: "POVREL",
    datasetId: "istat-poverta-assoluta",
    data: istatPovertaData,
    metadata: istatPovertaMetadata,
    query: queryIstatPovertaAssoluta,
    validate: validateIstatPovertaBundle,
  },
  {
    label: "relativa",
    token: "POVREL",
    otherToken: "POVASS",
    datasetId: "istat-poverta-relativa",
    data: istatPovertaRelativaData,
    metadata: istatPovertaRelativaMetadata,
    query: queryIstatPovertaRelativa,
    validate: validateIstatPovertaRelativaBundle,
  },
];

const years = (data) => {
  const out = [];
  for (let year = data.period.from; year <= data.period.to; year += 1) out.push(year);
  return out;
};
const cellMap = (data) =>
  new Map(data.observations.map((row) => [`${row.measure}/${row.territory}/${row.year}`, row.valueTenths]));

for (const family of FAMILIES) {
  const { label, data, metadata } = family;

  test(`[${label}] lo snapshot dichiara copertura piena e la mantiene`, () => {
    const { expectedCells, observedCells } = data.coverage;
    assert.equal(observedCells, expectedCells);
    assert.equal(data.observations.length, expectedCells);
    const cells = new Set(data.observations.map((r) => `${r.measure}/${r.territory}/${r.year}`));
    assert.equal(cells.size, expectedCells, "celle duplicate");
    assert.equal(expectedCells, 7 * 8 * 11);
  });

  test(`[${label}] pubblica solo le misure della propria famiglia`, () => {
    assert.equal(data.datasetId, family.datasetId);
    assert.equal(data.measures.length, 7);
    for (const measure of data.measures) {
      assert.ok(measure.code.includes(family.token), measure.code);
      assert.ok(!measure.code.includes(family.otherToken), measure.code);
    }
  });

  test(`[${label}] l'asse soldi è dichiarato assente, non ricostruito`, () => {
    assert.equal(metadata.semantics.soldi.unit, "nessuna — il dataset non contiene importi");
    assert.match(metadata.semantics.soldi.nature, /non sono euro/);
    for (const measure of data.measures) {
      assert.ok(["percentuale", "migliaia"].includes(measure.unit), measure.code);
    }
  });

  test(`[${label}] solo i conteggi possono dichiararsi sommabili fra territori`, () => {
    for (const measure of data.measures) {
      if (measure.kind !== "count") assert.equal(measure.summableAcrossTerritories, false, measure.code);
    }
    assert.equal(data.measures.filter((m) => m.summableAcrossTerritories).length, 2);
  });

  test(`[${label}] le aree composite restano marcate con le loro parti`, () => {
    const byCode = new Map(data.territories.map((t) => [t.code, t]));
    assert.deepEqual(byCode.get("ITCD").parts, ["ITC", "ITD"]);
    assert.deepEqual(byCode.get("ITFG").parts, ["ITF", "ITG"]);
    assert.equal(byCode.get("ITCD").kind, "composite");
    assert.equal(byCode.get("ITFG").kind, "composite");
    assert.equal(byCode.get("IT").kind, "country");
  });

  test(`[${label}] i totali pubblicati restano quelli della fonte`, () => {
    const cells = cellMap(data);
    let gaps = 0;
    let worst = 0;
    for (const measure of data.measures.filter((m) => m.kind === "count").map((m) => m.code)) {
      for (const year of years(data)) {
        const total = cells.get(`${measure}/IT/${year}`);
        const sum = MACRO.reduce((acc, code) => acc + cells.get(`${measure}/${code}/${year}`), 0);
        const gap = Math.abs(total - sum);
        worst = Math.max(worst, gap);
        if (gap > 0) gaps += 1;
      }
    }
    assert.ok(worst <= data.reconciliation.toleranceTenths, "scarto oltre la tolleranza");
    // Se avessimo ricalcolato i totali ogni scarto sarebbe zero.
    assert.ok(gaps > 0, "i totali della fonte sono stati sostituiti da somme nostre");
  });

  test(`[${label}] le incidenze NON chiudono per somma: è la prova che sono tassi`, () => {
    const cells = cellMap(data);
    const tolerance = data.reconciliation.toleranceTenths;
    const rates = data.measures.filter((m) => m.kind === "rate").map((m) => m.code);
    assert.equal(rates.length, 3);
    for (const measure of rates) {
      for (const year of years(data)) {
        const national = cells.get(`${measure}/IT/${year}`);
        const sum = MACRO.reduce((acc, code) => acc + cells.get(`${measure}/${code}/${year}`), 0);
        assert.ok(Math.abs(national - sum) > tolerance, `${measure}/${year} si comporta come un totale`);
      }
    }
  });

  test(`[${label}] le composizioni percentuali chiudono a 100`, () => {
    const cells = cellMap(data);
    for (const measure of data.measures.filter((m) => m.kind === "composition").map((m) => m.code)) {
      for (const year of years(data)) {
        const sum = MACRO.reduce((acc, code) => acc + cells.get(`${measure}/${code}/${year}`), 0);
        assert.ok(Math.abs(sum - 1000) <= 2, `${measure}/${year} somma ${sum}`);
      }
    }
  });

  test(`[${label}] il flag dichiara CL_FLAG, non CL_OBS_STATUS`, () => {
    assert.equal(data.flags.codelist, "CL_FLAG");
    assert.equal(data.flags.attribute, "OBS_STATUS");
    assert.equal(data.observations.filter((row) => row.valueTenths === null).length, data.flags.flaggedCells);
  });

  test(`[${label}] il contratto rifiuta una cella flaggata trasformata in zero`, () => {
    const broken = structuredClone(data);
    broken.flags.flaggedCells = 1;
    assert.throws(() => family.validate(broken, metadata), /celle flaggate/i);
  });

  test(`[${label}] il contratto rifiuta una misura dell'altra famiglia`, () => {
    const broken = structuredClone(data);
    broken.measures[0].code = broken.measures[0].code.replace(family.token, family.otherToken);
    assert.throws(() => family.validate(broken, metadata));
  });

  test(`[${label}] il contratto rifiuta un tasso dichiarato sommabile`, () => {
    const broken = structuredClone(data);
    broken.measures.find((m) => m.kind === "rate").summableAcrossTerritories = true;
    assert.throws(() => family.validate(broken, metadata));
  });

  test(`[${label}] il contratto rifiuta un composito senza le sue parti`, () => {
    const broken = structuredClone(data);
    delete broken.territories.find((t) => t.code === "ITCD").parts;
    assert.throws(() => family.validate(broken, metadata));
  });

  test(`[${label}] la query filtra per territorio, anno e misura`, () => {
    assert.equal(family.query({ year: 2024 }).observations.length, 7 * 8);
    const byTerritory = family.query({ territory: "it" });
    assert.ok(byTerritory.observations.every((row) => row.territory === "IT"));
    assert.equal(byTerritory.observations.length, 7 * 11);
    const code = data.measures[0].code;
    const byMeasure = family.query({ measure: code.toLowerCase() });
    assert.ok(byMeasure.observations.every((row) => row.measure === code));
    assert.equal(byMeasure.observations.length, 8 * 11);
  });

  test(`[${label}] la query rifiuta codici e anni fuori perimetro`, () => {
    assert.throws(() => family.query({ year: 2013 }), /periodo coperto/);
    assert.throws(() => family.query({ year: 2025 }), /periodo coperto/);
    // Nessun dettaglio regionale esiste in questo dataflow.
    assert.throws(() => family.query({ territory: "ITC1" }), /ripartizioni/);
    assert.throws(() => family.query({ measure: `INCID_${family.otherToken}_FAM` }), /Misura non riconosciuta/);
  });

  test(`[${label}] la fonte resta senza licenza dichiarata`, () => {
    assert.equal(metadata.source.licenseId, "not-declared");
    assert.equal(metadata.semantics.provenance.license, "not-declared");
  });

  test(`[${label}] i caveat dicono che non è spesa pubblica`, () => {
    const joined = data.caveats.join(" ");
    assert.match(joined, /Non è spesa pubblica/);
    assert.match(joined, /doppio conteggio/);
    assert.match(joined, /livello comunale/);
  });
}

test("le due famiglie non sono intercambiabili", () => {
  // Un bundle non può essere validato col contratto dell'altra famiglia: sono
  // due definizioni diverse di povertà, non due viste della stessa.
  assert.throws(() => validateIstatPovertaRelativaBundle(istatPovertaData, istatPovertaMetadata));
  assert.throws(() => validateIstatPovertaBundle(istatPovertaRelativaData, istatPovertaRelativaMetadata));
});

test("le due famiglie hanno id, artefatti e byte distinti", () => {
  assert.notEqual(istatPovertaData.datasetId, istatPovertaRelativaData.datasetId);
  const digest = (metadata) => Object.values(metadata.source.assets)[0].sha256;
  assert.notEqual(digest(istatPovertaMetadata), digest(istatPovertaRelativaMetadata));
  // Stesso dataflow, chiavi diverse: è ciò che rende i due lock non riusabili.
  assert.equal(istatPovertaMetadata.source.dataflowId, istatPovertaRelativaMetadata.source.dataflowId);
});
