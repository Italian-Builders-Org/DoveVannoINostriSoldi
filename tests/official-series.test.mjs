import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { getOfficialSeriesCatalog, compareOfficialSeries, parseOfficialSeriesSelection, officialSeriesSegments } = await import("../src/lib/official-series.ts");
const { queryEurostatCofog, eurostatCofogMetadata } = await import("../src/lib/eurostat-cofog-snapshot.ts");
const { getGovernmentScorecardV6SupplementalSnapshot } = await import("../src/lib/data/government-scorecard-page-contract.ts");
const { PRIMARY_NAV, flattenNavLinks } = await import("../src/lib/site-navigation.ts");
const { PUBLIC_INDEXABLE_PATHS } = await import("../src/lib/public-discovery.ts");
const catalog = getOfficialSeriesCatalog();

test("COFOG catalog preserves published units, coverage, source asset and flags for every function", () => {
  assert.equal(catalog.length, 26);
  assert.equal(new Set(catalog.map((series) => series.id)).size, catalog.length);
  const source = queryEurostatCofog({ geo: "IT" });
  for (const series of catalog.filter((series) => series.frequency === "annual")) {
    const code = series.id.split("-")[1];
    const rows = source.observations.filter((point) => point.function === code);
    assert.ok(rows.every((point) => point.amountCents % 10_000_000 === 0), "MIO_EUR keeps the source's one decimal without rounding away precision");
    assert.equal(series.points.length, 11);
    assert.deepEqual(series.points.map((point) => point.period), rows.map((point) => String(point.year)));
    assert.deepEqual(series.points.map((point) => point.value), rows.map((point) => series.unit === "MIO_EUR" ? point.amountCents / 100_000_000 : point.shareOfGdpHundredths / 100));
    assert.deepEqual(series.points.map((point) => point.breakBefore), rows.map((point) => point.flag === "b"));
    const asset = eurostatCofogMetadata.source.assets[series.unit === "MIO_EUR" ? "mio-eur" : "pc-gdp"];
    assert.equal(series.source.sha256, asset.sha256);
    assert.equal(series.source.queryUrl, asset.url);
    assert.equal(series.source.checkedAt, eurostatCofogMetadata.semantics.provenance.checkedAt);
  }
});

test("HICP keeps the original annual rates at monthly frequency and estimated observations", () => {
  const snapshot = getGovernmentScorecardV6SupplementalSnapshot();
  const inflation = snapshot.series.find((series) => series.indicator_id === "inflation");
  const source = snapshot.sources.find((entry) => entry.id === "eurostat:prc_hicp_minr");
  for (const series of catalog.filter((series) => series.unit === "RCH_A")) {
    const points = inflation.geographies.find((geo) => series.id === `hicp-${geo.geography}`).points;
    assert.equal(series.frequency, "monthly");
    assert.deepEqual(series.points.map(({ period, value }) => ({ period, value })), points.map(({ period, value }) => ({ period, value })));
    assert.equal(series.source.sha256, source.raw_sha256);
    assert.equal(series.source.updatedAt, source.upstream_updated_at);
    assert.equal(series.source.acquiredAt, source.retrieved_at);
    assert.equal(series.source.checkedAt, null);
    assert.match(series.points.at(-1).status, /Stimato dalla fonte.*e/);
    assert.equal(series.points.filter((point) => point.status.startsWith("Stimato")).length, points.filter((point) => point.status === "estimated").length);
  }
  assert.equal(catalog.find((series) => series.id === "hicp-IT").points.at(-1).value, 3.2);
});

test("two and four compatible selections preserve order and all original values", () => {
  for (const ids of [parseOfficialSeriesSelection(undefined), ["hicp-IT", "hicp-FR", "hicp-DE", "hicp-ES"], ["cofog-GF02-PC_GDP", "cofog-GF03-PC_GDP"]]) {
    const view = compareOfficialSeries(catalog, ids);
    assert.equal(view.ok, true);
    assert.deepEqual(view.selected.map((series) => series.id), ids);
    for (const [index, series] of view.selected.entries()) assert.deepEqual(view.rows.map((row) => row.points[index]), series.points);
  }
});

test("invalid counts, duplicate and unknown selections never return numerical comparisons", () => {
  for (const ids of [[], ["hicp-IT"], ["hicp-IT", "hicp-FR", "hicp-DE", "hicp-ES", "cofog-GF01-MIO_EUR"], ["hicp-IT", "hicp-IT"], ["hicp-IT", "unknown"]]) {
    const view = compareOfficialSeries(catalog, ids);
    assert.equal(view.ok, false);
    assert.equal("rows" in view, false);
    assert.ok(view.message.length);
  }
  assert.deepEqual(parseOfficialSeriesSelection(["hicp-IT", "hicp-FR", "", ""]), ["hicp-IT", "hicp-FR"]);
  assert.deepEqual(parseOfficialSeriesSelection(""), []);
});

test("unit, frequency, family and scope incompatibilities fail independently", () => {
  const pair = structuredClone(catalog.filter((series) => ["hicp-IT", "hicp-FR"].includes(series.id)));
  for (const [field, value] of [["unit", "PC_GDP"], ["frequency", "annual"], ["family", "different-growth-rate"], ["scope", "Different population or accounting boundary"]]) {
    const changed = structuredClone(pair);
    changed[1][field] = value;
    assert.equal(compareOfficialSeries(changed, changed.map((series) => series.id)).ok, false, field);
  }
  assert.equal(compareOfficialSeries(catalog, ["cofog-GF02-MIO_EUR", "cofog-GF03-PC_GDP"]).ok, false);
  assert.equal(compareOfficialSeries(catalog, ["cofog-GF02-PC_GDP", "hicp-IT"]).ok, false);
});

test("calendar gaps remain null, published zero stays zero and breaks stop chart segments", () => {
  const pair = structuredClone(catalog.filter((series) => ["hicp-IT", "hicp-FR"].includes(series.id)));
  for (const series of pair) series.points = series.points.slice(0, 5);
  pair[0].points[0].value = 0;
  pair[0].points.splice(1, 1);
  pair[0].points[2].breakBefore = true;
  pair[1].points.pop();
  const view = compareOfficialSeries(pair, pair.map((series) => series.id));
  assert.equal(view.ok, true);
  assert.deepEqual(view.rows.map((row) => row.period), ["1997-01", "1997-02", "1997-03", "1997-04", "1997-05"]);
  assert.equal(view.rows[0].points[0].value, 0);
  assert.equal(view.rows[1].points[0], null);
  assert.equal(view.rows[4].points[1], null);
  assert.deepEqual(officialSeriesSegments(view.rows.map((row) => row.points[0])), [[0], [2], [3, 4]]);
});

test("empty, duplicate, reversed, malformed, nonfinite and nonoverlapping observations fail closed", () => {
  for (const mutate of [
    (series) => { series.points = []; },
    (series) => { series.points[1] = series.points[0]; },
    (series) => { series.points.reverse(); },
    (series) => { series.points[0].period = "1997-13"; },
    (series) => { series.points[0].value = NaN; },
    (series) => { series.points = [{ ...series.points[0], period: "1990-01" }]; },
  ]) {
    const pair = structuredClone(catalog.filter((series) => ["hicp-IT", "hicp-FR"].includes(series.id)));
    mutate(pair[0]);
    assert.equal(compareOfficialSeries(pair, pair.map((series) => series.id)).ok, false);
  }
});

test("comparison is reachable through navigation and public discovery", () => {
  assert.ok(flattenNavLinks(PRIMARY_NAV).some((entry) => entry.href === "/esplora/serie"));
  assert.ok(PUBLIC_INDEXABLE_PATHS.includes("/esplora/serie"));
});
