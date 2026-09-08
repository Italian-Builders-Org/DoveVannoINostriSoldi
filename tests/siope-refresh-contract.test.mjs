import assert from "node:assert/strict";
import test from "node:test";
import native from "../src/data/generated/siope-nonmunicipal-provenance.json" with { type: "json" };
import { canonicalJson, sha256Hex, siopeProjectionMeasurements, INTEGRATED_CORPUS_CONTRACT } from "../src/lib/integrated-source-contract.ts";

function seal(value) {
  value.releaseId = sha256Hex(canonicalJson({ inputReceiptSha256: value.inputReceiptSha256, projections: value.projections, sources: value.sources }));
  return value;
}

test("SIOPE refresh measurements vary without changing other corpus contributions", () => {
  const before = siopeProjectionMeasurements(native);
  const candidate = structuredClone(native);
  candidate.projections["siope-uscite-asl"].rows += 12;
  candidate.projections["siope-uscite-asl"].bytes += 120;
  const after = siopeProjectionMeasurements(seal(candidate));
  assert.equal(after.rows - before.rows, 12);
  assert.equal(after.bytes - before.bytes, 120);
  assert.equal(INTEGRATED_CORPUS_CONTRACT.sourceRows - before.rows, 13_992_818);
  assert.equal(INTEGRATED_CORPUS_CONTRACT.publicRows - before.rows, 1_010_472);
  assert.equal(INTEGRATED_CORPUS_CONTRACT.sourceBytes - before.bytes, 2_865_986_840);
  assert.equal(INTEGRATED_CORPUS_CONTRACT.catalogOnlyRows, 12_979_505);
  assert.equal(INTEGRATED_CORPUS_CONTRACT.derivedOnlyRows, 2_841);
});

test("SIOPE refresh rejects unsealed mutations, missing or extra scopes and unsafe totals", () => {
  const unsealed = structuredClone(native);
  unsealed.projections["siope-uscite-asl"].rows += 1;
  assert.throws(() => siopeProjectionMeasurements(unsealed), /ricevuta/);
  const missing = structuredClone(native);
  delete missing.projections["siope-uscite-asl"];
  assert.throws(() => siopeProjectionMeasurements(seal(missing)));
  const extra = structuredClone(native);
  extra.projections["siope-comuni"] = extra.projections["siope-uscite-asl"];
  assert.throws(() => siopeProjectionMeasurements(seal(extra)));
  const unsafe = structuredClone(native);
  unsafe.projections["siope-uscite-asl"].rows = Number.MAX_SAFE_INTEGER;
  assert.throws(() => siopeProjectionMeasurements(seal(unsafe)), /limite intero/);
  const alteredReceipt = structuredClone(native);
  alteredReceipt.inputReceipt.files["amministrazioni.txt"].url = "https://example.invalid/ipa";
  assert.throws(() => siopeProjectionMeasurements(alteredReceipt), /ricevuta/);
});


test("SIOPE acquisition date cannot diverge from its receipt even with unchanged release hash", () => {
  const candidate = structuredClone(native);
  candidate.acquiredAt = "2026-09-08T08:00:00+00:00";
  assert.throws(() => siopeProjectionMeasurements(candidate), /ricevuta/);
});
