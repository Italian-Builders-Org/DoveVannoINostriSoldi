import sourceFileManifest from "@/data/generated/education-atlas-source-files.json";
import {
  validateEducationAtlasSourceFileManifest,
  type EducationAtlasSource,
} from "@/lib/education-atlas-contract";

/**
 * Provenance-only view used by the MCP catalog and source pages. Keep the
 * observations out of this module so catalog rendering does not parse the
 * multi-megabyte education snapshot.
 */
export const educationAtlasSources = {
  students: {
    id: "students",
    label: "Studenti della scuola secondaria di II grado per percorso e indirizzo",
    url: "https://dati.istruzione.it/opendata/opendata/catalogo/elements1/ALUSECGRADOINDSTA20242520250831.csv",
    landingUrl: "https://dati.istruzione.it/opendata/opendata/catalogo/elements1/?area=Studenti",
    publisher: "Ministero dell'Istruzione e del Merito",
    license: "IODL 2.0",
    licenseUrl: "http://www.dati.gov.it/iodl/2.0/",
    publishedAt: "2026-02-23",
    latestDataAsOf: "2025-08-31",
    observedAt: "2026-08-27T00:00:00+02:00",
    verifiedAt: "2026-08-27T00:00:00+02:00",
    cadence: "annuale",
    coverage: "Scuola secondaria di II grado; anno scolastico, tipo percorso, percorso, indirizzo e genere; statali e paritarie per il triennio 2022/23-2024/25.",
    caveat: "Il numero di studenti descrive la presenza nel file MIM e non misura qualità, esiti, domanda futura o disponibilità di lavoro.",
  },
  registry: {
    id: "registry",
    label: "Anagrafe delle scuole",
    url: "https://dati.istruzione.it/opendata/opendata/catalogo/elements1/SCUANAGRAFESTAT20242520250831.csv",
    landingUrl: "https://dati.istruzione.it/opendata/opendata/catalogo/elements1/?area=Scuole",
    publisher: "Ministero dell'Istruzione e del Merito",
    license: "IODL 2.0",
    licenseUrl: "http://www.dati.gov.it/iodl/2.0/",
    publishedAt: "2026-06-18",
    latestDataAsOf: "2025-08-31",
    observedAt: "2026-08-27T00:00:00+02:00",
    verifiedAt: "2026-08-27T00:00:00+02:00",
    cadence: "annuale",
    coverage: "Anagrafe delle sedi scolastiche usata per collegare i codici scuola ai territori senza pubblicare il dettaglio nominativo nel prodotto.",
    caveat: "Il join territoriale è tecnico: non rende comparabili automaticamente qualità, dotazioni o risultati delle scuole.",
  },
} as const satisfies Record<"students" | "registry", EducationAtlasSource>;

export const educationAtlasSourceList: readonly EducationAtlasSource[] = Object.freeze(
  Object.values(educationAtlasSources),
);

export const educationAtlasSourceFileManifest = validateEducationAtlasSourceFileManifest(sourceFileManifest);
export const educationAtlasSourceFiles = educationAtlasSourceFileManifest.files;

const periodLabels = new Map([
  ["202223", "2022/23"],
  ["202324", "2023/24"],
  ["202425", "2024/25"],
]);
const schoolTypeLabels = new Map([
  ["state", "statali"],
  ["paritaria", "paritarie"],
]);

export const educationAtlasCatalogSources = Object.freeze(
  educationAtlasSourceFiles.map((file) => {
    const source = educationAtlasSources[file.role];
    return {
      id: `mim-${file.role}-${file.schoolType}-${file.period}`,
      name: `${source.label} · ${schoolTypeLabels.get(file.schoolType)} · anno ${periodLabels.get(file.period)} · ${file.role}`,
      owner: source.publisher,
      url: file.url,
      cadence: source.cadence,
      license: source.license,
      licenseUrl: source.licenseUrl,
      publishedAt: file.publishedAt,
      dataAsOf: file.dataAsOf,
      period: file.period,
      schoolType: file.schoolType,
      role: file.role,
      sha256: file.sha256,
      bytes: file.bytes,
      rows: file.rows,
    };
  }),
);
