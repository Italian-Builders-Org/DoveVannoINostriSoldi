/** Italian labels for published Eurostat COFOG level-II groups (gov_10a_exp). */
export const EUROSTAT_COFOG_DETAIL_LABELS = {
  GF0101: "Organi esecutivi e legislativi, affari finanziari e fiscali, affari esteri",
  GF0102: "Aiuti economici all’estero",
  GF0103: "Servizi generali",
  GF0104: "Ricerca di base",
  GF0105: "R&S nei servizi generali",
  GF0106: "Altri servizi generali",
  GF0107: "Operazioni sul debito pubblico",
  GF0108: "Trasferimenti generali tra livelli di governo",
  GF0201: "Difesa militare",
  GF0202: "Difesa civile",
  GF0203: "Aiuti militari all’estero",
  GF0204: "R&S Difesa",
  GF0205: "Altre spese per la difesa",
  GF0301: "Servizi di polizia",
  GF0302: "Servizi antincendio",
  GF0303: "Tribunali",
  GF0304: "Carceri",
  GF0305: "R&S Ordine pubblico e sicurezza",
  GF0306: "Altre spese per ordine pubblico e sicurezza",
  GF0801: "Servizi ricreativi e sportivi",
  GF0802: "Servizi culturali",
  GF0803: "Radiodiffusione ed editoria",
  GF0804: "Servizi religiosi e altre comunità",
  GF0805: "R&S Ricreazione, cultura e culto",
  GF0806: "Altre spese per ricreazione, cultura e culto",
} as const;

export type EurostatCofogDetailLabelCode = keyof typeof EUROSTAT_COFOG_DETAIL_LABELS;

export function shareOfParentBasisPoints(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    throw new Error("Denominatore COFOG non valido per la quota sul parent.");
  }
  return Number((BigInt(numerator) * BigInt(10_000) + BigInt(denominator) / BigInt(2)) / BigInt(denominator));
}
