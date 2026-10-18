import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  getOccupazioneIndex,
  getOccupazioneInstitutionSummary,
  loadInstitutionStaffView,
  resolveInstitutionCodeFromDenominazione,
  sumPermanentFromCells,
  sumFlexibleFromCells,
} = await import("../src/lib/rgs-conto-annuale-occupazione.ts");

const { selectIntegratedDataset } = await import("../src/lib/integrated-public-view.ts");

async function verifyInstitutionSeriesAgainstCorpus(code) {
  const summary = getOccupazioneInstitutionSummary(code);
  if (!summary) throw new Error(`Istituzione ${code} assente dall'indice.`);
  const result = await selectIntegratedDataset({
    datasetId: "rgs-conto-annuale-occupazione-ente-2010-2024",
    equals: { "Codice istituzione": code },
    limit: 100,
  });
  assert.equal(result.pagination.exhausted, true);
  const corpusPoints = result.rows
    .map((row) => {
      const year = Number(row.cells.Anno);
      return {
        year,
        name: row.cells.Ente ?? "",
        permanent: sumPermanentFromCells(row.cells, year),
        flexible: sumFlexibleFromCells(row.cells, year),
        sourceUrl: row.cells["URL fonte"] ?? "",
      };
    })
    .sort((a, b) => a.year - b.year);
  const indexPoints = summary.series.map(([year, name, permanent, flexible, sourceUrl]) => ({
    year,
    name,
    permanent,
    flexible,
    sourceUrl,
  }));
  assert.deepEqual(indexPoints, corpusPoints);
}

const SPOT_CHECKS = [
  { code: "6144", label: "Roma Capitale", baselinePermanent: 25523, latestPermanent: 22125 },
  { code: "8659", label: "Ministero della Difesa", baselinePermanent: 323_293, latestPermanent: 290_361 },
  { code: "3", label: "small ente", baselinePermanent: 1, latestPermanent: 3 },
];

test("occupazione index reconciles with corpus metadata", () => {
  const index = getOccupazioneIndex();
  const meta = JSON.parse(
    readFileSync("src/data/generated/rgs-conto-annuale-occupazione-ente-index/meta.json", "utf8"),
  );
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.searchableCount, index.institutions.length);
  assert.equal(meta.institutionCount, index.searchableCount);
  assert.equal(index.nationalSeries.length, 15);
  assert.equal(index.nationalSeries.at(-1).year, 2024);
});

test("resolve institution codes for comune and ministero names", () => {
  assert.equal(resolveInstitutionCodeFromDenominazione("Roma Capitale"), "6144");
  assert.equal(resolveInstitutionCodeFromDenominazione("MINISTERO DELLA DIFESA"), "8659");
  assert.equal(resolveInstitutionCodeFromDenominazione("COMUNE DI LIVO"), null);
});

for (const spot of SPOT_CHECKS) {
  test(`institution ${spot.code} (${spot.label}) matches integrated corpus`, async () => {
    const summary = getOccupazioneInstitutionSummary(spot.code);
    assert.ok(summary, "summary");
    const view = await loadInstitutionStaffView(spot.code);
    assert.ok(view);
    assert.equal(view.summary.latestPermanent, summary.permanentLatest);
    if (summary.permanentBaseline !== null) {
      assert.equal(view.summary.baselinePermanent, summary.permanentBaseline);
    }
    const baseline = view.points.find((point) => point.year === 2010);
    const latest = view.points.find((point) => point.year === 2024);
    assert.ok(latest, "2024 point");
    assert.equal(latest.permanent, spot.latestPermanent);
    if (baseline) assert.equal(baseline.permanent, spot.baselinePermanent);
    await verifyInstitutionSeriesAgainstCorpus(spot.code);
  });
}

test("measure helpers parse integer and decimal years", () => {
  const integerCells = {
    "Numero Dipendenti Donne Tempo Pieno": "12",
    "Numero Dipendenti Uomini Tempo Pieno": "5",
    "Numero Dipendenti Donne Part time Inf. 50%": "0",
    "Numero Dipendenti Uomini Part time Inf. 50%": "0",
    "Numero Dipendenti Donne Part time Sup. 50%": "2",
    "Numero Dipendenti Uomini Part time Sup. 50%": "0",
    "Numero Dipendenti Donne Tempo Determinato": "0",
    "Numero Dipendenti Uomini Tempo Determinato": "0",
    "Numero Dipendenti Donne Formazione Lavoro": "0",
    "Numero Dipendenti Uomini Formazione Lavoro": "0",
    "Numero Dipendenti Donne Lavoro Interinale": "0",
    "Numero Dipendenti Uomini Lavoro Interinale": "0",
    "Numero Dipendenti Donne Lavoro Socialmente Utile": "0",
    "Numero Dipendenti Uomini Lavoro Socialmente Utile": "0",
  };
  assert.equal(sumPermanentFromCells(integerCells, 2010), 19);
  assert.equal(sumFlexibleFromCells(integerCells, 2010), 0);
  const decimalCells = Object.fromEntries(
    Object.entries(integerCells).map(([key, value]) => [key, value === "0" ? "0.00" : `${value}.00`]),
  );
  assert.equal(sumPermanentFromCells(decimalCells, 2024), 19);
});
