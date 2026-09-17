import metaJson from "@/data/generated/pnrr-childcare.meta.json";
import { assertPnrrChildcareMeta } from "@/lib/data/pnrr-childcare-contract";

export const pnrrChildcareSourceMeta = assertPnrrChildcareMeta(metaJson);

export const PNRR_CHILDCARE_SOURCE = Object.freeze({
  id: "italiadomani" as const,
  label: "Italia Domani · PNRR",
  owner: pnrrChildcareSourceMeta.source.owner,
  sourceUrl: pnrrChildcareSourceMeta.source.landingUrl,
  allowedHosts: ["www.italiadomani.gov.it"] as const,
  policy: {
    cadence: "periodica" as const,
    cadenceNote:
      "Italia Domani pubblica snapshot periodici: ogni variazione dei quattro CSV richiede un nuovo source lock e la riconciliazione dei legami CUP, CIG e procedura.",
    discoveryRevalidateSeconds: 21_600,
    dataRevalidateSeconds: 86_400,
    staleAfterSeconds: null,
    timeoutMs: 60_000,
    maxRetries: 1,
    tags: ["source:italiadomani", "domain:pnrr-projects"] as const,
  },
  public: {
    name: "Italia Domani · progetti PNRR, localizzazioni, gare e aggiudicatari",
    area: "PNRR · asili nido, scuole dell’infanzia e servizi per la prima infanzia",
    cadence: "Periodica, secondo pubblicazione Italia Domani",
    coverage: `${pnrrChildcareSourceMeta.coverage.uniqueProjects.toLocaleString("it-IT")} CUP · ${pnrrChildcareSourceMeta.coverage.tenderRows.toLocaleString("it-IT")} gare`,
    format: "CSV ufficiali · snapshot JSON verificato",
    note:
      "Finanziamenti, localizzazioni, gare e aggiudicatari sono livelli distinti. Il dataset non espone pagamenti ReGiS e due righe aggiudicatario non hanno una chiave gara completa corrispondente.",
    joinKeys: ["CUP", "CIG", "Codice interno PDA", "Codice procedura utente"] as const,
  },
  latestData: { kind: "date" as const, value: pnrrChildcareSourceMeta.referenceDate },
  health: {
    publishedAt: pnrrChildcareSourceMeta.referenceDate,
    recordCount: pnrrChildcareSourceMeta.coverage.uniqueProjects,
    detail: `Dati estratti ${pnrrChildcareSourceMeta.referenceDate} · snapshot verificato ${pnrrChildcareSourceMeta.observedAt.slice(0, 10)} · ${pnrrChildcareSourceMeta.coverage.uniqueProjects.toLocaleString("it-IT")} CUP, ${pnrrChildcareSourceMeta.coverage.locationRows.toLocaleString("it-IT")} localizzazioni, ${pnrrChildcareSourceMeta.coverage.tenderRows.toLocaleString("it-IT")} gare`,
  },
  mcp: {
    title: "PNRR asili e prima infanzia",
    summary: "Progetti Italia Domani per CUP con localizzazioni, quadro finanziario, gare e aggiudicatari collegati.",
    caveat: pnrrChildcareSourceMeta.methodology.fundingWarning,
  },
});
