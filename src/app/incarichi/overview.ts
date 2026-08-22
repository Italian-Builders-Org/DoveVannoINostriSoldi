import type { ConsulentiSnapshot } from "../../lib/data/consulenti-contract";

export const INCARICHI_OVERVIEW_YEARS = [2023, 2024, 2025, 2026] as const;
export const INCARICHI_OVERVIEW_DATASET = "Consulenti Pubblici · statistiche nazionali degli incarichi";
export const INCARICHI_OVERVIEW_REUSE_TERMS =
  "Riuso consentito con attribuzione e licenza identica o equivalente";

export function assertIncarichiOverviewScope(snapshot: ConsulentiSnapshot): ConsulentiSnapshot {
  const externalYears = snapshot.externalAppointments.map((item) => item.year);
  const employeeYears = snapshot.employeeAppointments.map((item) => item.year);
  const expectedYears = [...INCARICHI_OVERVIEW_YEARS];
  const matchesExpectedYears = (years: number[]) =>
    years.length === expectedYears.length &&
    years.every((year, index) => year === expectedYears[index]);

  if (!matchesExpectedYears(externalYears) || !matchesExpectedYears(employeeYears)) {
    throw new Error("incarichi: copertura annuale 2023-2026 inattesa");
  }
  if (snapshot.latestYear !== INCARICHI_OVERVIEW_YEARS.at(-1)) {
    throw new Error("incarichi: ultimo anno 2026 atteso");
  }
  if (snapshot.source.owner !== "Dipartimento della Funzione Pubblica") {
    throw new Error("incarichi: titolare DFP inatteso");
  }
  if (snapshot.source.dataset !== INCARICHI_OVERVIEW_DATASET) {
    throw new Error("incarichi: dataset DFP inatteso");
  }
  if (snapshot.source.reuseTerms !== INCARICHI_OVERVIEW_REUSE_TERMS) {
    throw new Error("incarichi: condizioni di riuso inattese");
  }

  return snapshot;
}
