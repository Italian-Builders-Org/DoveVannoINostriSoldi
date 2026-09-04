import "server-only";

import type { CompanyAtlasSource } from "@/lib/company-atlas-contract";

/**
 * Lightweight source metadata for pages that do not need the observations.
 *
 * Keep this artifact in sync with the source entries in the generated atlas
 * snapshot. It is deliberately separate from `company-atlas.ts`: the sources
 * page should not parse or validate the multi-megabyte observations artifact
 * just to render provenance links. The parity gate in
 * `tests/company-atlas-performance.test.mjs` is registered with the atlas
 * artifact checks so a refresh cannot silently leave this metadata stale.
 */
export const companyAtlasSources = {
  "active-stock": {
    id: "active-stock",
    label: "Imprese attive · stock mensile",
    url: "https://opendata.marche.camcom.it/data/Stock-Imprese-Attive-Italia.json",
    publisher: "CCIAA Marche su dati InfoCamere",
    license: "CC BY 4.0",
    updatedAt: "2026-08-11",
    observedAt: "2026-08-26T00:00:00+02:00",
    cadence: "mensile",
    coverage: "Sedi di impresa attive per regione, settore ATECO 2025 e mese; ultimo periodo 31/07/2026.",
    caveat: "Conta sedi di impresa attive, non ricavi e non gruppi societari.",
  },
  workforce: {
    id: "workforce",
    label: "Addetti e localizzazioni attive · trimestre",
    url: "https://opendata.marche.camcom.it/data/2026-Q2-Addetti-Localizzazioni-Attive-Italia.csv",
    publisher: "CCIAA Marche su dati InfoCamere",
    license: "CC BY 4.0",
    updatedAt: "2026-08-04",
    observedAt: "2026-08-26T00:00:00+02:00",
    cadence: "trimestrale",
    coverage: "Tutte le righe sono bucket ATECO osservati distinti; la pipeline somma i bucket provinciali a regione × sezione ATECO senza scartare i livelli più specifici.",
    caveat: "Le posizioni previdenziali attive sono conteggiate nel trimestre precedente a quello indicato, a partire dalla fornitura INPS: il dato non rappresenta il livello di occupazione nel territorio e non è direttamente comparabile con ISTAT/ASIA. Le localizzazioni attive comprendono sedi di impresa e unità locali non cessate.",
  },
  "production-value": {
    id: "production-value",
    label: "Fasce di valore della produzione · bilanci",
    url: "https://opendata.marche.camcom.it/data/Stock-Imprese-Attive-Italia-Valore-Produzione.json",
    publisher: "CCIAA Marche su dati InfoCamere",
    license: "CC BY 4.0",
    updatedAt: "2026-01-23",
    observedAt: "2026-08-26T00:00:00+02:00",
    cadence: "annuale",
    coverage: "Numero di sedi attive obbligate al deposito del bilancio per fascia, regione e settore; periodo 31/12/2025.",
    caveat: "Il valore della produzione non è fatturato o ricavi esatti; la fonte lo deriva dai bilanci depositati.",
  },
} as const satisfies Record<CompanyAtlasSource["id"], CompanyAtlasSource>;


export const companyAtlasSourceList: readonly CompanyAtlasSource[] = Object.freeze(Object.values(companyAtlasSources));
