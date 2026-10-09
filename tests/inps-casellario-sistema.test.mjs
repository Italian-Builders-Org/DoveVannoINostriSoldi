import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  inpsCasellarioSistemaSnapshot,
  queryInpsCasellarioSistema,
} = await import("../src/lib/inps-casellario-sistema-snapshot.ts");
const {
  millionEurosToCents,
  validateInpsCasellarioSistemaSnapshot,
} = await import("../src/lib/data/inps-casellario-sistema-contract.ts");

test("lo snapshot Casellario INPS riconcilia stock 2024 e serie 2023-2024", () => {
  const snapshot = inpsCasellarioSistemaSnapshot;
  assert.equal(snapshot.stock.pensionCount, 23_015_011);
  assert.equal(snapshot.stock.pensionerCount, 16_305_880);
  assert.equal(snapshot.stock.amountMillionEuros, 364_132);
  assert.equal(millionEurosToCents(364_132), 36_413_200_000_000);
  assert.equal(snapshot.series.observations.length, 2);
  assert.equal(snapshot.series.observations[0].year, 2023);
  assert.equal(snapshot.series.observations[1].year, 2024);
  assert.match(snapshot.methodology.progressioneIstat, /Casellario ISTAT 2012-2022/);
});

test("le fonti Casellario INPS sono ufficiali e hashed", () => {
  const [source] = inpsCasellarioSistemaSnapshot.sources;
  assert.match(source.url, /^https:\/\/www\.inps\.it\//);
  assert.match(source.landingUrl, /osservatoristatistici\/4$/);
  assert.equal(source.sha256, "a326db72e16b60fcf0b69e12fae753b485f0fad250a46c256723456522f4754b");
  assert.equal(source.bytes, 107_656);
  assert.match(source.rightsNote, /not-declared/i);
});

test("la query Casellario INPS espone stock e serie senza filtri inventati", () => {
  const result = queryInpsCasellarioSistema();
  assert.equal(result.datasetId, "inps-casellario-sistema");
  assert.equal(result.asOf, "2024-12-31");
  assert.equal(result.stock.pensionerCount, 16_305_880);
  assert.equal(result.natureShares.items.length, 3);
});

test("il contratto rifiuta uno stock che non quadra", () => {
  const broken = structuredClone(inpsCasellarioSistemaSnapshot);
  broken.stock.pensionCount = 1;
  assert.throws(
    () => validateInpsCasellarioSistemaSnapshot(broken),
    /pensioni 2024/,
  );
});
