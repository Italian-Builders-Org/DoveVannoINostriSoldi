import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { istatPovertaData, istatPovertaMetadata, queryIstatPovertaAssoluta } = await import(
  "../src/lib/istat-poverta-snapshot.ts"
);
const { validateIstatPovertaBundle } = await import("../src/lib/data/istat-poverta-contract.ts");

const MACRO = ["ITC", "ITD", "ITE", "ITF", "ITG"];
const years = () => {
  const out = [];
  for (let year = istatPovertaData.period.from; year <= istatPovertaData.period.to; year += 1) out.push(year);
  return out;
};
const cellMap = () =>
  new Map(istatPovertaData.observations.map((row) => [`${row.measure}/${row.territory}/${row.year}`, row.valueTenths]));

test("lo snapshot dichiara copertura piena e la mantiene", () => {
  const { expectedCells, observedCells } = istatPovertaData.coverage;
  assert.equal(observedCells, expectedCells);
  assert.equal(istatPovertaData.observations.length, expectedCells);
  const cells = new Set(istatPovertaData.observations.map((r) => `${r.measure}/${r.territory}/${r.year}`));
  assert.equal(cells.size, expectedCells, "celle duplicate");
  assert.equal(expectedCells, 7 * 8 * 11);
});

test("pubblica solo misure assolute: la povertà relativa è un altro dataset", () => {
  assert.equal(istatPovertaData.measures.length, 7);
  for (const measure of istatPovertaData.measures) {
    assert.ok(measure.code.includes("POVASS"), measure.code);
    assert.ok(!measure.code.includes("POVREL"), measure.code);
  }
});

test("l'asse soldi è dichiarato assente, non ricostruito", () => {
  const soldi = istatPovertaMetadata.semantics.soldi;
  assert.equal(soldi.unit, "nessuna — il dataset non contiene importi");
  assert.match(soldi.nature, /non sono euro/);
  // Nessuna misura può dichiararsi monetaria.
  for (const measure of istatPovertaData.measures) {
    assert.ok(["percentuale", "migliaia"].includes(measure.unit), measure.code);
  }
});

test("solo i conteggi possono dichiararsi sommabili fra territori", () => {
  for (const measure of istatPovertaData.measures) {
    if (measure.kind !== "count") assert.equal(measure.summableAcrossTerritories, false, measure.code);
  }
  assert.equal(istatPovertaData.measures.filter((m) => m.summableAcrossTerritories).length, 2);
});

test("le aree composite restano marcate con le loro parti", () => {
  const byCode = new Map(istatPovertaData.territories.map((t) => [t.code, t]));
  assert.equal(byCode.get("ITCD").kind, "composite");
  assert.deepEqual(byCode.get("ITCD").parts, ["ITC", "ITD"]);
  assert.equal(byCode.get("ITFG").kind, "composite");
  assert.deepEqual(byCode.get("ITFG").parts, ["ITF", "ITG"]);
  assert.equal(byCode.get("IT").kind, "country");
});

test("i totali pubblicati restano quelli della fonte", () => {
  const cells = cellMap();
  let gaps = 0;
  let worst = 0;
  for (const measure of istatPovertaData.measures.filter((m) => m.kind === "count").map((m) => m.code)) {
    for (const year of years()) {
      const total = cells.get(`${measure}/IT/${year}`);
      const sum = MACRO.reduce((acc, code) => acc + cells.get(`${measure}/${code}/${year}`), 0);
      const gap = Math.abs(total - sum);
      worst = Math.max(worst, gap);
      if (gap > 0) gaps += 1;
    }
  }
  assert.ok(worst <= istatPovertaData.reconciliation.toleranceTenths, "scarto oltre la tolleranza");
  // Se avessimo ricalcolato i totali ogni scarto sarebbe zero.
  assert.ok(gaps > 0, "i totali della fonte sono stati sostituiti da somme nostre");
});

test("le incidenze NON chiudono per somma: è la prova che sono tassi", () => {
  const cells = cellMap();
  const tolerance = istatPovertaData.reconciliation.toleranceTenths;
  const rates = istatPovertaData.measures.filter((m) => m.kind === "rate").map((m) => m.code);
  assert.equal(rates.length, 3);
  for (const measure of rates) {
    for (const year of years()) {
      const national = cells.get(`${measure}/IT/${year}`);
      const sum = MACRO.reduce((acc, code) => acc + cells.get(`${measure}/${code}/${year}`), 0);
      assert.ok(Math.abs(national - sum) > tolerance, `${measure}/${year} si comporta come un totale`);
    }
  }
});

test("le composizioni percentuali chiudono a 100 sulle ripartizioni", () => {
  const cells = cellMap();
  for (const measure of istatPovertaData.measures.filter((m) => m.kind === "composition").map((m) => m.code)) {
    for (const year of years()) {
      const sum = MACRO.reduce((acc, code) => acc + cells.get(`${measure}/${code}/${year}`), 0);
      assert.ok(Math.abs(sum - 1000) <= 2, `${measure}/${year} somma ${sum}`);
    }
  }
});

test("il flag dichiara CL_FLAG, non CL_OBS_STATUS", () => {
  assert.equal(istatPovertaData.flags.codelist, "CL_FLAG");
  assert.equal(istatPovertaData.flags.attribute, "OBS_STATUS");
  const flagged = istatPovertaData.observations.filter((row) => row.valueTenths === null).length;
  assert.equal(flagged, istatPovertaData.flags.flaggedCells);
});

test("il contratto rifiuta una cella flaggata trasformata in zero", () => {
  const broken = structuredClone(istatPovertaData);
  broken.flags.flaggedCells = 1;
  assert.throws(
    () => validateIstatPovertaBundle(broken, istatPovertaMetadata),
    /celle flaggate/i,
  );
});

test("il contratto rifiuta una misura relativa", () => {
  const broken = structuredClone(istatPovertaData);
  broken.measures[0].code = "INCID_POVREL_FAM";
  assert.throws(() => validateIstatPovertaBundle(broken, istatPovertaMetadata));
});

test("il contratto rifiuta un tasso dichiarato sommabile", () => {
  const broken = structuredClone(istatPovertaData);
  const rate = broken.measures.find((m) => m.kind === "rate");
  rate.summableAcrossTerritories = true;
  assert.throws(() => validateIstatPovertaBundle(broken, istatPovertaMetadata));
});

test("il contratto rifiuta un composito senza le sue parti", () => {
  const broken = structuredClone(istatPovertaData);
  delete broken.territories.find((t) => t.code === "ITCD").parts;
  assert.throws(() => validateIstatPovertaBundle(broken, istatPovertaMetadata));
});

test("la query filtra per territorio, anno e misura", () => {
  const byYear = queryIstatPovertaAssoluta({ year: 2024 });
  assert.equal(byYear.observations.length, 7 * 8);
  const byTerritory = queryIstatPovertaAssoluta({ territory: "it" });
  assert.ok(byTerritory.observations.every((row) => row.territory === "IT"));
  assert.equal(byTerritory.observations.length, 7 * 11);
  const byMeasure = queryIstatPovertaAssoluta({ measure: "incid_povass_fam" });
  assert.ok(byMeasure.observations.every((row) => row.measure === "INCID_POVASS_FAM"));
  assert.equal(byMeasure.observations.length, 8 * 11);
});

test("la query rifiuta codici e anni fuori perimetro", () => {
  assert.throws(() => queryIstatPovertaAssoluta({ year: 2013 }), /periodo coperto/);
  assert.throws(() => queryIstatPovertaAssoluta({ year: 2025 }), /periodo coperto/);
  // Nessun dettaglio regionale esiste per la povertà assoluta.
  assert.throws(() => queryIstatPovertaAssoluta({ territory: "ITC1" }), /ripartizioni/);
  assert.throws(() => queryIstatPovertaAssoluta({ measure: "INCID_POVREL_FAM" }), /Misura non riconosciuta/);
});

test("la fonte resta senza licenza dichiarata", () => {
  assert.equal(istatPovertaMetadata.source.licenseId, "not-declared");
  assert.equal(istatPovertaMetadata.semantics.provenance.license, "not-declared");
});

test("i caveat dicono che non è spesa pubblica", () => {
  const joined = istatPovertaData.caveats.join(" ");
  assert.match(joined, /Non è spesa pubblica/);
  assert.match(joined, /doppio conteggio/);
  assert.match(joined, /livello comunale/);
});
