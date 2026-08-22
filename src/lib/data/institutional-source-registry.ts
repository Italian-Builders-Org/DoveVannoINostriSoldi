export type InstitutionalSourceReadiness =
  | "verified-data"
  | "metadata-only"
  | "pending-download-validation";

export type InstitutionalSourceRegistryEntry = {
  id: string;
  domain: "parliament" | "presidency" | "ministry" | "region";
  subjectId: string;
  owner: string;
  title: string;
  sourceRecordId: string;
  referencePeriod: string;
  sourceUrl: string;
  downloadUrl: string | null;
  assetId: string | null;
  format: "html" | "pdf" | "csv" | "xlsx";
  expectedSchema: { fieldCount: number; rowCount: number } | null;
  createdAt: string | null;
  updatedAt: string | null;
  licenseStatus: "declared" | "not-declared";
  licenseName: string | null;
  readiness: InstitutionalSourceReadiness;
  accountingScope: string;
  safeUse: string;
};

/**
 * Discovery registry for the institutional-spending workstream.
 *
 * An entry identifies an official resource; it does not authorize numeric
 * publication. `pending-download-validation` requires a direct download,
 * checksum and schema check before values can move into a dossier.
 */
export const INSTITUTIONAL_SOURCE_REGISTRY = [
  {
    id: "camera-doc-viii-5-2024",
    domain: "parliament",
    subjectId: "camera",
    owner: "Camera dei deputati",
    title: "Conto consuntivo 2024",
    sourceRecordId: "leg19:categoria-008:doc-viii-5",
    referencePeriod: "2024",
    sourceUrl: "https://www.camera.it/leg19/494?categoria=008&idLegislatura=19&tipologiaDoc=elenco_categoria",
    downloadUrl: "https://documenti.camera.it/apps/commonServices/getDocumento.ashx?categoria=008&doc=INTERO&idLegislatura=19&numero=005&sezione=documentiparlamentari&tipoDoc=pdf",
    assetId: null,
    format: "pdf",
    expectedSchema: null,
    createdAt: "2025-07-08",
    updatedAt: "2025-07-23",
    licenseStatus: "not-declared",
    licenseName: null,
    readiness: "metadata-only",
    accountingScope: "Conto consuntivo dell'istituzione Camera, distinto dal bilancio dello Stato.",
    safeUse: "Metadati, procedura di approvazione e link ufficiale; nessun importo del PDF.",
  },
  {
    id: "senato-doc-viii-5-2024",
    domain: "parliament",
    subjectId: "senato",
    owner: "Senato della Repubblica",
    title: "Rendiconto delle entrate e delle spese 2024",
    sourceRecordId: "52803",
    referencePeriod: "2024",
    sourceUrl: "https://www.senato.it/leggi-e-documenti/attivita-non-legislative/documenti-non-legislativi?documentoId=52803&flagNumerato=1&sottoTipoDoc=0&tipoDoc=2633",
    downloadUrl: "https://www.senato.it/service/PDF/PDFServer/BGT/1487093.pdf",
    assetId: "BGT/1487093",
    format: "pdf",
    expectedSchema: null,
    createdAt: "2025-12-16",
    updatedAt: "2025-12-17",
    licenseStatus: "not-declared",
    licenseName: null,
    readiness: "metadata-only",
    accountingScope: "Rendiconto dell'istituzione Senato; conto del bilancio e conto del patrimonio restano distinti.",
    safeUse: "Metadati, procedura, approvazione e link ufficiale; nessun importo del PDF.",
  },
  {
    id: "pcm-rendiconto-2024",
    domain: "presidency",
    subjectId: "pcm",
    owner: "Presidenza del Consiglio dei ministri",
    title: "Rendiconto 2024",
    sourceRecordId: "pcm:conto-finanziario:2024",
    referencePeriod: "2024",
    sourceUrl: "https://presidenza.governo.it/AmministrazioneTrasparente/Bilanci/BilancioPreventivoConsultivo/ContoFinanziario/2024/index.html",
    downloadUrl: null,
    assetId: null,
    format: "html",
    expectedSchema: null,
    createdAt: "2025-06-10",
    updatedAt: "2025-06-19",
    licenseStatus: "not-declared",
    licenseName: null,
    readiness: "pending-download-validation",
    accountingScope: "Conto finanziario della sola Presidenza del Consiglio.",
    safeUse: "Metadati fino a download, checksum e validazione dello schema XLSX ufficiale.",
  },
  {
    id: "rgs-2025-rnd-spe-elb-cap-001",
    domain: "ministry",
    subjectId: "state-ministries",
    owner: "Ragioneria Generale dello Stato",
    title: "Rendiconto 2025 elaborabile, spese per capitolo",
    sourceRecordId: "2025_RND_SPE_ELB_CAP_001",
    referencePeriod: "2025",
    sourceUrl: "https://bdap-opendata.rgs.mef.gov.it/content/2025-rendiconto-pubblicato-elaborabile-spese-capitolo?metadati=showall",
    downloadUrl: "https://bdap-opendata.rgs.mef.gov.it/sites/all/modules/spodata/metadata/blocks/download.php?_url=https%3A%2F%2Fbdap-opendata.rgs.mef.gov.it%2Fmetadata_download_page%2F35564%2Fcsv%2F5508%2Fdc78d0c0-8d50-4b7a-9a5e-e00516129054%40rgs",
    assetId: "dc78d0c0-8d50-4b7a-9a5e-e00516129054@rgs",
    format: "csv",
    expectedSchema: { fieldCount: 41, rowCount: 5395 },
    createdAt: "2026-05-28",
    updatedAt: "2026-07-14",
    licenseStatus: "not-declared",
    licenseName: null,
    readiness: "pending-download-validation",
    accountingScope: "Rendiconto dello Stato per 15 amministrazioni, distinto da previsioni e pagamenti mensili.",
    safeUse: "Valori solo dopo download, checksum, controllo delle 41 colonne e mappatura esatta delle amministrazioni.",
  },
  {
    id: "rgs-2024-rnd-spe-elb-cap-001",
    domain: "ministry",
    subjectId: "state-ministries",
    owner: "Ragioneria Generale dello Stato",
    title: "Rendiconto 2024 elaborabile, spese per capitolo",
    sourceRecordId: "2024_RND_SPE_ELB_CAP_001",
    referencePeriod: "2024",
    sourceUrl: "https://bdap-opendata.rgs.mef.gov.it/content/2024-rendiconto-pubblicato-elaborabile-spese-capitolo?metadati=showall",
    downloadUrl: "https://bdap-opendata.rgs.mef.gov.it/sites/all/modules/spodata/metadata/blocks/download.php?_url=https%3A%2F%2Fbdap-opendata.rgs.mef.gov.it%2Fmetadata_download_page%2F31685%2Fcsv%2F5188%2F84b327e1-8db8-4207-91f7-4d489d065cc5%40rgs",
    assetId: "84b327e1-8db8-4207-91f7-4d489d065cc5@rgs",
    format: "csv",
    expectedSchema: { fieldCount: 41, rowCount: 5362 },
    createdAt: "2025-05-23",
    updatedAt: "2025-07-14",
    licenseStatus: "not-declared",
    licenseName: null,
    readiness: "pending-download-validation",
    accountingScope: "Rendiconto dello Stato per 15 amministrazioni, distinto da previsioni e pagamenti mensili.",
    safeUse: "Valori solo dopo download, checksum, controllo delle 41 colonne e mappatura esatta delle amministrazioni.",
  },
] as const satisfies readonly InstitutionalSourceRegistryEntry[];
