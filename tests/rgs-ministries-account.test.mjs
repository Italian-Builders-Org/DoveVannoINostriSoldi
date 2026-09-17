import assert from "node:assert/strict";
import test from "node:test";
import data from "../src/data/generated/rgs-ministries-2025.data.json" with { type: "json" };
import metadata from "../src/data/generated/rgs-ministries-2025.meta.json" with { type: "json" };
import { validateRgsMinistriesSnapshot } from "../src/lib/data/rgs-ministries-contract.ts";

test("RGS Ministries account preserves frames, coverage and public provenance", () => {
  const snapshot = validateRgsMinistriesSnapshot(data, metadata);
  assert.equal(snapshot.data.referenceYear, 2025);
  assert.equal(snapshot.data.ministries.length, 15);
  assert.equal(snapshot.data.coverage.rowsReconciled, 5_395);
  assert.equal(snapshot.data.coverage.includedRows, 5_395);
  assert.deepEqual(snapshot.data.period, { kind: "consuntivo", year: 2025 });
  assert.equal(snapshot.data.accountingFrame, "competenza");
  assert.equal(snapshot.data.unit, "EUR");
  assert.equal(snapshot.data.valueEncoding, "integer_cents");
  assert.equal(snapshot.data.totals.commitmentsCpCents, 117_092_823_506_300);
  assert.equal(snapshot.data.totals.paymentsCashCsCents, 115_416_545_988_384);
  assert.equal(snapshot.data.totals.residualsEndCents, 19_719_858_419_419);
  assert.equal(snapshot.metadata.source.licenseName, "CC BY 3.0");
  assert.match(snapshot.data.definitions.remainingCp, /non è un totale di cassa/);
  assert.match(snapshot.data.definitions.economiesGreaterExpensesCp, /rimasto inutilizzato rispetto alle previsioni o utilizzato oltre i limiti/);
});

test("RGS Ministries account keeps the CP mission identity exact", () => {
  for (const ministry of data.ministries) {
    for (const mission of ministry.missions) {
      assert.equal(
        mission.commitmentsCpCents,
        mission.paymentsCompetenceCpCents + mission.remainingCpCents,
      );
    }
  }
});

test("RGS Ministries account fails closed on frame and mission drift", () => {
  assert.throws(
    () => validateRgsMinistriesSnapshot({
      ...data,
      totals: { ...data.totals, paymentsCashCsCents: data.totals.paymentsCashCsCents + 1 },
    }, metadata),
    /totali Ministeri non riconciliati|pagamenti CS non riconciliati/,
  );
  const first = data.ministries[0];
  assert.throws(
    () => validateRgsMinistriesSnapshot({
      ...data,
      ministries: [{
        ...first,
        missions: [{ ...first.missions[0], commitmentsCpCents: first.missions[0].commitmentsCpCents + 1 }, ...first.missions.slice(1)],
      }, ...data.ministries.slice(1)],
    }, metadata),
    /missioni non riconciliate/,
  );
  assert.throws(
    () => validateRgsMinistriesSnapshot({
      ...data,
      ministries: [{ ...first, label: "MINISTERO RINOMINATO" }, ...data.ministries.slice(1)],
    }, metadata),
    /identità amministrazioni inattese/,
  );
  assert.throws(
    () => validateRgsMinistriesSnapshot({
      ...data,
      ministries: [first, first, ...data.ministries.slice(2)],
    }, metadata),
    /identità amministrazioni inattese/,
  );
  assert.throws(
    () => validateRgsMinistriesSnapshot(data, {
      ...metadata,
      asset: { ...metadata.asset, sha256: "0".repeat(64) },
    }),
    /asset non valido/,
  );
  assert.throws(
    () => validateRgsMinistriesSnapshot({
      ...data,
      ministries: [{
        ...first,
        missions: [{ ...first.missions[0], label: "Etichetta in conflitto" }, ...first.missions],
      }, ...data.ministries.slice(1)],
    }, metadata),
    /missioni non riconciliate/,
  );
});
