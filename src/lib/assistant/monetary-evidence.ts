import type { SsnCceValues } from "@/lib/data/ssn-cce-contract";
import type { querySsnCce } from "@/lib/ssn-cce-snapshot";
import type { SsnNationalHistory } from "@/lib/ssn-national-history";
import type { IstatCofogQueryResult } from "@/lib/istat-cofog-snapshot";
import type { EurostatCofogQueryResult } from "@/lib/eurostat-cofog-snapshot";

/** Convert only validated integer cents, without floating-point rounding. */
export function centsToEuroEvidence(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("Invalid monetary evidence");
  const cents = BigInt(value);
  const absolute = cents < BigInt(0) ? -cents : cents;
  return `${cents < BigInt(0) ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}

export const EURO_EVIDENCE_NOTE = "Gli importi nei campi *Euros sono già in euro: stringhe decimali esatte, con due cifre dopo il punto. Non convertirli nuovamente da centesimi o milioni. Le note sulla scala originale descrivono soltanto la fonte. Per citare un importo completo mantieni tutte le cifre; per esprimerlo in miliardi dividi gli euro per 1.000.000.000. Misure, copertura e provenienza restano quelle della fonte.";

// Explicit field names: counts, dates, percentages and identifiers are never scaled.
const EURO_FIELDS: Readonly<Record<string, string>> = {
  amountCents: "amountEuros",
  knownAmountCents: "knownAmountEuros",
  toleranceCents: "toleranceEuros",
  maxGapCents: "maxGapEuros",
};

/** Used only on dataset sections whose monetary fields follow this contract. */
export function projectCentFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectCentFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    const euroField = Object.hasOwn(EURO_FIELDS, key) ? EURO_FIELDS[key] : undefined;
    return euroField ? [euroField, centsToEuroEvidence(entry)] : [key, projectCentFields(entry)];
  }));
}

function ssnValues(values: SsnCceValues, missing?: Partial<Record<keyof SsnCceValues, number>>) {
  return Object.fromEntries(Object.entries(values).map(([metric, cents]) => [
    metric,
    missing?.[metric as keyof SsnCceValues] === 1 ? null : centsToEuroEvidence(cents),
  ]));
}

export function projectSsnEvidence(data: ReturnType<typeof querySsnCce>) {
  const { values, ...aggregate } = data.selectedAggregate;
  const { values: nationalValues, ...national } = data.national;
  return {
    ...data,
    selectedAggregate: { ...aggregate, valuesEuros: values === null ? null : ssnValues(values) },
    national: { ...national, valuesEuros: ssnValues(nationalValues) },
    regions: data.regions.map(({ values, ...region }) => ({ ...region, valuesEuros: ssnValues(values) })),
    entities: data.entities.map(({ values, ...entity }) => ({ ...entity, valuesEuros: ssnValues(values, entity.missing) })),
    methodology: { ...data.methodology, amountUnit: "EUR; valori decimali esatti in valuesEuros" },
    chatProjection: {
      monetaryUnit: "EUR",
      caveat: `${EURO_EVIDENCE_NOTE} valuesEuros null indica un dato mancante, anche quando l’artefatto originale usa zero con missing=1. selectedAggregate identifica il livello richiesto; national resta nazionale anche con filtri. Non sommare totale nazionale, regioni ed enti.`,
    },
  };
}

export function projectSsnHistoryEvidence(data: SsnNationalHistory) {
  return {
    ...data,
    years: data.years.map(({ values, ...year }) => ({ ...year, valuesEuros: ssnValues(values) })),
    chatProjection: { monetaryUnit: "EUR", caveat: EURO_EVIDENCE_NOTE },
  };
}

export function projectIstatCofogEvidence(data: IstatCofogQueryResult) {
  return {
    ...data,
    measure: { ...data.measure, unit: "EUR" },
    observations: projectCentFields(data.observations),
    reconciliation: projectCentFields(data.reconciliation),
    chatProjection: { monetaryUnit: "EUR", caveat: EURO_EVIDENCE_NOTE },
  };
}

export function projectEurostatCofogEvidence(data: EurostatCofogQueryResult) {
  return {
    ...data,
    units: { amountEuros: "EUR", shareOfGdpPercent: "percentuale di PIL" },
    observations: data.observations.map(({ amountCents, shareOfGdpHundredths, ...observation }) => ({
      ...observation,
      amountEuros: centsToEuroEvidence(amountCents),
      shareOfGdpPercent: centsToEuroEvidence(shareOfGdpHundredths),
    })),
    reconciliation: projectCentFields(data.reconciliation),
    chatProjection: { monetaryUnit: "EUR", caveat: `${EURO_EVIDENCE_NOTE} shareOfGdpPercent è già una percentuale (6.60 significa 6,60%); i campi di riconciliazione *Hundredths restano centesimi di punto percentuale.` },
  };
}
