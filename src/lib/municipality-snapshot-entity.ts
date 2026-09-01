import "server-only";

import type { IpaEntity } from "@/lib/ipa";
import type { SiopeMunicipalityDetail } from "@/lib/siope-municipality-detail";

/**
 * Build the minimal IPA-compatible identity already committed by the SIOPE ETL.
 * No request-time network call is made; absent live-only fields stay null.
 */
export function municipalitySnapshotEntity(detail: SiopeMunicipalityDetail): IpaEntity | null {
  if (!detail.codiceIpa) return null;
  const geography = detail.years.find((year) => year.geography)?.geography ?? null;
  return {
    codiceIpa: detail.codiceIpa,
    denominazione: detail.name,
    codiceFiscale: detail.taxCode,
    tipologia: "Comune",
    codiceCategoria: null,
    codiceNatura: null,
    codiceAteco: null,
    inLiquidazione: null,
    codiceMiur: null,
    codiceIstat: null,
    acronimo: null,
    responsabile: { nome: null, cognome: null, titolo: null },
    sede: {
      codiceComuneIstat: geography?.istatCode ?? null,
      codiceCatastaleComune: null,
      cap: null,
      indirizzo: null,
    },
    email: [],
    sitoIstituzionale: null,
    social: { facebook: null, linkedin: null, twitter: null, youtube: null },
    dataAggiornamento: null,
  };
}
