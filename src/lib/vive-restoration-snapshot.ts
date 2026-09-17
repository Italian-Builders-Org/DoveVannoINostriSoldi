import rawSnapshot from "@/data/generated/vive-roma-in-moneta-restoration.json";
import {
  assessSocialCardReadiness,
  assertPublicSpendingEvidenceSnapshot,
  type EvidenceObservation,
} from "@/lib/data/public-spending-evidence-contract";

const snapshot = assertPublicSpendingEvidenceSnapshot(rawSnapshot);

function fail(message: string): never {
  throw new Error("Snapshot confronti non valido: " + message);
}

function isPublishableAnomaly(observation: EvidenceObservation): boolean {
  return observation.classification === "anomaly" && observation.publicationStatus === "publishable";
}

const publishableAnomalies = snapshot.observations.filter(isPublishableAnomaly);
const benchmarkReferences = snapshot.observations.filter(
  (observation) =>
    observation.classification === "benchmark_reference" &&
    observation.publicationStatus === "blocked",
);

if (snapshot.sources.length !== 3 || snapshot.observations.length !== 3) {
  fail("sono attesi tre atti e tre osservazioni");
}
if (publishableAnomalies.length !== 2 || benchmarkReferences.length !== 1) {
  fail("sono attesi due segnali pubblicabili e un riferimento non destinato a card");
}
if (
  snapshot.observations.some(
    (observation) =>
      !observation.amount ||
      observation.amount.valueCents <= 0 ||
      !observation.benchmark ||
      observation.benchmark.targetDeltaCents === null ||
      observation.benchmark.targetDeltaPercent === null,
  )
) {
  fail("ogni confronto richiede importo positivo e scostamenti riconciliati");
}

const cohortIds = new Set(snapshot.observations.map((observation) => observation.benchmark?.cohortId));
const entities = new Set(
  snapshot.observations.map((observation) => observation.subject.spendingEntity.name),
);
const dimensions = new Set(
  snapshot.observations.map((observation) =>
    [
      observation.category,
      observation.amount?.taxBasis,
      observation.amount?.unit,
      observation.procurementMethod?.value,
      observation.period.start,
      observation.period.end,
    ].join("|"),
  ),
);

if (cohortIds.size !== 1 || entities.size !== 1 || dimensions.size !== 1) {
  fail("la coorte non mantiene ente, periodo e dimensioni confrontabili");
}

for (const observation of publishableAnomalies) {
  const blockers = assessSocialCardReadiness(snapshot, observation);
  if (blockers.length > 0) {
    fail("segnale " + observation.id + " non pubblicabile: " + blockers.join(", "));
  }
}

export const restorationComparisonSnapshot = snapshot;
export const restorationPublishableAnomalies = publishableAnomalies;
export const restorationBenchmarkReference = benchmarkReferences[0];
