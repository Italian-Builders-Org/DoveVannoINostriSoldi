import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { assessSocialCardReadiness, assertPublicSpendingEvidenceSnapshot } = await import(
  "../src/lib/data/public-spending-evidence-contract.ts"
);
const { computePublicSpendingBenchmark } = await import(
  "../src/lib/data/public-spending-benchmark.ts"
);

const snapshotPath = new URL(
  "../src/data/generated/vive-roma-in-moneta-restoration.json",
  import.meta.url,
);
const metadataPath = new URL(
  "../src/data/generated/vive-roma-in-moneta-restoration.meta.json",
  import.meta.url,
);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("the public snapshot contains exactly three official row-level restoration acts", () => {
  const snapshot = assertPublicSpendingEvidenceSnapshot(readJson(snapshotPath));
  const metadata = readJson(metadataPath);

  assert.equal(snapshot.sources.length, 3);
  assert.equal(snapshot.observations.length, 3);
  assert.deepEqual(
    snapshot.sources.map((source) => source.identifier.match(/CIG ([A-Z0-9]+)/)?.[1]),
    metadata.selection.includedCigs,
  );
  assert.deepEqual(
    snapshot.sources.map((source) => source.actDate),
    ["2026-06-03", "2026-06-10", "2026-06-16"],
  );
  assert.deepEqual(
    snapshot.observations.map((observation) => observation.amount.valueCents),
    [209016, 28000, 627000],
  );

  const sourceUrls = snapshot.sources.map((source) => source.url);
  assert.equal(new Set(sourceUrls).size, 3);
  assert.ok(sourceUrls.every((url) => url !== metadata.officialIndexUrl));

  snapshot.sources.forEach((source, index) => {
    assert.equal(source.kind, "official_record");
    const sourceUrl = new URL(source.url);
    assert.equal(sourceUrl.hostname, "vive.cultura.gov.it");
    assert.ok(sourceUrl.pathname.toLowerCase().endsWith(".pdf"));
    assert.equal(source.locator.kind, "cig");
    assert.equal(source.locator.value, metadata.selection.includedCigs[index]);
    assert.ok(source.identifier.includes(source.locator.value));
    assert.equal(source.publishedAt, undefined);
  });
  for (const observation of snapshot.observations) {
    assert.equal(observation.amount.taxBasis, "net");
    assert.equal(observation.amount.unit, "award_total");
    assert.ok(observation.amount.valueCents > 0, "n.d. non può diventare zero");
    assert.equal(observation.denominator.value, 1);
    assert.ok(observation.sourceIds.includes(observation.denominator.sourceId));
    assert.equal(observation.subject.counterparty, undefined);
  }

  const reference = snapshot.observations.find(
    (observation) => observation.benchmark.targetDeltaCents === 0,
  );
  assert.equal(reference.classification, "benchmark_reference");
  assert.equal(reference.evidenceStrength, "verified_official_record");
  assert.equal(reference.publicationStatus, "blocked");
  assert.ok(assessSocialCardReadiness(snapshot, reference).length > 0);

  const anomalies = snapshot.observations.filter(
    (observation) => observation.classification === "anomaly",
  );
  assert.equal(anomalies.length, 2);
  assert.ok(anomalies.every((observation) => observation.benchmark.targetDeltaCents !== 0));
  assert.match(anomalies.find((observation) => observation.benchmark.targetDeltaCents < 0).caveats[0], /basso/);
  assert.match(anomalies.find((observation) => observation.benchmark.targetDeltaCents > 0).caveats[0], /alto/);
});

test("every declared R7 benchmark reconciles from the three official observations", () => {
  const snapshot = assertPublicSpendingEvidenceSnapshot(readJson(snapshotPath));

  for (const observation of snapshot.observations) {
    const declared = observation.benchmark;
    const computed = computePublicSpendingBenchmark({
      cohortId: declared.cohortId,
      cohortLabel: declared.cohortLabel,
      targetObservationId: observation.id,
      members: snapshot.observations.map((member) => ({
        observationId: member.id,
        valueCents: member.amount.valueCents,
        category: member.category,
        period: member.period,
        taxBasis: member.amount.taxBasis,
        unit: member.amount.unit,
        denominator: {
          name: member.denominator.name,
          value: member.denominator.value,
          unit: member.denominator.unit,
        },
      })),
    });

    assert.deepEqual(computed, declared);
  }
});

test("the transport act is public but cannot enter the restoration cohort", () => {
  const snapshot = assertPublicSpendingEvidenceSnapshot(readJson(snapshotPath));
  const { excludedComparison } = readJson(metadataPath);
  const members = snapshot.observations.map((member) => ({
    observationId: member.id,
    valueCents: member.amount.valueCents,
    category: member.category,
    period: member.period,
    taxBasis: member.amount.taxBasis,
    unit: member.amount.unit,
    denominator: {
      name: member.denominator.name,
      value: member.denominator.value,
      unit: member.denominator.unit,
    },
  }));

  members.push({
    observationId: `excluded-${excludedComparison.cig.toLowerCase()}`,
    valueCents: excludedComparison.amount.valueCents,
    category: excludedComparison.category,
    period: excludedComparison.period,
    taxBasis: excludedComparison.amount.taxBasis,
    unit: excludedComparison.amount.unit,
    denominator: excludedComparison.denominator,
  });

  assert.throws(
    () => computePublicSpendingBenchmark({
      cohortId: "invalid-restoration-plus-transport",
      cohortLabel: "Coorte non omogenea",
      targetObservationId: snapshot.observations[0].id,
      members,
    }),
    /coorte non like-for-like/,
  );
  assert.ok(excludedComparison.reason.includes("scope di servizio diversi"));
  assert.equal(excludedComparison.locator.kind, "cig");
  assert.equal(excludedComparison.locator.value, excludedComparison.cig);
  assert.ok(excludedComparison.identifier.includes(excludedComparison.cig));
  assert.equal(excludedComparison.actDate, "2026-06-10");
  assert.equal(new URL(excludedComparison.sourceUrl).hostname, "vive.cultura.gov.it");
  assert.notEqual(excludedComparison.sourceUrl, readJson(metadataPath).officialIndexUrl);
  assert.ok(!snapshot.observations.some((observation) => observation.id.includes("bbf994a2a0")));
});

test("the public artifacts contain no counterparty names or accusatory claims", () => {
  const publicText = `${readFileSync(snapshotPath, "utf8")}\n${readFileSync(metadataPath, "utf8")}`;

  assert.doesNotMatch(publicText, /partita IVA|codice fiscale|con sede|operatore economico [A-Z]/i);
  assert.doesNotMatch(publicText, /spreco documentato|illecito documentato|irregolarità documentata/i);
  assert.match(publicText, /non (dimostra|prove di) spreco/i);
});
