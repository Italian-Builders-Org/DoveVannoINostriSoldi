export type PcmFinancialMission = {
  code: string;
  label: string;
  paymentsCents: number;
  commitmentsCents: number;
};

export type PcmFinancialData = {
  schemaVersion: 1;
  referenceYear: 2024;
  unit: "euro_cents";
  totals: {
    commitmentsCents: number;
    finalCompetenceAppropriationCents: number;
    paymentsCurrentCents: number;
    paymentsResidualCents: number;
    paymentsTotalCents: number;
    remainingCurrentCents: number;
  };
  missions: PcmFinancialMission[];
  coverage: {
    sourceRows: number;
    excludedBlankRows: number;
    centresOfResponsibility: number;
    missions: number;
    currentAccountRowsReconciled: number;
  };
  definitions: Record<string, string>;
};

export type PcmFinancialMetadata = {
  schemaVersion: 1;
  source: {
    owner: string;
    landingUrl: string;
    resourceUrl: string;
    sourceRecordId: string;
    referencePeriod: "2024";
    approvedAt: string;
    publishedAt: string;
    acquiredAt: string;
    format: "xlsx";
    licenseStatus: "not-declared";
    rightsNote: string;
  };
  asset: { bytes: number; sha256: string };
  transformation: { version: 1; description: string; headers: 32 };
  dataArtifact: { path: string; bytes: number; sha256: string };
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Snapshot PCM non valido: ${message}`);
}

function officialUrl(value: string): boolean {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "presidenza.governo.it";
}

function safeMoney(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function validatePcmFinancialSnapshot(
  data: PcmFinancialData,
  metadata: PcmFinancialMetadata,
): { data: PcmFinancialData; metadata: PcmFinancialMetadata } {
  invariant(data.schemaVersion === 1 && metadata.schemaVersion === 1, "versione inattesa");
  invariant(data.referenceYear === 2024 && data.unit === "euro_cents", "periodo o unità inattesi");
  invariant(Object.values(data.totals).every(safeMoney), "totali monetari non validi");
  invariant(
    data.totals.paymentsTotalCents ===
      data.totals.paymentsCurrentCents + data.totals.paymentsResidualCents,
    "pagamenti totali non riconciliati",
  );
  invariant(data.missions.length === data.coverage.missions, "numero missioni divergente");
  invariant(data.missions.every((mission) => mission.code && mission.label), "missione incompleta");
  invariant(
    data.missions.every((mission) => safeMoney(mission.paymentsCents) && safeMoney(mission.commitmentsCents)),
    "importo missione non valido",
  );
  invariant(
    data.missions.reduce((total, mission) => total + mission.paymentsCents, 0) ===
      data.totals.paymentsTotalCents,
    "missioni non riconciliate con i pagamenti",
  );
  invariant(
    data.missions.reduce((total, mission) => total + mission.commitmentsCents, 0) ===
      data.totals.commitmentsCents,
    "missioni non riconciliate con gli impegni",
  );
  invariant(
    data.coverage.sourceRows === 572 &&
      data.coverage.excludedBlankRows === 1 &&
      data.coverage.centresOfResponsibility === 20 &&
      data.coverage.currentAccountRowsReconciled === 572,
    "copertura inattesa",
  );
  invariant(Object.values(data.definitions).every((value) => value.trim()), "definizioni mancanti");
  invariant(metadata.source.owner === "Presidenza del Consiglio dei ministri", "titolare inatteso");
  invariant(officialUrl(metadata.source.landingUrl) && officialUrl(metadata.source.resourceUrl), "URL non ufficiale");
  invariant(metadata.source.sourceRecordId === "pcm:conto-finanziario:2024", "ID sorgente inatteso");
  invariant(metadata.source.licenseStatus === "not-declared", "licenza non verificata attribuita");
  invariant(!Number.isNaN(Date.parse(metadata.source.acquiredAt)), "data acquisizione non valida");
  invariant(Number.isSafeInteger(metadata.asset.bytes) && metadata.asset.bytes > 0, "byte sorgente non validi");
  invariant(/^[a-f0-9]{64}$/.test(metadata.asset.sha256), "hash sorgente non valido");
  invariant(metadata.transformation.version === 1 && metadata.transformation.headers === 32, "trasformazione inattesa");
  invariant(/^[a-f0-9]{64}$/.test(metadata.dataArtifact.sha256), "hash dati non valido");
  return { data, metadata };
}
