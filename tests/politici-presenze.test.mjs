import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { makeMap } from "./fixtures/politici-atlas.mjs";

const {
  histogram,
  parsePresencePercent,
  quantile,
  sourceGroupOf,
  summarize,
  filterPresenceRows,
  tailRows,
} = await import("../src/lib/politici-presenze-stats.ts");
const { getPresenceDistribution } = await import("../src/lib/politici-presenze.ts");
const { readAtlasState, atlasUrl, defaultSelection, scopeForSelection, supportsTermFilter, SCOPES } = await import("../src/app/politici/atlas-model.ts");

test("quantiles interpolate linearly and do not depend on input order", () => {
  const sorted = [10, 20, 30, 40, 50];
  assert.equal(quantile(sorted, 0), 10);
  assert.equal(quantile(sorted, 0.5), 30);
  assert.equal(quantile(sorted, 1), 50);
  assert.equal(quantile(sorted, 0.1), 14);
  assert.equal(quantile([7], 0.9), 7);
  assert.throws(() => quantile([], 0.5));
  assert.deepEqual(summarize([50, 10, 40, 30, 20]), summarize([10, 20, 30, 40, 50]));
});

test("summary keeps mean and median distinct on a skewed distribution", () => {
  // A long tail of absentees drags the mean below the median: the chart must show both.
  const summary = summarize([0, 90, 91, 92, 93, 94]);
  assert.equal(summary.count, 6);
  assert.equal(summary.median, 91.5);
  assert.equal(summary.mean, 76.67);
  assert.equal(summary.min, 0);
  assert.equal(summary.max, 94);
  assert.ok(summary.p10 < summary.p25 && summary.p25 <= summary.median && summary.median <= summary.p75 && summary.p75 <= summary.p90);
  assert.equal(summarize([]), null, "An empty filter is an empty state, not zeros");
});

test("histogram covers 0-100 without losing the 100% and 0% endpoints", () => {
  const bins = histogram([0, 4.99, 5, 99.99, 100], 5);
  assert.equal(bins.length, 20);
  assert.equal(bins[0].from, 0);
  assert.equal(bins.at(-1).to, 100);
  assert.equal(bins[0].count, 2);
  assert.equal(bins[1].count, 1);
  assert.equal(bins.at(-1).count, 2, "100% belongs to the last bin, not to a phantom 21st one");
  assert.equal(bins.reduce((total, bin) => total + bin.count, 0), 5);
  assert.throws(() => histogram([101], 5));
  assert.throws(() => histogram([-1], 5));
});

test("percent strings from the official table parse strictly", () => {
  assert.equal(parsePresencePercent("75.52%"), 75.52);
  assert.equal(parsePresencePercent("0%"), 0);
  assert.equal(parsePresencePercent("100%"), 100);
  for (const bad of ["", "75,52%", "75.52", "abc%", "120%", "-1%"]) assert.throws(() => parsePresencePercent(bad), bad);
});

test("source group labels map to the atlas families, Misto components included", () => {
  assert.deepEqual(sourceGroupOf("Fratelli d'Italia"), { id: "fratelli-italia", shortLabel: "FdI", label: "Fratelli d’Italia" });
  assert.equal(sourceGroupOf("MoVimento 5 Stelle").id, "movimento-5-stelle");
  assert.equal(sourceGroupOf("MISTO-Minoranze Linguistiche").id, "misto");
  assert.equal(sourceGroupOf("MISTO-+Europa").id, "misto");
  assert.equal(sourceGroupOf("NOI MODERATI (NOI CON L'ITALIA, CORAGGIO ITALIA, UDC E ITALIA AL CENTRO)-MAIE-CENTRO POPOLARE").id, "noi-moderati");
  assert.equal(sourceGroupOf("Italia Viva-Il Centro-Renew Europe").id, "italia-viva");
  // An unknown group is shown under its own label, never silently merged into another party.
  assert.deepEqual(sourceGroupOf("Nuovo Gruppo"), { id: null, shortLabel: "Nuovo Gruppo", label: "Nuovo Gruppo" });
});

test("the published distribution reconciles with the official snapshot", () => {
  const data = getPresenceDistribution();
  assert.equal(data.chamber, "camera");
  assert.equal(data.rows.length, data.coverage.rows, "Every official row is in the distribution, matched or not");
  const overall = summarize(data.rows.map((row) => row.presence));
  assert.ok(overall.min >= 0 && overall.max <= 100);
  assert.ok(overall.mean < overall.median, "The XIX Camera has a tail of absentees");
  assert.ok(data.rows.every((row) => row.group.id !== null), "Every group in the current snapshot maps to an atlas family");
  assert.ok(data.rows.every((row) => Math.abs(row.presence - row.votesPercent - row.missionsPercent) < 0.02 + 1e-9), "presenze = voti espressi + missioni");
  assert.ok(data.rows.every((row) => Math.abs(row.presence + row.absencesPercent - 100) < 0.02 + 1e-9), "presenze + assenze = 100%");
  const ids = data.rows.map((row) => row.key);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(data.rows.filter((row) => row.personId).length >= data.coverage.matchedDeputies - 5);
  assert.match(data.sourceUrl, /^https:\/\/www\.camera\.it\//u);
  assert.match(data.observedDate, /^\d{4}-\d{2}-\d{2}$/u);
  assert.ok(data.senateGap.includes("Senato"));
  // Matched rows carry the atlas display name, not the uppercase SURNAME NAME of the table.
  assert.ok(data.rows.filter((row) => row.personId).every((row) => row.name !== row.name.toLocaleUpperCase("it-IT")));
});

test("filters and the tail use the source group and current roles consistently", () => {
  const rows = [
    { key: "a", name: "Anna Bianchi", personId: "dep-1", group: { id: "lega", shortLabel: "Lega", label: "Lega" }, presence: 20, votesPercent: 20, missionsPercent: 0, absencesPercent: 80, roles: ["governo"], roleLabel: "Ministra" },
    { key: "b", name: "Bruno Rossi", personId: "dep-2", group: { id: "lega", shortLabel: "Lega", label: "Lega" }, presence: 95, votesPercent: 95, missionsPercent: 0, absencesPercent: 5, roles: ["capigruppo"], roleLabel: null },
    { key: "c", name: "Carla Verdi", personId: null, group: { id: "misto", shortLabel: "Misto", label: "Misto" }, presence: 60, votesPercent: 50, missionsPercent: 10, absencesPercent: 40, roles: [], roleLabel: null },
  ];
  assert.equal(filterPresenceRows(rows, { family: null, role: "tutti", query: "" }).length, 3);
  assert.deepEqual(filterPresenceRows(rows, { family: "lega", role: "tutti", query: "" }).map((row) => row.key), ["a", "b"]);
  assert.deepEqual(filterPresenceRows(rows, { family: null, role: "governo", query: "" }).map((row) => row.key), ["a"]);
  assert.deepEqual(filterPresenceRows(rows, { family: null, role: "capigruppo", query: "" }).map((row) => row.key), ["b"]);
  assert.deepEqual(filterPresenceRows(rows, { family: null, role: "tutti", query: "verdì" }).map((row) => row.key), ["c"]);
  assert.deepEqual(filterPresenceRows(rows, { family: null, role: "tutti", query: "misto" }).map((row) => row.key), ["c"]);
  // Tail: everyone at or below the 10th percentile, lowest first, at least one row.
  assert.deepEqual(tailRows(rows).map((row) => row.key), ["a"]);
  assert.deepEqual(tailRows([]), []);
});

test("Presenze is a scope with its own URL and keeps the view on person selection", () => {
  const map = makeMap();
  assert.ok(SCOPES.some((scope) => scope.id === "presenze"));
  assert.deepEqual(defaultSelection("presenze"), { kind: "overview" });
  assert.equal(supportsTermFilter("presenze"), false);
  const parsed = readAtlasState(new URLSearchParams("vista=presenze&famiglia=lega"), map);
  assert.equal(parsed.state.scope, "presenze");
  const person = map.people.find((item) => item.chamberId === "camera");
  assert.equal(scopeForSelection({ kind: "person", id: person.id }, map, "presenze"), "presenze");
  const withPerson = readAtlasState(new URLSearchParams(`vista=presenze&person=${person.id}`), map);
  assert.equal(withPerson.state.scope, "presenze");
  const url = new URL(atlasUrl("https://www.dovevannoinostrisoldi.com/politici", parsed.state), "https://www.dovevannoinostrisoldi.com");
  assert.equal(url.searchParams.get("vista"), "presenze");
});
