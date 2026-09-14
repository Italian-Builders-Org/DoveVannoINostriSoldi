import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { eurostatGovMainData, eurostatGovMainMetadata, queryEurostatGovMain } = await import(
  "../src/lib/eurostat-gov-main-snapshot.ts"
);
const {
  EUROSTAT_GOV_MAIN_EXPENDITURE_COMPONENTS,
  EUROSTAT_GOV_MAIN_REVENUE_COMPONENTS,
  validateEurostatGovMainBundle,
} = await import("../src/lib/data/eurostat-gov-main-contract.ts");

const publicDebt = JSON.parse(
  readFileSync(new URL("../src/data/generated/public-debt.json", import.meta.url), "utf8"),
);

function cell(data, year, code) {
  return data.observations.find((row) => row.year === year && row.naItem === code);
}

test("lo snapshot dei conti PA dichiara copertura piena e la mantiene", () => {
  const { expectedCells, observedCells } = eurostatGovMainData.coverage;
  assert.equal(expectedCells, 24 * 31);
  assert.equal(observedCells, expectedCells);
  const cells = new Set(eurostatGovMainData.observations.map((row) => `${row.year}/${row.naItem}`));
  assert.equal(cells.size, expectedCells, "celle duplicate nello snapshot");
});

test("i totali restano quelli della fonte e riconciliano entro l'arrotondamento", () => {
  const { toleranceCents } = eurostatGovMainData.reconciliation;
  let worst = 0;
  for (let year = 1995; year <= 2025; year += 1) {
    const sum = (codes) => codes.reduce((total, code) => total + cell(eurostatGovMainData, year, code).amountCents, 0);
    const tr = cell(eurostatGovMainData, year, "TR").amountCents;
    const te = cell(eurostatGovMainData, year, "TE").amountCents;
    const b9 = cell(eurostatGovMainData, year, "B9").amountCents;
    for (const gap of [
      Math.abs(tr - sum(EUROSTAT_GOV_MAIN_REVENUE_COMPONENTS)),
      Math.abs(te - sum(EUROSTAT_GOV_MAIN_EXPENDITURE_COMPONENTS)),
      Math.abs(tr - te - b9),
    ]) {
      assert.ok(gap <= toleranceCents, `${year}: scarto oltre l'arrotondamento`);
      worst = Math.max(worst, gap);
    }
  }
  // Se i totali fossero ricostruiti sommando le componenti ogni scarto sarebbe zero.
  assert.ok(worst > 0, "i totali della fonte sono stati sostituiti da una somma nostra");
});

test("interessi e spesa totale coincidono al centesimo con lo snapshot del debito", () => {
  const shared = publicDebt.annualInterest.history;
  assert.ok(shared.length > 0);
  for (const point of shared) {
    assert.equal(cell(eurostatGovMainData, point.year, "D41PAY").amountCents, point.interestExpenseCents, `D41PAY ${point.year}`);
    assert.equal(cell(eurostatGovMainData, point.year, "TE").amountCents, point.totalGovernmentExpenditureCents, `TE ${point.year}`);
  }
});

test("gli importi sono interi, il segno è ammesso solo dove il SEC lo prevede, la semantica è pubblicata", () => {
  for (const row of eurostatGovMainData.observations) {
    assert.ok(Number.isSafeInteger(row.amountCents), `importo non intero su ${row.year}/${row.naItem}`);
    assert.ok(Number.isSafeInteger(row.shareOfGdpHundredths));
    if (!["B9", "NP", "P5"].includes(row.naItem)) assert.ok(row.amountCents >= 0, `${row.year}/${row.naItem}`);
  }
  const { semantics } = eurostatGovMainMetadata;
  assert.equal(semantics.soldi.unit, "centesimi di euro");
  assert.match(semantics.soldi.nature, /competenza economica/i);
  assert.equal(semantics.periodo.referencePeriod, "1995-2025");
  assert.equal(semantics.provenance.license, "CC-BY-4.0");
  assert.notEqual(semantics.provenance.publicationDate, semantics.provenance.acquisitionDate);
});

test("i caveat dicono cosa il dato non misura", () => {
  const caveats = eurostatGovMainData.caveats.join(" ");
  assert.match(caveats, /non sono incassi né pagamenti di cassa/i);
  assert.match(caveats, /non misurano efficienza/i);
  assert.match(caveats, /D41PAY/);
});

test("la query filtra per anno e voce e rifiuta codici e anni fuori dallo snapshot", () => {
  const year = queryEurostatGovMain({ year: 2025 });
  assert.equal(year.observations.length, 24);
  assert.ok(year.observations.every((row) => row.year === 2025));
  const interest = queryEurostatGovMain({ naItem: "d41pay" });
  assert.equal(interest.observations.length, 31);
  assert.deepEqual(interest.items.map((item) => item.code), ["D41PAY"]);
  assert.throws(() => queryEurostatGovMain({ naItem: "D8PAY" }), /Voce non pubblicata/);
  assert.throws(() => queryEurostatGovMain({ year: 1994 }), /Anno fuori dal periodo/);
  assert.throws(() => queryEurostatGovMain({ year: 2026 }), /Anno fuori dal periodo/);
});

test("il contratto boccia copertura incompleta, identità rotta, negativi e provenienza non ufficiale", () => {
  const incomplete = structuredClone(eurostatGovMainData);
  incomplete.observations.pop();
  assert.throws(() => validateEurostatGovMainBundle(incomplete, eurostatGovMainMetadata));

  const identity = structuredClone(eurostatGovMainData);
  cell(identity, 2025, "TR").amountCents += identity.reconciliation.toleranceCents * 100;
  assert.throws(() => validateEurostatGovMainBundle(identity, eurostatGovMainMetadata), /oltre l'arrotondamento/i);

  const negative = structuredClone(eurostatGovMainData);
  cell(negative, 2025, "D1PAY").amountCents = -1;
  assert.throws(() => validateEurostatGovMainBundle(negative, eurostatGovMainMetadata), /negativo/i);

  const memo = structuredClone(eurostatGovMainData);
  cell(memo, 2025, "D41PAY").amountCents = cell(memo, 2025, "D4PAY").amountCents + 1;
  assert.throws(() => validateEurostatGovMainBundle(memo, eurostatGovMainMetadata), /di cui/i);

  const provenance = structuredClone(eurostatGovMainMetadata);
  provenance.source.landingUrl = "https://ec.europa.eu/eurostat.example.org/table";
  assert.throws(() => validateEurostatGovMainBundle(eurostatGovMainData, provenance));
});
