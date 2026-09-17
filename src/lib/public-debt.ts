import snapshotJson from "@/data/generated/public-debt.json";
import { parsePublicDebtSnapshot, type PublicDebtSnapshot } from "@/lib/data/public-debt-contract";

const DAY = 86_400_000;
let cachedSnapshot: PublicDebtSnapshot | undefined;

export class PublicDebtContractError extends Error {
  constructor(cause: unknown) {
    super("Lo snapshot del debito pubblico non supera il contratto dati", { cause });
    this.name = "PublicDebtContractError";
  }
}

export function getPublicDebtSnapshot(): PublicDebtSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  try {
    cachedSnapshot = parsePublicDebtSnapshot(snapshotJson);
    return cachedSnapshot;
  } catch (error) {
    throw new PublicDebtContractError(error);
  }
}

function shareBasisPoints(numerator: number, denominator: number) {
  return Number((BigInt(numerator) * BigInt(10_000) + BigInt(denominator) / BigInt(2)) / BigInt(denominator));
}

function freshness(referenceDate: string, staleDays: number, now: Date) {
  const ageDays = Math.floor((now.getTime() - Date.parse(`${referenceDate}T00:00:00Z`)) / DAY);
  return { state: ageDays > staleDays ? "stale" as const : "fresh" as const, ageDays, staleAfterDays: staleDays };
}

export function getPublicDebtView(now = new Date()) {
  const snapshot = getPublicDebtSnapshot();
  const annualEnd = `${snapshot.annualInterest.referenceYear}-12-31`;
  const instrumentShares = {
    currencyAndDepositsBasisPoints: shareBasisPoints(snapshot.stock.instruments.currencyAndDepositsCents, snapshot.stock.totalCents),
    securitiesBasisPoints: shareBasisPoints(snapshot.stock.instruments.securitiesCents, snapshot.stock.totalCents),
    loansAndOtherLiabilitiesBasisPoints: shareBasisPoints(snapshot.stock.instruments.loansAndOtherLiabilitiesCents, snapshot.stock.totalCents),
  };
  const maturityShares = {
    upToOneYearBasisPoints: shareBasisPoints(snapshot.residualMaturity.upToOneYearCents, snapshot.residualMaturity.totalCents),
    oneToFiveYearsBasisPoints: shareBasisPoints(snapshot.residualMaturity.oneToFiveYearsCents, snapshot.residualMaturity.totalCents),
    overFiveYearsBasisPoints: shareBasisPoints(snapshot.residualMaturity.overFiveYearsCents, snapshot.residualMaturity.totalCents),
  };
  return {
    ok: true as const,
    sources: {
      bancaditalia: {
        owner: snapshot.sources.bancaditalia.owner,
        title: snapshot.sources.bancaditalia.title,
        cadence: snapshot.sources.bancaditalia.cadence,
        landingUrl: snapshot.sources.bancaditalia.landingUrl,
        bdsUrl: snapshot.sources.bancaditalia.bdsUrl,
        termsUrl: snapshot.sources.bancaditalia.termsUrl,
        licenseUrl: snapshot.sources.bancaditalia.termsUrl,
        attribution: "Banca d'Italia, Finanza pubblica: fabbisogno e debito. Serie selezionate adattate da DoveVannoINostriSoldi secondo le condizioni della fonte.",
        retrievedAt: snapshot.sources.bancaditalia.retrievedAt,
        accessedAt: snapshot.sources.bancaditalia.retrievedAt,
      },
      eurostat: {
        owner: snapshot.sources.eurostat.owner,
        title: snapshot.sources.eurostat.title,
        cadence: snapshot.sources.eurostat.cadence,
        datasetUrl: snapshot.sources.eurostat.datasetUrl,
        termsUrl: snapshot.sources.eurostat.termsUrl,
        licenseUrl: snapshot.sources.eurostat.termsUrl,
        attribution: "Eurostat, Government revenue, expenditure and main aggregates. Dati adattati da DoveVannoINostriSoldi.",
        retrievedAt: snapshot.sources.eurostat.retrievedAt,
        accessedAt: snapshot.sources.eurostat.retrievedAt,
        upstreamUpdatedAt: snapshot.sources.eurostat.upstreamUpdatedAt,
      },
    },
    measurement: {
      storedUnit: "centesimi di euro interi" as const,
      bancaditaliaSourceUnit: "milioni di euro" as const,
      eurostatSourceUnit: "milioni di euro" as const,
      transformation: "I valori pubblicati in milioni di euro sono convertiti aritmeticamente in centesimi interi; la conversione non aggiunge precisione alla misura originaria.",
      precisionNote: "Gli importi in euro esposti sono equivalenti convertiti, non misure osservate con precisione al centesimo.",
    },
    stock: { ...snapshot.stock, instrumentShares, freshness: freshness(snapshot.stock.referenceDate, 75, now) },
    change: snapshot.change,
    holders: snapshot.holders,
    residualMaturity: { ...snapshot.residualMaturity, shares: maturityShares },
    citizenImpact: {
      annualInterest: {
        ...snapshot.annualInterest,
        interestChangeCents: snapshot.annualInterest.interestExpenseCents - snapshot.annualInterest.previousInterestExpenseCents,
        interestShareChangeBasisPoints: snapshot.annualInterest.interestShareBasisPoints - snapshot.annualInterest.previousInterestShareBasisPoints,
        euroPerHundredEuro: snapshot.annualInterest.interestShareBasisPoints / 100,
        freshness: freshness(annualEnd, 540, now),
      },
      refinancingExposure: {
        referenceDate: snapshot.residualMaturity.referenceDate,
        upToOneYearCents: snapshot.residualMaturity.upToOneYearCents,
        totalCents: snapshot.residualMaturity.totalCents,
        upToOneYearShareBasisPoints: maturityShares.upToOneYearBasisPoints,
        averageYears: snapshot.residualMaturity.averageYears,
      },
    },
    caveats: snapshot.caveats,
  };
}

export type PublicDebtView = ReturnType<typeof getPublicDebtView>;
