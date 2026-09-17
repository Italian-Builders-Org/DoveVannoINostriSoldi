import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { istatCofogData, istatCofogMetadata, queryIstatCofog } = await import(
  "../src/lib/istat-cofog-snapshot.ts"
);
const { validateIstatCofogBundle } = await import("../src/lib/data/istat-cofog-contract.ts");

const DIVISIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((n) => `G${String(n).padStart(3, "0")}`);

test("lo snapshot dichiara copertura piena e la mantiene", () => {
  const { expectedCells, observedCells } = istatCofogData.coverage;
  assert.equal(observedCells, expectedCells);
  assert.equal(istatCofogData.observations.length, expectedCells);
  const cells = new Set(istatCofogData.observations.map((r) => `${r.area}/${r.year}/${r.function}`));
  assert.equal(cells.size, expectedCells, "celle duplicate");
});

test("misura, valutazione ed edizione restano fissate", () => {
  assert.equal(istatCofogData.measure.code, "P3_D_W0_S13");
  assert.equal(istatCofogData.measure.valuation, "V");
  assert.match(istatCofogData.measure.edition, /^\d{4}M\d{1,2}$/);
  // L'edizione nella provenance deve coincidere col dato: è così che una
  // revisione non si traveste da serie storica.
  assert.equal(istatCofogMetadata.semantics.provenance.publicationEdition, istatCofogData.measure.edition);
});

test("i totali pubblicati restano quelli della fonte", () => {
  const cells = new Map(istatCofogData.observations.map((r) => [`${r.area}/${r.year}/${r.function}`, r.amountCents]));
  let gaps = 0;
  let worst = 0;
  for (const area of istatCofogData.areas.map((a) => a.code)) {
    for (let year = istatCofogData.period.from; year <= istatCofogData.period.to; year += 1) {
      const total = cells.get(`${area}/${year}/G`);
      const sum = DIVISIONS.reduce((acc, code) => acc + cells.get(`${area}/${year}/${code}`), 0);
      const gap = Math.abs(total - sum);
      worst = Math.max(worst, gap);
      if (gap > 0) gaps += 1;
    }
  }
  assert.ok(worst <= istatCofogData.reconciliation.toleranceCents, "scarto oltre la tolleranza");
  // Se avessimo ricalcolato i totali ogni scarto sarebbe zero.
  assert.ok(gaps > 0, "i totali della fonte sono stati sostituiti da somme nostre");
});

test("le aree composite restano marcate per non essere sommate", () => {
  const kinds = new Map(istatCofogData.areas.map((a) => [a.code, a.kind]));
  for (const code of ["ITCD", "ITCDE", "ITFG", "ITDA"]) assert.equal(kinds.get(code), "composite", code);
  assert.equal(kinds.get("IT"), "country");
  assert.equal(kinds.get("ITZ"), "extra-regio");
  assert.equal([...kinds.values()].filter((k) => k === "region").length, 21);
});

test("i caveat dicono che non è la spesa pubblica totale", () => {
  const joined = istatCofogData.caveats.join(" ");
  assert.match(joined, /NON la spesa pubblica totale|non è la spesa pubblica totale/);
  assert.match(joined, /gov_10a_exp/);
  assert.match(joined, /doppio conteggio/);
  assert.match(joined, /revisione/);
  assert.match(joined, /non misura efficienza|non misura.*qualità/);
});

test("la licenza non viene inferita", () => {
  assert.equal(istatCofogMetadata.source.licenseId, "not-declared");
  assert.equal(istatCofogMetadata.semantics.provenance.license, "not-declared");
});

test("la query filtra per territorio, anno e funzione", () => {
  const it2023 = queryIstatCofog({ area: "IT", year: 2023 });
  assert.equal(it2023.observations.length, 11);
  assert.ok(it2023.observations.every((r) => r.area === "IT" && r.year === 2023));

  const sanita = queryIstatCofog({ area: "itf3", function: "g070" });
  assert.equal(sanita.observations.length, 29, "ventinove anni di consumi finali sanitari in Campania");
  assert.ok(sanita.observations.every((r) => r.function === "G070" && r.area === "ITF3"));
});

test("la query rifiuta codici e anni fuori dallo snapshot", () => {
  assert.throws(() => queryIstatCofog({ area: "ZZ" }), /Area non riconosciuta/);
  assert.throws(() => queryIstatCofog({ function: "G110" }), /Funzione COFOG non riconosciuta/);
  assert.throws(() => queryIstatCofog({ year: 1994 }), /Anno fuori dal periodo/);
  assert.throws(() => queryIstatCofog({ year: 2024 }), /Anno fuori dal periodo/);
});

test("il contratto boccia una copertura incompleta", () => {
  const broken = structuredClone(istatCofogData);
  broken.observations.pop();
  assert.throws(() => validateIstatCofogBundle(broken, istatCofogMetadata), /copertura|osservazioni/i);
});

test("il contratto boccia una partizione rotta", () => {
  const broken = structuredClone(istatCofogData);
  const total = broken.observations.find((r) => r.area === "IT" && r.function === "G");
  total.amountCents += broken.reconciliation.toleranceCents * 100;
  assert.throws(() => validateIstatCofogBundle(broken, istatCofogMetadata), /si scosta/i);
});

test("il contratto boccia un'edizione incoerente fra dato e provenance", () => {
  const broken = structuredClone(istatCofogMetadata);
  broken.semantics.provenance.publicationEdition = "2024M1";
  assert.throws(() => validateIstatCofogBundle(istatCofogData, broken), /edizione/i);
});

test("il contratto boccia una provenienza non ufficiale", () => {
  const broken = structuredClone(istatCofogMetadata);
  // Passerebbe un controllo di prefisso senza la barra finale.
  broken.source.landingUrl = "https://esploradati.istat.it.example.org/databrowser/";
  assert.throws(() => validateIstatCofogBundle(istatCofogData, broken));
});
