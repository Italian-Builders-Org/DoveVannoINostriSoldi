import { NextRequest, NextResponse } from "next/server";
import {
  auditClassifications,
  auditMethodology,
  auditReviewedAt,
  auditScenarioBasis,
  auditScenarioAssumptions,
  auditScenarios,
  auditSignals,
  centralScenarioBreakdown,
  getProcurementAvailability,
  getProcurementComparisonForYear,
  parseAuditYearQuery,
  procurementComparison,
  procurementComparisons,
  procurementServicesAndSupplies2025,
} from "@/lib/audit-data";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const area = request.nextUrl.searchParams.get("area")?.trim().toLocaleLowerCase("it-IT");
  const rawYear = request.nextUrl.searchParams.get("anno")?.trim();
  let requestedYear: number | null;
  try {
    requestedYear = parseAuditYearQuery(rawYear ?? null);
  } catch {
    return NextResponse.json(
      { ok: false, error: "L'anno richiesto non è valido." },
      { status: 400 },
    );
  }

  const signals = auditSignals.filter((signal) => {
    if (area && signal.area.toLocaleLowerCase("it-IT") !== area) return false;
    if (rawYear && !signal.referenceDate.startsWith(rawYear)) return false;
    return true;
  });
  return NextResponse.json(
    {
      ok: true,
      reviewedAt: auditReviewedAt,
      filters: { area: area ?? null, year: rawYear ?? null },
      signals,
      classifications: auditClassifications,
      procurementComparison: requestedYear !== null
        ? getProcurementComparisonForYear(requestedYear)
        : procurementComparison,
      procurementComparisons,
      procurementServicesAndSupplies2025,
      procurementAvailability: requestedYear !== null
        ? getProcurementAvailability(requestedYear)
        : getProcurementAvailability(procurementComparison.year),
      policyScenarios: {
        items: auditScenarios,
        centralBreakdown: centralScenarioBreakdown,
        basis: auditScenarioBasis,
        assumptions: auditScenarioAssumptions,
        meaning: auditMethodology.scenarioMeaning,
      },
      methodology: auditMethodology,
    },
    { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } },
  );
}
