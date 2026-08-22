import assert from "node:assert/strict";
import test from "node:test";
import data from "../src/data/generated/istat-regions-2024.data.json" with { type: "json" };
import metadata from "../src/data/generated/istat-regions-2024.meta.json" with { type: "json" };
import { validateIstatRegionsSnapshot } from "../src/lib/data/istat-regions-contract.ts";

test("Istat regional accounts preserve the 22-administration scope", () => {
  const snapshot = validateIstatRegionsSnapshot(data, metadata);
  assert.equal(snapshot.data.referenceYear, 2024);
  assert.equal(snapshot.data.entities.length, 22);
  assert.equal(snapshot.data.coverage.ordinaryRegions, 15);
  assert.equal(snapshot.data.coverage.specialRegions, 5);
  assert.equal(snapshot.data.coverage.autonomousProvinces, 2);
  assert.equal(snapshot.metadata.source.licenseStatus, "not-declared");
});

test("Istat regional accounts fail closed on identity, title or source drift", () => {
  const first = data.entities[0];
  assert.throws(
    () => validateIstatRegionsSnapshot({
      ...data,
      entities: [{ ...first, commitmentsCents: first.commitmentsCents + 1 }, ...data.entities.slice(1)],
    }, metadata),
    /identità o Titoli non riconciliati/,
  );
  assert.throws(
    () => validateIstatRegionsSnapshot({
      ...data,
      entities: [{ ...first, status: "special" }, ...data.entities.slice(1)],
    }, metadata),
    /identità o Titoli non riconciliati/,
  );
  assert.throws(
    () => validateIstatRegionsSnapshot(data, {
      ...metadata,
      source: { ...metadata.source, licenseStatus: "declared" },
    }),
    /licenza non verificata attribuita/,
  );
  assert.throws(
    () => validateIstatRegionsSnapshot(data, {
      ...metadata,
      asset: { ...metadata.asset, sha256: "0".repeat(64) },
    }),
    /archivio non valido/,
  );
});
