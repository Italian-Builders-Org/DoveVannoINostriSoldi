import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { assertIndexSnapshot, explainEntry, functionHighlights, describeGroup, distribution, parseRankingQuery, queryRanking, RANKING_PAGE_SIZE } =
  await import("../src/lib/dvns-index.ts");

const columns = ["istat", "taxCode", "name", "region", "population", "status", "score", "band", "bandStability", "rank", "rankLow", "rankHigh", "peerRank", "peerRanked", "group",
  "pResa", "pSovraspesa", "pInvestire", "pAppalti", "pPuntualita", "pRisultati", "spending2022", "services2022", "spending2021", "services2021",
  "investmentShare", "withoutTenderShare", "procedures", "topSupplierShare", "awards", "functionResa",
  "delay2024", "delay2025", "rd2022", "rd2023", "capitalPerCapita", "underspendWithoutCredit", "volatile", "appaltiNeutral"];
const functions = ["amministrazione", "istruzione", "polizia", "rifiuti", "sociale-asili", "viabilita"];
const rules = {
  weights: { resa: 0.4, sovraspesa: 0.1, investire: 0.15, appalti: 0.1, puntualita: 0.15, risultati: 0.1 },
  procurementThresholdEuro: 40000, volatileServicesPoints: 100, concentrationExcludedCpvDivisions: ["90", "65", "09"],
};

function row(istat, overrides = {}) {
  const base = {
    istat, taxCode: "0001", name: "Comune", region: "08", population: 5000, status: "ranked", score: 60, band: "A", bandStability: 1,
    rank: 1, rankLow: 1, rankHigh: 3, peerRank: 1, peerRanked: 2, group: 0, pResa: 80, pSovraspesa: 60, pInvestire: 40, pAppalti: 20, pPuntualita: 70, pRisultati: 90,
    spending2022: 31.9, services2022: 65.1, spending2021: 30, services2021: 60,
    investmentShare: 33.8, withoutTenderShare: 19.4, procedures: 12, topSupplierShare: 13.5, awards: 40, functionResa: [10, 20, 30, -5, -20, 5],
    delay2024: 12.4, delay2025: -3, rd2022: 71.2, rd2023: 74.8, capitalPerCapita: 412.6, underspendWithoutCredit: false, volatile: false, appaltiNeutral: false,
    ...overrides,
  };
  return columns.map((column) => base[column]);
}

function snapshot(rows) {
  return {
    schemaVersion: 1, datasetId: "dvns-index", version: "2026.1", rules, functions, columns,
    rows, groups: [{ id: 0, stage: "big", values: [], size: 36 }],
    summary: {
      ranked: rows.filter((item) => item[5] === "ranked").length,
      validation: { listed: 2, matched: 2, ranked: 1, medianScore: 30, bands: { A: 0, B: 0, C: 0, D: 0, E: 1 } },
    },
    sources: [{ id: "opencivitas", label: "OpenCivitas", owner: "MEF", url: "https://www.opencivitas.it/", license: "CC BY 4.0" }],
  };
}

test("refuses a ranked Comune without position and a gap in the ranking", () => {
  assert.throws(() => assertIndexSnapshot(snapshot([row("037006", { rank: null })])), /posizione/);
  assert.throws(() => assertIndexSnapshot(snapshot([row("037006", { rank: 2 })])), /consecutive/);
  assert.throws(() => assertIndexSnapshot(snapshot([row("037006", { status: "partial" })])), /fuori classifica/);
});

test("too few contracts: the procurement pillar is the middle value and the page says so", () => {
  const neutral = { pAppalti: 50, withoutTenderShare: null, procedures: null, topSupplierShare: null, awards: null, appaltiNeutral: true };
  const parsed = assertIndexSnapshot(snapshot([row("001001", neutral)]));
  const appalti = explainEntry(parsed.entries[0], rules)[3];
  assert.equal(appalti.percentile, 50);
  assert.match(appalti.facts[0], /troppo poche per giudicare: il pilastro vale 50/u);
  // A neutral flag with any other value is a corrupted snapshot.
  assert.throws(() => assertIndexSnapshot(snapshot([row("001001", { ...neutral, pAppalti: 70 })])), /appalti neutri/u);
});

test("refuses an external check whose bands do not add up", () => {
  const bad = snapshot([row("037006")]);
  bad.summary.validation.bands.E = 3;
  assert.throws(() => assertIndexSnapshot(bad), /dissesti incoerente/u);
});

test("refuses flags that are not booleans", () => {
  assert.throws(() => assertIndexSnapshot(snapshot([row("037006", { volatile: 1 })])), /volatile non è vero\/falso/u);
});

test("rank range and unstable OpenCivitas services are reported, not hidden", async () => {
  const { rankRange, servicesVolatility, statusLabel } = await import("../src/lib/dvns-index.ts");
  const craco = { status: "partial", band: null, rank: null, rankLow: null, rankHigh: null, peerRank: null, peerRanked: null, score: 48, services2021: 373.2, services2022: 49.8, volatile: true };
  const parsed = assertIndexSnapshot(snapshot([row("037006"), row("077007", craco)]));
  assert.equal(rankRange(parsed.entries[0]), "tra 1° e 3°");
  assert.equal(servicesVolatility(parsed.entries[0]), null);
  // Craco: +373% services in 2021, +50% in 2022. The ETL flag decides, the page only reports the jump.
  assert.equal(servicesVolatility(parsed.entries[1]), 323);
  assert.match(statusLabel("partial", true), /servizi dichiarati .* non è in classifica/u);
  assert.match(statusLabel("partial"), /manca almeno un pilastro/u);
});

test("the explanation adds up to the score and names the data behind each pillar", () => {
  const parsed = assertIndexSnapshot(snapshot([row("037006")]));
  const parts = explainEntry(parsed.entries[0], rules);
  assert.equal(parts.length, 6);
  assert.equal(Math.round(parts.reduce((sum, part) => sum + part.points, 0) * 10), Math.round((80 * 0.4 + 60 * 0.1 + 40 * 0.15 + 20 * 0.1 + 70 * 0.15 + 90 * 0.1) * 10));
  assert.match(parts[0].facts[0], /offre il 65,1% di servizi in più .* spende il 31,9% in più rispetto al fabbisogno/u);
  // Spending more to deliver more services is not called unjustified.
  assert.match(parts[1].facts[0], /nessuna penalità/u);
  assert.match(parts[3].facts[0], /Delle sue 12 procedure da almeno 40\.000 € pubblicate nel 2025, il 19,4% del valore/u);
  assert.match(parts[3].facts.at(-1), /mediana nazionale/u);
  assert.equal(parts[0].verdict, "Meglio dell'80% dei Comuni simili");
  assert.equal(parts[1].verdict, "Nessuna spesa non giustificata, come la maggior parte dei Comuni simili");
  assert.equal(parts[2].verdict, "Meglio del 40% dei Comuni simili");
  assert.match(parts[2].facts[1], /413 € di investimenti per abitante/u);
  assert.match(parts[4].facts[0], /12 giorni oltre la scadenza nel 2024, 3 giorni prima della scadenza nel 2025/u);
  assert.match(parts[5].facts[0], /71,2% nel 2022, 74,8% nel 2023/u);
  // Rifiuti, energia e acqua are out of the supplier concentration: the page must say so.
  assert.match(parts[3].facts[1], /Rifiuti, energia e acqua sono esclusi/u);
});

test("low spending paid late earns no efficiency credit, and the page says why", () => {
  const parsed = assertIndexSnapshot(snapshot([row("071004", { spending2022: -25, services2022: 3, underspendWithoutCredit: true, delay2024: 53, delay2025: 35 })]));
  const [resa] = explainEntry(parsed.entries[0], rules);
  assert.match(resa.facts.join(" "), /paga i fornitori in ritardo: la spesa bassa .* non conta come efficienza/u);
  // The balance shown is the one used in the score: services only, not services minus the negative spending.
  assert.match(resa.facts[1], /^Saldo usato nel calcolo: \+3 punti/u);
});

test("missing payment and waste data are named, not shown as zero", () => {
  const parsed = assertIndexSnapshot(snapshot([row("037006", { status: "partial", rank: null, rankLow: null, rankHigh: null, band: null, peerRank: null, peerRanked: null, pPuntualita: null, pRisultati: null, delay2024: null, delay2025: null, rd2022: null, rd2023: null })]));
  const parts = explainEntry(parsed.entries[0], rules);
  assert.equal(parts[4].points, null);
  assert.match(parts[4].facts[0], /non riporta tempi di pagamento/u);
  assert.match(parts[5].facts[0], /ISPRA non pubblica/u);
});

test("regional rank and the region's share of the differences", async () => {
  const { regionalRanks, regionVarianceShare, stabilityByBand } = await import("../src/lib/dvns-index.ts");
  const rows = [
    row("037006", { rank: 1, region: "08", score: 70, bandStability: 0.9 }),
    row("012001", { rank: 2, region: "03", score: 65, bandStability: 1 }),
    row("037001", { rank: 3, region: "08", score: 60, band: "B", bandStability: 0.5 }),
    row("071004", { status: "partial", rank: null, rankLow: null, rankHigh: null, band: null, peerRank: null, peerRanked: null, region: "16", score: 90 }),
  ];
  const parsed = assertIndexSnapshot(snapshot(rows));
  const ranks = regionalRanks(parsed.entries);
  assert.deepEqual(ranks.get("037006"), { rank: 1, total: 2 });
  assert.deepEqual(ranks.get("037001"), { rank: 2, total: 2 });
  assert.deepEqual(ranks.get("012001"), { rank: 1, total: 1 });
  // Out of the ranking, out of the regional ranking too.
  assert.equal(ranks.get("071004"), undefined);
  // Scores 70 and 60 in one region, 65 in the other: the regions have the same mean, region explains nothing.
  assert.equal(regionVarianceShare(parsed.entries, (entry) => entry.score), 0);
  assert.equal(regionVarianceShare(parsed.entries.slice(0, 1), (entry) => entry.score), null);
  assert.deepEqual(stabilityByBand(parsed.entries), { A: 0.95, B: 0.5 });
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
