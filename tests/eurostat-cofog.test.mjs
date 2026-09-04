import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { eurostatCofogData, eurostatCofogMetadata, queryEurostatCofog } = await import(
  "../src/lib/eurostat-cofog-snapshot.ts"
);
const { validateEurostatCofogBundle } = await import("../src/lib/data/eurostat-cofog-contract.ts");

const DIVISIONS = Array.from({ length: 10 }, (_, index) => `GF${String(index + 1).padStart(2, "0")}`);

test("lo snapshot COFOG dichiara copertura piena e la mantiene", () => {
  const { expectedCells, observedCells } = eurostatCofogData.coverage;
  assert.equal(observedCells, expectedCells);
  assert.equal(eurostatCofogData.observations.length, expectedCells);
  const cells = new Set(
    eurostatCofogData.observations.map((row) => `${row.geo}/${row.year}/${row.function}`),
  );
  assert.equal(cells.size, expectedCells, "celle duplicate nello snapshot");
});

test("il totale pubblicato resta quello della fonte, non una ricostruzione", () => {
  const byCell = new Map(
    eurostatCofogData.observations.map((row) => [`${row.geo}/${row.year}/${row.function}`, row]),
  );
  let gaps = 0;
  let worst = 0;
  for (const geography of eurostatCofogData.geographies) {
    for (let year = eurostatCofogData.period.from; year <= eurostatCofogData.period.to; year += 1) {
      const total = byCell.get(`${geography.code}/${year}/TOTAL`);
      const sum = DIVISIONS.reduce(
        (acc, code) => acc + byCell.get(`${geography.code}/${year}/${code}`).amountCents,
        0,
      );
      const gap = Math.abs(total.amountCents - sum);
      worst = Math.max(worst, gap);
      if (gap > 0) gaps += 1;
    }
  }
  assert.ok(worst <= eurostatCofogData.reconciliation.toleranceCents, "scarto oltre l'arrotondamento");
  assert.equal(worst, eurostatCofogData.reconciliation.maxGapCents);
  // Se avessimo ricalcolato il totale sommando le divisioni ogni scarto sarebbe
  // zero: la loro presenza prova che pubblichiamo la cifra della fonte.
  assert.ok(gaps > 0, "il totale della fonte è stato sostituito da una somma nostra");
});

test("i flag della fonte restano sull'osservazione", () => {
  const flagged = eurostatCofogData.observations.filter((row) => row.flag);
  assert.equal(flagged.length, eurostatCofogData.coverage.flagged);
  assert.ok(flagged.length > 0);
  assert.ok(flagged.some((row) => row.flag === "b"), "interruzioni di serie non marcate");
  assert.ok(flagged.every((row) => row.flag in eurostatCofogData.flags));
});

test("gli aggregati europei restano distinti dagli Stati membri", () => {
  const aggregates = eurostatCofogData.geographies.filter((geography) => geography.kind === "aggregate");
  const countries = eurostatCofogData.geographies.filter((geography) => geography.kind === "country");
  assert.ok(aggregates.some((geography) => geography.code === "EU27_2020"));
  assert.ok(countries.some((geography) => geography.code === "IT"));
  // Contengono già gli Stati membri: la distinzione è nel dato perché sommarli
  // sarebbe un doppio conteggio.
  assert.ok(aggregates.length > 0 && countries.length > aggregates.length);
});

test("gli importi sono interi e la semantica è pubblicata", () => {
  for (const row of eurostatCofogData.observations) {
    assert.ok(Number.isSafeInteger(row.amountCents), `importo non intero su ${row.geo}/${row.year}`);
    assert.ok(Number.isSafeInteger(row.shareOfGdpHundredths));
  }
  const { semantics } = eurostatCofogMetadata;
  assert.equal(semantics.soldi.unit, "centesimi di euro");
  assert.match(semantics.soldi.nature, /competenza economica/i);
  assert.equal(semantics.periodo.referencePeriod, "2014-2024");
  assert.equal(semantics.provenance.license, "CC-BY-4.0");
  assert.notEqual(semantics.provenance.publicationDate, semantics.provenance.acquisitionDate);
});

test("i caveat dicono cosa il dato non misura", () => {
  const caveats = eurostatCofogData.caveats.join(" ");
  assert.match(caveats, /non sono pagamenti di cassa/i);
  assert.match(caveats, /non misura efficienza/i);
  assert.match(caveats, /interruzione della serie/i);
});

test("la query filtra per paese, anno e funzione", () => {
  const italy2024 = queryEurostatCofog({ geo: "IT", year: 2024 });
  assert.equal(italy2024.observations.length, 11);
  assert.ok(italy2024.observations.every((row) => row.geo === "IT" && row.year === 2024));

  const health = queryEurostatCofog({ geo: "it", function: "gf07" });
  assert.equal(health.observations.length, 11, "undici anni di spesa sanitaria");
  assert.ok(health.observations.every((row) => row.function === "GF07"));
});

test("la query rifiuta codici e anni fuori dallo snapshot", () => {
  assert.throws(() => queryEurostatCofog({ geo: "XX" }), /Geografia non riconosciuta/);
  assert.throws(() => queryEurostatCofog({ function: "GF11" }), /Funzione COFOG non riconosciuta/);
  assert.throws(() => queryEurostatCofog({ year: 2013 }), /Anno fuori dal periodo/);
  assert.throws(() => queryEurostatCofog({ year: 2025 }), /Anno fuori dal periodo/);
});

test("il contratto boccia una copertura incompleta", () => {
  const broken = structuredClone(eurostatCofogData);
  broken.observations.pop();
  assert.throws(
    () => validateEurostatCofogBundle(broken, eurostatCofogMetadata),
    /osservazioni e copertura|copertura incompleta/i,
  );
});

test("il contratto boccia uno scarto oltre l'arrotondamento", () => {
  const broken = structuredClone(eurostatCofogData);
  const total = broken.observations.find((row) => row.function === "TOTAL");
  total.amountCents += broken.reconciliation.toleranceCents * 100;
  assert.throws(() => validateEurostatCofogBundle(broken, eurostatCofogMetadata), /si scosta/i);
});

test("il contratto boccia una provenienza non ufficiale", () => {
  const broken = structuredClone(eurostatCofogMetadata);
  // Passerebbe un controllo di prefisso senza la barra finale.
  broken.source.landingUrl = "https://ec.europa.eu/eurostat.example.org/table";
  assert.throws(() => validateEurostatCofogBundle(eurostatCofogData, broken));
});
