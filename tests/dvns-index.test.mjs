import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { assertIndexSnapshot, explainEntry, functionHighlights, describeGroup, distribution, parseRankingQuery, queryRanking, RANKING_PAGE_SIZE } =
  await import("../src/lib/dvns-index.ts");

const columns = ["istat", "taxCode", "name", "region", "population", "status", "score", "band", "bandStability", "rank", "peerRank", "peerRanked", "group",
  "pResa", "pSovraspesa", "pInvestire", "pAppalti", "spending2022", "services2022", "spending2021", "services2021",
  "investmentShare", "withoutTenderShare", "procedures", "topSupplierShare", "awards", "functionResa"];
const functions = ["amministrazione", "istruzione", "polizia", "rifiuti", "sociale-asili", "viabilita"];
const rules = { weights: { resa: 0.5, sovraspesa: 0.15, investire: 0.2, appalti: 0.15 }, procurementThresholdEuro: 40000 };

function row(istat, overrides = {}) {
  const base = {
    istat, taxCode: "0001", name: "Comune", region: "08", population: 5000, status: "ranked", score: 60, band: "A", bandStability: 1,
    rank: 1, peerRank: 1, peerRanked: 2, group: 0, pResa: 80, pSovraspesa: 60, pInvestire: 40, pAppalti: 20,
    spending2022: 31.9, services2022: 65.1, spending2021: 30, services2021: 60,
    investmentShare: 33.8, withoutTenderShare: 19.4, procedures: 12, topSupplierShare: 13.5, awards: 40, functionResa: [10, 20, 30, -5, -20, 5],
    ...overrides,
  };
  return columns.map((column) => base[column]);
}

function snapshot(rows) {
  return {
    schemaVersion: 1, datasetId: "dvns-index", version: "2026.1", rules, functions, columns,
    rows, groups: [{ id: 0, stage: "big", values: [], size: 36 }],
    summary: { ranked: rows.filter((item) => item[5] === "ranked").length },
    sources: [{ id: "opencivitas", label: "OpenCivitas", owner: "MEF", url: "https://www.opencivitas.it/", license: "CC BY 4.0" }],
  };
}

test("refuses a ranked Comune without position and a gap in the ranking", () => {
  assert.throws(() => assertIndexSnapshot(snapshot([row("037006", { rank: null })])), /posizione/);
  assert.throws(() => assertIndexSnapshot(snapshot([row("037006", { rank: 2 })])), /consecutive/);
  assert.throws(() => assertIndexSnapshot(snapshot([row("037006", { status: "partial" })])), /fuori classifica/);
});

test("the explanation adds up to the score and names the data behind each pillar", () => {
  const parsed = assertIndexSnapshot(snapshot([row("037006")]));
  const parts = explainEntry(parsed.entries[0], rules);
  assert.equal(parts.length, 4);
  assert.equal(Math.round(parts.reduce((sum, part) => sum + part.points, 0)), Math.round(80 * 0.5 + 60 * 0.15 + 40 * 0.2 + 20 * 0.15));
  assert.match(parts[0].facts[0], /offre il 65,1% di servizi in più .* spende il 31,9% in più rispetto al fabbisogno/u);
  // Spending more to deliver more services is not called unjustified.
  assert.match(parts[1].facts[0], /nessuna penalità/u);
  assert.match(parts[3].facts[0], /Delle sue 12 procedure da almeno 40\.000 € pubblicate nel 2025, il 19,4% del valore/u);
  assert.match(parts[3].facts.at(-1), /mediana nazionale/u);
  assert.equal(parts[0].verdict, "Meglio dell'80% dei Comuni simili");
  assert.equal(parts[1].verdict, "Nessuna spesa non giustificata, come la maggior parte dei Comuni simili");
  assert.equal(parts[2].verdict, "Meglio del 40% dei Comuni simili");
});

test("function highlights, group labels and distribution", () => {
  const parsed = assertIndexSnapshot(snapshot([row("037006")]));
  assert.deepEqual(functionHighlights(parsed.entries[0], functions), { best: ["polizia locale", "istruzione"], worst: ["sociale e asili nido", "rifiuti"] });
  assert.equal(describeGroup({ stage: "big", values: [], size: 36 }), "le città con almeno 100.000 abitanti");
  assert.equal(describeGroup({ stage: "a", values: [1, 1, 3, 3, false, false], size: 40 }), "i Comuni da 1.000 a 4.999 abitanti, con 10-50 km² di superficie, in collina interna e in zona rurale, non costieri");
  const bins = distribution(parsed.entries);
  assert.equal(bins.reduce((sum, value) => sum + value, 0), 1);
  assert.equal(bins[30], 1);
});

test("ranking filters accept only closed lists and paginate", () => {
  assert.deepEqual(parseRankingQuery({ regione: "99", dimensione: "9", fascia: "z", pagina: "-1" }), { region: null, size: null, band: null, page: 1 });
  assert.deepEqual(parseRankingQuery({ regione: "08", dimensione: "5", fascia: "a", pagina: "2" }), { region: "08", size: 5, band: "A", page: 2 });
  const rows = Array.from({ length: 120 }, (_, index) => row(String(100000 + index), { rank: index + 1, band: index < 60 ? "A" : "B" }));
  const parsed = assertIndexSnapshot(snapshot(rows));
  const page = queryRanking(parsed.entries, { region: null, size: null, band: "B", page: 9 });
  assert.equal(page.total, 60);
  assert.equal(page.page, 2);
  assert.equal(page.rows.length, 60 - RANKING_PAGE_SIZE);
  assert.equal(page.rows[0].rank, 111);
});

test("the generated payload, when present, satisfies the contract", { skip: !existsSync("src/data/generated/dvns-index.json") }, () => {
  const parsed = assertIndexSnapshot(JSON.parse(readFileSync("src/data/generated/dvns-index.json", "utf8")));
  assert.ok(parsed.summary.ranked > 4000);
  const bologna = parsed.entries.find((entry) => entry.istat === "037006");
  assert.equal(bologna.band, "A");
});

test("every ranked Comune sits in exactly one dot, at most 10 per dot", async () => {
  const { dotLayout, locateDot } = await import("../src/lib/dvns-index.ts");
  const rows = Array.from({ length: 23 }, (_, index) => row(String(200000 + index), { rank: index + 1, score: 61 }));
  rows.push(row("300000", { status: "partial", band: null, rank: null, score: 61 }));
  const parsed = assertIndexSnapshot(snapshot(rows));
  const layout = dotLayout(parsed.entries);
  assert.deepEqual(layout[30].map((dot) => dot.length), [10, 10, 3]);
  assert.equal(layout.flat(2).length, 23);
  assert.deepEqual(locateDot(layout, "200015"), { column: 30, row: 1 });
  assert.equal(locateDot(layout, "300000"), null);
});
