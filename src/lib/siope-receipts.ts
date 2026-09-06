import "server-only";

import summary2024 from "@/data/generated/siope-municipal-receipts-2024.json";
import summary2025 from "@/data/generated/siope-municipal-receipts-2025.json";
import summary2026 from "@/data/generated/siope-municipal-receipts-2026.json";
import detail2024 from "@/data/generated/siope-municipal-receipts-detail-2024.json";
import detail2025 from "@/data/generated/siope-municipal-receipts-detail-2025.json";
import detail2026 from "@/data/generated/siope-municipal-receipts-detail-2026.json";
import {
  siopeReceiptsPeriod,
  validateSiopeReceiptsArtifacts,
  type SiopeMunicipalReceiptsDetail,
  type SiopeMunicipalReceiptsSnapshot,
} from "@/lib/data/siope-receipts-contract";
import { getSiopeMunicipalSnapshot } from "@/lib/siope-snapshot";
import { getSiopeMunicipalityDetail } from "@/lib/siope-municipality-detail";
import { eurosPerSquareKilometreCents, getMunicipalityGeographyByTaxCodeIfNameAgrees } from "@/lib/municipality-geography";
import { formatRegionNotFoundError, resolveCanonicalRegionName } from "@/lib/region-query";

export type { SiopeMunicipalReceiptsSnapshot, SiopeReceiptsPeriod } from "@/lib/data/siope-receipts-contract";
export const availableSiopeReceiptsYears: readonly number[] = [2026, 2025, 2024];
const artifacts = new Map([
  [2026, validateSiopeReceiptsArtifacts(summary2026, detail2026, 2026)],
  [2025, validateSiopeReceiptsArtifacts(summary2025, detail2025, 2025)],
  [2024, validateSiopeReceiptsArtifacts(summary2024, detail2024, 2024)],
]);

export const SIOPE_RECEIPTS_CAVEATS = [
  "Incassi di cassa SIOPE dei soli Comuni: non accertamenti né entrate di competenza.",
  "Il 2026 può essere parziale; il periodo indica l’ultimo mese osservato, non un anno intero garantito.",
  "Gli aggregati regionali seguono la sede IPA, non il luogo in cui il denaro è stato raccolto; gli incassi senza Regione restano nel nazionale.",
  "I valori pro capite usano la popolazione dell’anagrafica SIOPE, con data di riferimento non dichiarata; i valori per km² usano la superficie ISTAT abbinata per codice fiscale.",
  "Entrate e uscite sono flussi di cassa distinti. Nessun saldo di bilancio, residuo fiscale o ranking di efficienza o spreco viene calcolato.",
  "Le somme nazionali includono trasferimenti fra enti e partite di giro: non sono entrate consolidate della PA né pressione fiscale.",
  "national resta il contesto nazionale anche con filtri; selection descrive tutti i Comuni selezionati, non soltanto la pagina restituita. Gli importi nazionali sono in euro, i campi con suffisso Cents in centesimi.",
] as const;

function artifactFor(year: number) {
  const artifact = artifacts.get(year);
  if (!artifact) throw new Error(`Anno SIOPE entrate non disponibile. Anni validi: ${availableSiopeReceiptsYears.join(", ")}.`);
  return artifact;
}
export function getSiopeMunicipalReceiptsSnapshot(year = availableSiopeReceiptsYears[0]): SiopeMunicipalReceiptsSnapshot {
  return artifactFor(year).snapshot;
}

export type SiopeMunicipalityReceipts = {
  taxCode: string;
  codiceIpa: string | null;
  name: string;
  province: string;
  region: string | null;
  population: number | null;
  totalCents: number | null;
  perCapitaCents: number | null;
  perSquareKmCents: number | null;
  titles: readonly { code: string; label: string; amountCents: number }[];
};
type PackedRow = SiopeMunicipalReceiptsDetail["municipalities"][number];
function municipality(row: PackedRow, detail: SiopeMunicipalReceiptsDetail): SiopeMunicipalityReceipts {
  const geography = getMunicipalityGeographyByTaxCodeIfNameAgrees(detail.year, row[0], row[2]);
  return {
    taxCode: row[0], codiceIpa: row[1], name: row[2], province: row[3], region: row[4], population: row[5],
    totalCents: row[6],
    perCapitaCents: row[6] !== null && row[5] !== null ? Math.round(row[6] / row[5]) : null,
    perSquareKmCents: eurosPerSquareKilometreCents(row[6], geography?.surfaceSquareMetres ?? null),
    titles: row[7]?.map((amountCents, index) => ({
      code: detail.titleOrder[index], label: detail.titleLabels[detail.titleOrder[index]], amountCents,
    })) ?? [],
  };
}

export function getSiopeMunicipalityReceipts(taxCode: string, year = availableSiopeReceiptsYears[0]): SiopeMunicipalityReceipts | null {
  const { detail } = artifactFor(year);
  const row = detail.municipalities.find((item) => item[0] === taxCode.trim());
  return row ? municipality(row, detail) : null;
}

export type SiopeReceiptsQuery = {
  year?: number;
  region?: string;
  code?: string;
  query?: string;
  limit?: number;
  offset?: number;
};
function bounded(value: number | undefined, fallback: number, min: number, max: number, field: string) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${field}: intero tra ${min} e ${max} richiesto.`);
  return value;
}
function filterText(value: string | undefined, field: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) {
    throw new Error(`${field}: testo non vuoto di massimo 120 caratteri richiesto.`);
  }
  return value.trim();
}
function nameKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it-IT");
}

export function querySiopeMunicipalReceipts(query: SiopeReceiptsQuery = {}) {
  const { snapshot: national, detail } = artifactFor(query.year ?? availableSiopeReceiptsYears[0]);
  const limit = bounded(query.limit, 50, 1, 100, "limit");
  const offset = bounded(query.offset, 0, 0, 100_000, "offset");
  const regionInput = filterText(query.region, "region");
  const region = regionInput === null ? null : resolveCanonicalRegionName(regionInput);
  if (regionInput && region === null) throw new Error(formatRegionNotFoundError(regionInput));
  const code = filterText(query.code, "code");
  if (code !== null && !/^[A-Za-z0-9_]+$/.test(code)) throw new Error("code: codice fiscale o Codice IPA non valido.");
  const name = filterText(query.query, "query");
  const selected = detail.municipalities.filter((row) =>
    (region === null || row[4] === region) &&
    (code === null || row[0] === code || row[1] === code) &&
    (name === null || nameKey(row[2]).includes(nameKey(name))));
  const observed = selected.filter((row) => row[6] !== null);
  const municipalities = selected.slice(offset, offset + limit).map((row) => municipality(row, detail));
  return {
    dataset: "siope_entrate_comuni" as const,
    national,
    period: siopeReceiptsPeriod(national),
    municipalities,
    pagination: { total: selected.length, limit, offset, returned: municipalities.length },
    filters: { region, code, query: name },
    selection: {
      municipalities: selected.length,
      withMovements: observed.length,
      totalCents: observed.length ? observed.reduce((total, row) => {
        const value = total + row[6]!;
        if (!Number.isSafeInteger(value)) throw new Error("Totale selezionato fuori intervallo sicuro.");
        return value;
      }, 0) : null,
    },
    caveats: SIOPE_RECEIPTS_CAVEATS,
  };
}

export function areSiopeCashPeriodsComparable(
  receipts: Pick<SiopeMunicipalReceiptsSnapshot, "year" | "latestMonth" | "generatedAt" | "source">,
  payments: { year: number; latestMonth: number; generatedAt: string; source: { siopeMovementsLastModified: string | null; siopeRegistrySha256: string; ipaSha256: string } },
): boolean {
  if (receipts.year !== payments.year || receipts.latestMonth !== payments.latestMonth) return false;
  const receiptCompleteness = siopeReceiptsPeriod(receipts).completeness;
  const paymentCompleteness = siopeReceiptsPeriod(payments).completeness;
  if (receiptCompleteness !== paymentCompleteness) return false;
  if (receiptCompleteness === "complete") return true;
  // A running month is comparable only within the same official release and registry join.
  const receiptDate = receipts.source.siopeMovementsLastModified;
  const paymentDate = payments.source.siopeMovementsLastModified;
  return receiptDate !== null && paymentDate !== null && Date.parse(receiptDate) === Date.parse(paymentDate) &&
    receipts.source.siopeRegistrySha256 === payments.source.siopeRegistrySha256 && receipts.source.ipaSha256 === payments.source.ipaSha256;
}

export function getSiopeMunicipalityCashComparison(taxCode: string, year: number) {
  const snapshot = getSiopeMunicipalReceiptsSnapshot(year);
  const receipts = getSiopeMunicipalityReceipts(taxCode, year);
  const paymentSnapshot = getSiopeMunicipalSnapshot(year);
  const payment = getSiopeMunicipalityDetail(taxCode)?.years.find((row) => row.year === year);
  const aligned = areSiopeCashPeriodsComparable(snapshot, paymentSnapshot);
  const comparable = aligned && receipts?.totalCents != null && payment?.totalCents != null;
  return {
    receipts,
    paymentsCents: comparable ? payment.totalCents : null,
    comparable,
    reason: comparable ? null : aligned
      ? "Incassi o pagamenti non osservati per questo Comune: l’assenza non è uno zero."
      : "Periodi o rilasci SIOPE non allineati: i pagamenti non vengono affiancati agli incassi.",
    period: siopeReceiptsPeriod(snapshot),
  };
}
