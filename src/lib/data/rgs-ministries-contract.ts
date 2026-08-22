export type RgsMinistry = {
  code: string;
  label: string;
  commitmentsCpCents: number;
  paymentsCompetenceCpCents: number;
  paymentsResidualRsCents: number;
  paymentsCashCsCents: number;
  remainingCpCents: number;
  remainingRsCents: number;
  residualsEndCents: number;
  missions: Array<{
    code: string;
    label: string;
    commitmentsCpCents: number;
    paymentsCompetenceCpCents: number;
    remainingCpCents: number;
  }>;
};

export type RgsMinistriesData = {
  schemaVersion: 1;
  referenceYear: 2025;
  period: { kind: "consuntivo"; year: 2025 };
  accountingFrame: "competenza";
  unit: "EUR";
  valueEncoding: "integer_cents";
  totals: Omit<RgsMinistry, "code" | "label" | "missions">;
  ministries: RgsMinistry[];
  coverage: { sourceRows: 5395; includedRows: 5395; headers: 41; ministries: 15; rowsReconciled: 5395 };
  definitions: Record<string, string>;
};

export type RgsMinistriesMetadata = {
  schemaVersion: 1;
  source: {
    owner: string;
    landingUrl: string;
    resourceUrl: string;
    sourceRecordId: "2025_RND_SPE_ELB_CAP_001";
    referencePeriod: "2025";
    createdAt: string;
    updatedAt: string;
    acquiredAt: string;
    format: "csv";
    licenseStatus: "declared";
    licenseName: "CC BY 3.0";
  };
  asset: { bytes: 4196648; sha256: string; encoding: "cp1252"; delimiter: ";" };
  transformation: { version: 1; description: string };
  dataArtifact: { path: string; bytes: number; sha256: string };
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Snapshot Ministeri non valido: ${message}`);
}

function money(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

const EXPECTED_MINISTRIES: ReadonlyMap<string, string> = new Map([
  ["02", "MINISTERO DELL'ECONOMIA E DELLE FINANZE"],
  ["03", "MINISTERO DELLE IMPRESE E DEL MADE IN ITALY"],
  ["04", "MINISTERO DEL LAVORO E DELLE POLITICHE SOCIALI"],
  ["05", "MINISTERO DELLA GIUSTIZIA"],
  ["06", "MINISTERO DEGLI AFFARI ESTERI E DELLA COOPERAZIONE INTERNAZIONALE"],
  ["07", "MINISTERO DELL'ISTRUZIONE E DEL MERITO"],
  ["08", "MINISTERO DELL'INTERNO"],
  ["09", "MINISTERO DELL'AMBIENTE E DELLA SICUREZZA ENERGETICA"],
  ["10", "MINISTERO DELLE INFRASTRUTTURE E DEI TRASPORTI"],
  ["11", "MINISTERO DELL'UNIVERSITA' E DELLA RICERCA"],
  ["12", "MINISTERO DELLA DIFESA"],
  ["13", "MINISTERO DELL'AGRICOLTURA, DELLA SOVRANITA' ALIMENTARE E DELLE FORESTE"],
  ["14", "MINISTERO DELLA CULTURA"],
  ["15", "MINISTERO DELLA SALUTE"],
  ["16", "MINISTERO DEL TURISMO"],
] as const);

const EXPECTED_LANDING_URL = "https://bdap-opendata.rgs.mef.gov.it/content/2025-rendiconto-pubblicato-elaborabile-spese-capitolo?metadati=showall";
const EXPECTED_RESOURCE_URL = "https://bdap-opendata.rgs.mef.gov.it/export/csv/2025---Rendiconto-Pubblicato-Elaborabile-Spese-Capitolo.csv";
const EXPECTED_ASSET_SHA256 = "2887db4905d30445abc795083f2861f969173baf235a56917932c9fcc242e368";
const EXPECTED_DATA_SHA256 = "86280974963c227e66cfcebab6849b54fa1edfccf67de9e15ed076290cd86028";

export function validateRgsMinistriesSnapshot(data: RgsMinistriesData, metadata: RgsMinistriesMetadata) {
  invariant(data.schemaVersion === 1 && metadata.schemaVersion === 1, "versione inattesa");
  invariant(
    data.referenceYear === 2025 && data.period.kind === "consuntivo" && data.period.year === 2025 &&
      data.accountingFrame === "competenza" && data.unit === "EUR" && data.valueEncoding === "integer_cents",
    "periodo, frame o unità inattesi",
  );
  invariant(data.ministries.length === 15 && data.coverage.ministries === 15, "copertura amministrazioni inattesa");
  invariant(
    data.coverage.sourceRows === 5395 && data.coverage.includedRows === 5395 &&
      data.coverage.rowsReconciled === 5395 && data.coverage.headers === 41,
    "schema o righe inattesi",
  );
  invariant(
    new Set(data.ministries.map((item) => item.code)).size === EXPECTED_MINISTRIES.size &&
      data.ministries.every((item) => EXPECTED_MINISTRIES.get(item.code) === item.label),
    "identità amministrazioni inattese",
  );
  invariant(Object.values(data.totals).every(money), "totali monetari non validi");
  const moneyFields = [
    "commitmentsCpCents",
    "paymentsCompetenceCpCents",
    "paymentsResidualRsCents",
    "paymentsCashCsCents",
    "remainingCpCents",
    "remainingRsCents",
    "residualsEndCents",
  ] as const;
  invariant(
    data.ministries.every((ministry) =>
      ministry.label.trim() && moneyFields.every((field) => money(ministry[field]))),
    "riga Ministero incompleta",
  );
  invariant(
    moneyFields.every((field) =>
      data.ministries.reduce((sum, ministry) => sum + ministry[field], 0) === data.totals[field]),
    "totali Ministeri non riconciliati",
  );
  invariant(
    data.ministries.every((ministry) =>
      ministry.missions.length > 0 &&
      new Map(ministry.missions.map((mission) => [mission.code, mission.label])).size === ministry.missions.length &&
      ministry.missions.every((mission) =>
        mission.code && mission.label && money(mission.commitmentsCpCents) &&
        money(mission.paymentsCompetenceCpCents) && money(mission.remainingCpCents) &&
        mission.commitmentsCpCents === mission.paymentsCompetenceCpCents + mission.remainingCpCents) &&
      ministry.missions.reduce((sum, mission) => sum + mission.commitmentsCpCents, 0) === ministry.commitmentsCpCents &&
      ministry.missions.reduce((sum, mission) => sum + mission.paymentsCompetenceCpCents, 0) === ministry.paymentsCompetenceCpCents &&
      ministry.missions.reduce((sum, mission) => sum + mission.remainingCpCents, 0) === ministry.remainingCpCents),
    "missioni non riconciliate",
  );
  invariant(data.totals.paymentsCashCsCents === data.totals.paymentsCompetenceCpCents + data.totals.paymentsResidualRsCents, "pagamenti CS non riconciliati");
  invariant(data.totals.commitmentsCpCents === data.totals.paymentsCompetenceCpCents + data.totals.remainingCpCents, "impegni CP non riconciliati");
  invariant(data.totals.residualsEndCents === data.totals.remainingCpCents + data.totals.remainingRsCents, "residui finali non riconciliati");
  invariant(
    data.definitions.remainingCp ===
      "Rimasto da pagare CP: voce RGS che completa il Totale CP; non è un totale di cassa e, da sola, non misura un debito da pagare." &&
      data.definitions.economiesGreaterExpensesCp ===
      "importo di competenza rimasto inutilizzato rispetto alle previsioni o utilizzato oltre i limiti.",
    "definizioni contabili inattese",
  );
  invariant(
    metadata.source.owner === "Ragioneria Generale dello Stato" &&
      metadata.source.sourceRecordId === "2025_RND_SPE_ELB_CAP_001" &&
      metadata.source.referencePeriod === "2025" && metadata.source.createdAt === "2026-05-28" &&
      metadata.source.updatedAt === "2026-07-14",
    "identità o date sorgente inattese",
  );
  invariant(metadata.source.landingUrl === EXPECTED_LANDING_URL, "landing non ufficiale");
  invariant(metadata.source.resourceUrl === EXPECTED_RESOURCE_URL, "risorsa non ufficiale");
  invariant(metadata.source.licenseStatus === "declared" && metadata.source.licenseName === "CC BY 3.0", "licenza inattesa");
  invariant(
    metadata.asset.bytes === 4196648 && metadata.asset.sha256 === EXPECTED_ASSET_SHA256 &&
      metadata.asset.encoding === "cp1252" && metadata.asset.delimiter === ";",
    "asset non valido",
  );
  invariant(
    metadata.dataArtifact.path === "src/data/generated/rgs-ministries-2025.data.json" &&
      metadata.dataArtifact.bytes === 25183 && metadata.dataArtifact.sha256 === EXPECTED_DATA_SHA256,
    "artefatto dati inatteso",
  );
  invariant(metadata.transformation.version === 1 && metadata.transformation.description.trim(), "trasformazione assente");
  return { data, metadata };
}
