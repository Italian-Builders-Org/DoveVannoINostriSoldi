import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { assertStroppaEvidenceSnapshot } = await import(
  "../src/lib/data/stroppa-evidence-contract.ts"
);

const dataBytes = readFileSync(
  new URL("../src/data/generated/stroppa-vive-campaign.data.json", import.meta.url),
);
const metadata = JSON.parse(
  readFileSync(
    new URL("../src/data/generated/stroppa-vive-campaign.meta.json", import.meta.url),
    "utf8",
  ),
);
const snapshot = assertStroppaEvidenceSnapshot(JSON.parse(dataBytes));

test("verified VIVE campaign snapshot reconciles official records and cohort", () => {
  assert.equal(snapshot.observations.length, 5);
  assert.equal(snapshot.benchmarks.length, 4);
  assert.equal(snapshot.shareCards.length, 4);
  assert.deepEqual(snapshot.benchmarkCohorts[0].summary, {
    quantileConvention: "linear_interpolation_r7",
    minimumCohortSize: 4,
    count: 4,
    medianCents: 249_575,
    p25Cents: 219_363,
    p75Cents: 252_500,
    p90Cents: 257_000,
  });
  assert.deepEqual(snapshot.benchmarkCohorts[0].denominator, {
    label: "Cinque affidamenti editoriali individuati per la stessa mostra",
    candidateRecords: 5,
    includedRecords: 4,
    excludedByReason: { "piattaforma-editoriale-specifica": 1 },
  });
});

test("every publishable card reaches one verified official determination", () => {
  const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
  for (const card of snapshot.shareCards) {
    assert.equal(card.publicationStatus, "publishable");
    assert.equal(card.sourceIds.length, 1);
    const source = sources.get(card.sourceIds[0]);
    assert.equal(source.role, "official_primary");
    assert.equal(source.verification, "verified");
    assert.match(source.url, /^https:\/\/trasparenza\.cultura\.gov\.it\/moduli\/downloadFile\.php/);
    assert.match(source.locator, /CIG [A-Z0-9]{10}/);
    assert.match(card.caveat, /non prezzi unitari/);
    assert.match(card.caveat, /non prova pagamento/);
  }
});

test("platform-specific assignment stays visible but outside the benchmark", () => {
  const excluded = snapshot.assessments.find(
    (assessment) => assessment.observationId === "observation:bb23e9f610",
  );
  assert.equal(excluded.classification, "incomplete_or_not_comparable");
  assert.ok(
    snapshot.shareCards.every((card) => card.assessmentId !== excluded.id),
  );
});

test("metadata pins the compact snapshot and declares package normalization limits", () => {
  assert.equal(
    createHash("sha256").update(dataBytes).digest("hex"),
    metadata.snapshotSha256,
  );
  assert.deepEqual(metadata.packageAmountBasisObserved, { gross: 2, net: 3 });
  assert.equal(metadata.licenseOrReuse, "not_verified");
  assert.ok(metadata.boundaries.includes("deviation_is_not_evidence_of_waste_or_illegality"));
});
