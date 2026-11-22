import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { parseCompareParams, buildComuniComparison, COMPARE_MAX_COMPARED } = await import("../src/lib/comuni-compare.ts");
const { getSiopeMunicipalityDetailByIpaCode } = await import("../src/lib/siope-municipality-detail.ts");
const { populationBand } = await import("../src/lib/municipality-geography.ts");

const MANTOVA = "c_e897";

test("parametri: deduplica, scarta codici non validi e la base, limita i confronti", () => {
  const request = parseCompareParams({
    ente: MANTOVA,
    con: ["c_d612,c_d612", "c_a783", "bad code!", MANTOVA, "c_f205,c_h501,c_g273"],
    regione: "1",
    zona: "si",
    costa: ["1", "1"],
  });
  assert.equal(request.ente, MANTOVA);
  assert.deepEqual(request.compared, ["c_d612", "c_a783", "c_f205", "c_h501"]);
  assert.equal(request.compared.length, COMPARE_MAX_COMPARED);
  assert.deepEqual(request.rejected, ["bad code!"]);
  assert.equal(request.truncated, true);
  // Only the literal "1" switches a filter on; repeated values are ambiguous and ignored.
  assert.deepEqual(request.filters, { region: true, altitude: false, coast: false });
  assert.equal(request.autoSuggest, false);
  assert.equal(parseCompareParams({ ente: MANTOVA }).autoSuggest, true);
  assert.equal(parseCompareParams({ ente: MANTOVA, con: "" }).autoSuggest, false);
  assert.equal(parseCompareParams({ ente: "../x" }).ente, null);
});

test("il gruppo è la fascia di popolazione del comune, la base resta fuori dalle statistiche", () => {
  const comparison = buildComuniComparison(parseCompareParams({ ente: MANTOVA, con: "" }));
  assert.ok(comparison);
  const band = populationBand(comparison.base.population);
  assert.equal(comparison.group.band, band);
  assert.ok(comparison.group.size >= 50, `gruppo troppo piccolo: ${comparison.group.size}`);
  assert.ok(comparison.group.members.every((m) => populationBand(m.population) === band));
  assert.ok(!comparison.group.members.some((m) => m.codiceIpa === MANTOVA));
  const stat = comparison.stats.spesaTotale;
  assert.equal(stat.count, comparison.group.members.filter((m) => m.values.spesaTotale !== null).length);
  assert.ok(stat.p10 <= stat.p25 && stat.p25 <= stat.median && stat.median <= stat.p75 && stat.p75 <= stat.p90);
});

test("la spesa per abitante coincide con la scheda SIOPE del comune", () => {
  const comparison = buildComuniComparison(parseCompareParams({ ente: MANTOVA, con: "" }));
  const detail = getSiopeMunicipalityDetailByIpaCode(MANTOVA);
  const year = detail.years.find((y) => y.year === comparison.year);
  assert.equal(year.completeness, "complete", "il confronto usa un anno completo");
  assert.ok(Math.abs(comparison.base.values.spesaTotale - year.perCapitaCents / 100) < 0.01);
});

test("i filtri restringono il gruppo senza cambiare la fascia", () => {
  const all = buildComuniComparison(parseCompareParams({ ente: MANTOVA, con: "" }));
  const region = buildComuniComparison(parseCompareParams({ ente: MANTOVA, con: "", regione: "1" }));
  assert.ok(region.group.size < all.group.size);
  assert.ok(region.group.members.every((m) => m.regionCode === region.base.regionCode));
  assert.ok(region.group.criteria.some((c) => /regione/i.test(c)));
  assert.equal(region.group.band, all.group.band);
});

test("confronti fuori gruppo restano visibili ma marcati; mancanti dichiarati", () => {
  const comparison = buildComuniComparison(parseCompareParams({ ente: MANTOVA, con: "c_h501,c_zzzz" }));
  const rome = comparison.compared.find((m) => m.codiceIpa === "c_h501");
  assert.ok(rome);
  assert.equal(rome.inGroup, false, "Roma non è nella fascia di Mantova");
  assert.deepEqual(comparison.missing, ["c_zzzz"]);
});

test("senza 'con' propone i comuni più vicini per popolazione dentro il gruppo", () => {
  const comparison = buildComuniComparison(parseCompareParams({ ente: MANTOVA }));
  assert.equal(comparison.compared.length, 3);
  assert.ok(comparison.compared.every((m) => m.inGroup && m.codiceIpa !== MANTOVA));
  assert.ok(comparison.suggestions.every((s) => !comparison.compared.some((m) => m.codiceIpa === s.codiceIpa)));
});

test("valori coerenti: niente NaN, quote tra 0 e 100, OpenCivitas assente fuori dalle RSO", () => {
  const comparison = buildComuniComparison(parseCompareParams({ ente: MANTOVA, con: "c_g273" }));
  for (const member of [comparison.base, ...comparison.compared, ...comparison.group.members]) {
    for (const [id, value] of Object.entries(member.values)) {
      assert.ok(value === null || Number.isFinite(value), `${member.name} ${id}`);
    }
    for (const id of ["quotaCorrente", "quotaInvestimenti", "autonomia"]) {
      const value = member.values[id];
      assert.ok(value === null || (value >= 0 && value <= 100), `${member.name} ${id}=${value}`);
    }
  }
  const palermo = comparison.compared[0];
  assert.equal(palermo.values.ocTotale, null, "Sicilia è a statuto speciale: OpenCivitas non la copre");
  assert.notEqual(comparison.base.values.ocTotale, null);
  for (const metric of comparison.metrics) assert.doesNotMatch(`${metric.label} ${metric.description}`, /—|–/);
});

test("comune inesistente: nessun confronto", () => {
  assert.equal(buildComuniComparison(parseCompareParams({ ente: "c_zzzz" })), null);
  assert.equal(buildComuniComparison(parseCompareParams({})), null);
});
