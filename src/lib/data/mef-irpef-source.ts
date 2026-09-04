import metaJson from "@/data/generated/mef-irpef-2024.meta.json";
import { validateMefIrpefMeta } from "@/lib/data/mef-irpef-contract";

export const mefIrpefSourceMeta = validateMefIrpefMeta(metaJson);

export const MEF_IRPEF_SOURCE = Object.freeze({
  id: "mef-irpef" as const,
  label: "MEF · IRPEF comunale",
  owner: mefIrpefSourceMeta.source.owner,
  sourceUrl: mefIrpefSourceMeta.source.landingUrl,
  allowedHosts: ["www1.finanze.gov.it"] as const,
  policy: {
    cadence: "annuale" as const,
    cadenceNote:
      "Il MEF pubblica annualmente i dati dichiarativi comunali; ogni nuova annualità richiede un source lock e una revisione dello schema.",
    discoveryRevalidateSeconds: 86_400,
    dataRevalidateSeconds: 86_400,
    staleAfterSeconds: null,
    timeoutMs: 20_000,
    maxRetries: 1,
    tags: ["source:mef-irpef", "domain:municipal-tax-statistics"] as const,
  },
  public: {
    name: "MEF · Redditi e IRPEF su base comunale",
    area: "Redditi dichiarati e principali variabili IRPEF",
    cadence: "Annuale, secondo pubblicazione MEF",
    coverage: "7.896 Comuni e una riga non attribuita · anno d’imposta 2024",
    format: "ZIP · CSV · snapshot JSON verificato",
    note:
      "Imposta netta dichiarata, contribuenti, redditi, addizionali, fonti e fasce di reddito. I valori oscurati restano parziali e la riga Mancante/errata non viene distribuita ai territori.",
    joinKeys: ["codice ISTAT Comune", "codice catastale", "anno d’imposta"] as const,
  },
  latestData: {
    kind: "period" as const,
    label: "anno d’imposta 2024 · pubblicato 23/04/2026",
  },
  health: {
    publishedAt: mefIrpefSourceMeta.period.publishedAt,
    recordCount: mefIrpefSourceMeta.coverage.municipalities,
    detail:
      "Snapshot verificato · 7.897 righe fonte, 7.896 Comuni e 1 riga Mancante/errata separata · anno d’imposta 2024",
  },
  mcp: {
    title: "Redditi e IRPEF comunale MEF",
    summary:
      "Contribuenti, redditi, imposta netta dichiarata e addizionali per Comune, Provincia e Regione, con dettaglio opzionale per fonte e fascia di reddito.",
    caveat:
      "È imposta netta dichiarata, non gettito fiscale totale. Le fonti di reddito possono sovrapporsi; i valori oscurati restano parziali e non vanno sottratti alla spesa o al saldo CPT.",
  },
});
