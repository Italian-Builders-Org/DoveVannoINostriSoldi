/** A derived reading of the existing COFOG corpus, never a second data source. */
export type SpendingObservation = Readonly<{
  geo: string; year: number; function: string; amountCents: number;
  shareOfGdpHundredths: number; flag?: string;
}>;
export const SPENDING_FUNCTIONS = [
  ["GF01", "Servizi generali delle amministrazioni pubbliche"],
  ["GF02", "Difesa"], ["GF03", "Ordine pubblico e sicurezza"],
  ["GF04", "Affari economici e trasporti"], ["GF05", "Protezione dell'ambiente"],
  ["GF06", "Abitazioni e assetto del territorio"], ["GF07", "Sanità"],
  ["GF08", "Cultura, ricreazione e religione"], ["GF09", "Istruzione"],
  ["GF10", "Protezione sociale"],
] as const;

export type SpendingOverviewOptions = Readonly<{
  year: number; baselineYear: number; toleranceCents: number;
}>;

function safeMoney(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Importo COFOG assente, negativo o non rappresentabile in centesimi esatti.");
  }
}

export function buildPublicSpendingOverview(
  observations: readonly SpendingObservation[], options: SpendingOverviewOptions,
) {
  const { year, baselineYear, toleranceCents } = options;
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(baselineYear) || baselineYear >= year) {
    throw new Error("Periodo di confronto non valido.");
  }
  safeMoney(toleranceCents);
  const pick = (geo: string, code: string, period: number, required = true) => {
    const found = observations.filter((r) => r.geo === geo && r.function === code && r.year === period);
    if (found.length === 0 && !required) return null;
    if (found.length !== 1) throw new Error(`Cella COFOG mancante o duplicata: ${geo}/${code}/${period}.`);
    const row = found[0];
    safeMoney(row.amountCents);
    if (!Number.isSafeInteger(row.shareOfGdpHundredths) || row.shareOfGdpHundredths < 0) {
      throw new Error(`Quota sul PIL non valida: ${geo}/${code}/${period}.`);
    }
    return row;
  };
  const total = pick("IT", "TOTAL", year)!;
  if (total.amountCents === 0) throw new Error("Totale ufficiale nullo: quote non calcolabili.");
  const rows = SPENDING_FUNCTIONS.map(([code, label]) => {
    const current = pick("IT", code, year)!;
    const baseline = pick("IT", code, baselineYear, false);
    const eu = pick("EU27_2020", code, year, false);
    const breakInSeries = observations.some((r) => r.geo === "IT" && r.function === code
      && r.year > baselineYear && r.year <= year && r.flag?.includes("b"));
    const reason = !baseline ? "Baseline non disponibile" : breakInSeries
      ? "Interruzione della serie nel periodo" : baseline.amountCents === 0
        ? "Baseline nulla: variazione percentuale non definita" : null;
    const changeCents = baseline && !breakInSeries ? current.amountCents - baseline.amountCents : null;
    return {
      code, label, amountCents: current.amountCents,
      shareOfTotalPercent: current.amountCents / total.amountCents * 100,
      shareOfGdpHundredths: current.shareOfGdpHundredths,
      baselineAmountCents: baseline?.amountCents ?? null,
      changeCents, changePercent: reason === null && baseline
        ? (current.amountCents - baseline.amountCents) / baseline.amountCents * 100 : null,
      comparisonLimit: reason,
      euShareOfGdpHundredths: eu?.shareOfGdpHundredths ?? null,
      gapWithEuPercentagePoints: eu
        ? (current.shareOfGdpHundredths - eu.shareOfGdpHundredths) / 100 : null,
      flag: current.flag ?? null, euFlag: eu?.flag ?? null,
    };
  });
  const sum = rows.reduce((n, r) => n + BigInt(r.amountCents), 0n);
  const gap = sum - BigInt(total.amountCents);
  if ((gap < 0n ? -gap : gap) > BigInt(toleranceCents)) {
    throw new Error("Le dieci funzioni non riconciliano con il totale ufficiale entro la tolleranza del corpus.");
  }
  return {
    year, baselineYear, geo: "IT", sector: "S13", accountingBasis: "SEC 2010, competenza economica",
    totalAmountCents: total.amountCents, totalShareOfGdpHundredths: total.shareOfGdpHundredths,
    totalFlag: total.flag ?? null, reconciliationGapCents: Number(gap), toleranceCents,
    coveredFunctions: rows.length, rows,
  };
}
