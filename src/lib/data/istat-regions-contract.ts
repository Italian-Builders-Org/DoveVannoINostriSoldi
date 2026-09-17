export type RegionalAdministrationStatus = "ordinary" | "special" | "autonomous-province";

export type IstatRegionalAdministration = {
  id: string;
  label: string;
  sourceLabel: string;
  sourceSheet: string;
  status: RegionalAdministrationStatus;
  commitmentsCents: number;
  titles: Array<{ code: string; label: string; commitmentsCents: number }>;
};

export type IstatRegionsData = {
  schemaVersion: 1;
  referenceYear: 2024;
  unit: "euro_cents";
  accountingFrame: "commitments";
  entities: IstatRegionalAdministration[];
  coverage: {
    workbookSheets: 25;
    individualAdministrations: 22;
    ordinaryRegions: 15;
    specialRegions: 5;
    autonomousProvinces: 2;
    entitiesReconciled: 22;
  };
  definitions: Record<string, string>;
};

export type IstatRegionsMetadata = {
  schemaVersion: 1;
  source: {
    owner: "Istat";
    landingUrl: string;
    resourceUrl: string;
    sourceRecordId: "istat:125266";
    referencePeriod: "2024";
    publishedAt: string;
    acquiredAt: string;
    format: "zip+xlsx";
    licenseStatus: "not-declared";
  };
  asset: { bytes: 280471; sha256: string };
  spendingWorkbook: { path: string; bytes: 200402; sha256: string };
  transformation: { version: 1; description: string };
  dataArtifact: { path: string; bytes: number; sha256: string };
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Snapshot Regioni non valido: ${message}`);
}

function money(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

const EXPECTED_ASSET_SHA256 = "ba98c16063bf2bb8b62cd29fbd1dae23eded549faaac2ba06707ac7206ccbb7f";
const EXPECTED_WORKBOOK_SHA256 = "a2b6f7d0de90e7fa8c15fb6d325535cb747f3b5a19b49bcb33dc16d61bc16682";
const EXPECTED_DATA_SHA256 = "03c4b4424167207938558bbc32467678e6cefe295a4d4dd81e777b8a831e7f28";

const EXPECTED_ENTITIES: ReadonlyMap<string, { sourceSheet: string; status: RegionalAdministrationStatus }> = new Map([
  ["piemonte", { sourceSheet: "PIEMONTE", status: "ordinary" }],
  ["liguria", { sourceSheet: "LIGURIA", status: "ordinary" }],
  ["lombardia", { sourceSheet: "LOMBARDIA", status: "ordinary" }],
  ["veneto", { sourceSheet: "VENETO", status: "ordinary" }],
  ["emilia-romagna", { sourceSheet: "EMILIA-ROMAGNA", status: "ordinary" }],
  ["toscana", { sourceSheet: "TOSCANA", status: "ordinary" }],
  ["umbria", { sourceSheet: "UMBRIA", status: "ordinary" }],
  ["marche", { sourceSheet: "MARCHE", status: "ordinary" }],
  ["lazio", { sourceSheet: "LAZIO", status: "ordinary" }],
  ["abruzzo", { sourceSheet: "ABRUZZO", status: "ordinary" }],
  ["molise", { sourceSheet: "MOLISE", status: "ordinary" }],
  ["campania", { sourceSheet: "CAMPANIA", status: "ordinary" }],
  ["puglia", { sourceSheet: "PUGLIA", status: "ordinary" }],
  ["basilicata", { sourceSheet: "BASILICATA", status: "ordinary" }],
  ["calabria", { sourceSheet: "CALABRIA", status: "ordinary" }],
  ["valle-aosta", { sourceSheet: "VALLE D'AOSTA - Vallée d'Aoste", status: "special" }],
  ["trentino-alto-adige", { sourceSheet: "TRENTINO-ALTO ADIGE - Südtirol", status: "special" }],
  ["bolzano", { sourceSheet: "BOLZANO - Bozen", status: "autonomous-province" }],
  ["trento", { sourceSheet: "TRENTO", status: "autonomous-province" }],
  ["friuli-venezia-giulia", { sourceSheet: "FRIULI-VENEZIA GIULIA", status: "special" }],
  ["sicilia", { sourceSheet: "SICILIA", status: "special" }],
  ["sardegna", { sourceSheet: "SARDEGNA", status: "special" }],
]);

export function validateIstatRegionsSnapshot(data: IstatRegionsData, metadata: IstatRegionsMetadata) {
  invariant(data.schemaVersion === 1 && metadata.schemaVersion === 1, "versione inattesa");
  invariant(data.referenceYear === 2024 && data.unit === "euro_cents", "periodo o unità inattesi");
  invariant(data.accountingFrame === "commitments", "fase contabile inattesa");
  invariant(data.entities.length === 22 && new Set(data.entities.map((entity) => entity.id)).size === 22, "copertura amministrazioni inattesa");
  invariant(
    data.coverage.workbookSheets === 25 && data.coverage.individualAdministrations === 22 &&
      data.coverage.ordinaryRegions === 15 && data.coverage.specialRegions === 5 &&
      data.coverage.autonomousProvinces === 2 && data.coverage.entitiesReconciled === 22,
    "copertura workbook inattesa",
  );
  invariant(
    data.entities.every((entity) =>
      EXPECTED_ENTITIES.get(entity.id)?.sourceSheet === entity.sourceSheet &&
      EXPECTED_ENTITIES.get(entity.id)?.status === entity.status &&
      entity.label.trim() && entity.sourceLabel.trim() && entity.sourceSheet.trim() &&
      money(entity.commitmentsCents) && entity.commitmentsCents > 0 &&
      entity.titles.length === 6 && entity.titles.map((title) => title.code).join(",") === "1,2,3,4,5,7" &&
      entity.titles.every((title) => title.label && money(title.commitmentsCents)) &&
      entity.titles.reduce((sum, title) => sum + title.commitmentsCents, 0) === entity.commitmentsCents),
    "identità o Titoli non riconciliati",
  );
  invariant(
    data.entities.filter((entity) => entity.status === "ordinary").length === 15 &&
      data.entities.filter((entity) => entity.status === "special").length === 5 &&
      data.entities.filter((entity) => entity.status === "autonomous-province").length === 2,
    "classificazione statutaria inattesa",
  );
  invariant(metadata.source.owner === "Istat" && metadata.source.sourceRecordId === "istat:125266", "fonte inattesa");
  invariant(metadata.source.landingUrl.startsWith("https://www.istat.it/"), "landing non ufficiale");
  invariant(metadata.source.resourceUrl.startsWith("https://www.istat.it/"), "risorsa non ufficiale");
  invariant(metadata.source.licenseStatus === "not-declared", "licenza non verificata attribuita");
  invariant(metadata.asset.bytes === 280471 && metadata.asset.sha256 === EXPECTED_ASSET_SHA256, "archivio non valido");
  invariant(
    metadata.spendingWorkbook.bytes === 200402 && metadata.spendingWorkbook.sha256 === EXPECTED_WORKBOOK_SHA256,
    "workbook non valido",
  );
  invariant(
    metadata.dataArtifact.path === "src/data/generated/istat-regions-2024.data.json" &&
      metadata.dataArtifact.bytes === 25984 && metadata.dataArtifact.sha256 === EXPECTED_DATA_SHA256,
    "artefatto dati inatteso",
  );
  invariant(metadata.transformation.version === 1 && metadata.transformation.description.trim(), "trasformazione assente");
  return { data, metadata };
}
