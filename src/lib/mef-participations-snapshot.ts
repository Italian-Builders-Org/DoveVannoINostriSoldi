import snapshotJson from "@/data/generated/mef-participations-overview.json";

export type MefParticipationsSnapshot = {
  schemaVersion: 1;
  transformVersion: 1;
  referenceYear: number;
  referenceDate: string;
  publishedAt: string;
  generatedAt: string;
  source: {
    owner: string;
    landingUrl: string;
    assetUrl: string;
    license: string;
    rawSha256: string;
    detectedEncoding: string;
    delimiter: string;
  };
  totals: {
    participationRecords: number;
    declaringAdministrations: number;
    participatedOrganizations: number;
    directParticipationRecords: number;
    indirectParticipationRecords: number;
  };
  declaredEvidence: {
    analogControlRecords: number;
    directAwardRecords: number;
    bothSignalsRecords: number;
    legalMeaning: string;
  };
  topCompaniesByDeclaringAdministrations: Array<{
    taxCode: string;
    name: string;
    declaringAdministrations: number;
  }>;
};

function validateSnapshot(value: unknown): asserts value is MefParticipationsSnapshot {
  if (!value || typeof value !== "object") throw new Error("Snapshot MEF non valido");
  const snapshot = value as Partial<MefParticipationsSnapshot>;
  if (
    snapshot.schemaVersion !== 1 ||
    typeof snapshot.referenceYear !== "number" ||
    snapshot.referenceYear < 2000
  ) {
    throw new Error("Versione o anno snapshot MEF non validi");
  }
  if (!snapshot.totals || snapshot.totals.participationRecords <= 0) {
    throw new Error("Totali snapshot MEF non validi");
  }
  if (!snapshot.source?.assetUrl.startsWith("https://www.de.mef.gov.it/")) {
    throw new Error("Origine snapshot MEF non ufficiale");
  }
  if (!Array.isArray(snapshot.topCompaniesByDeclaringAdministrations)) {
    throw new Error("Classifica partecipate MEF non valida");
  }
}

validateSnapshot(snapshotJson);

export const mefParticipationsSnapshot: MefParticipationsSnapshot = snapshotJson;
