import type { OecdTaxingWagesGeographyCode } from "@/lib/data/oecd-taxing-wages-contract";
import { oecdTaxingWagesData, oecdTaxingWagesMetadata } from "@/lib/oecd-taxing-wages-snapshot";

const RATE_SCALE = 1_000_000;

const GEO_LABELS_IT: Readonly<Record<OecdTaxingWagesGeographyCode, string>> = {
  ITA: "Italia",
  FRA: "Francia",
  DEU: "Germania",
  ESP: "Spagna",
  OECD_REP: "Media OECD",
};

const COMPONENT_LABELS = [
  {
    key: "incomeTax" as const,
    label: "Imposta sul reddito",
    sourceCode: "AV_ITR",
    field: "incomeTaxMillionths" as const,
  },
  {
    key: "employeeSsc" as const,
    label: "Contributi del lavoratore",
    sourceCode: "AV_R_EMPEE_SSC",
    field: "employeeSscMillionths" as const,
  },
  {
    key: "employerSsc" as const,
    label: "Contributi del datore",
    sourceCode: "AV_R_EMPER_SSC",
    field: "employerSscMillionths" as const,
  },
];

function rate(millionths: number): number {
  return millionths / RATE_SCALE;
}

export function getTaxWedgeView() {
  const latest = oecdTaxingWagesData.italyObservations.at(-1);
  if (!latest) throw new Error("Snapshot OECD Taxing Wages senza osservazioni Italia");

  const history = oecdTaxingWagesData.italyObservations.map((row) => ({
    year: row.year,
    taxWedge: rate(row.taxWedgeMillionths),
    incomeTax: rate(row.incomeTaxMillionths),
    employeeSsc: rate(row.employeeSscMillionths),
    employerSsc: rate(row.employerSscMillionths),
    incomeTaxAndEmployeeSsc: rate(row.incomeTaxAndEmployeeSscMillionths),
    netPersonalAverageTax: rate(row.netPersonalAverageTaxMillionths),
    lowWageTaxWedge: rate(row.lowWageTaxWedgeMillionths),
  }));

  const components = COMPONENT_LABELS.map((item) => {
    const value = rate(latest[item.field]);
    return {
      ...item,
      value,
      // Share of the three published components on the gross-wage base, for the bar only.
      shareOfComponents: value,
    };
  });
  const componentSum = components.reduce((sum, row) => sum + row.value, 0);
  const componentsWithShare = components.map((row) => ({
    ...row,
    barShare: componentSum > 0 ? row.value / componentSum : 0,
  }));

  const comparisonYear = oecdTaxingWagesData.period.peersTo;
  const comparison = oecdTaxingWagesData.geographies.map((geo) => {
    const row = oecdTaxingWagesData.peerObservations.find(
      (observation) => observation.geo === geo.code && observation.year === comparisonYear,
    );
    if (!row) throw new Error(`Confronto OECD senza ${geo.code} ${comparisonYear}`);
    return {
      geo: geo.code,
      label: GEO_LABELS_IT[geo.code],
      kind: geo.kind,
      taxWedge: rate(row.taxWedgeMillionths),
      year: comparisonYear,
    };
  });
  const maxComparison = Math.max(...comparison.map((row) => row.taxWedge), 1);

  return {
    data: oecdTaxingWagesData,
    metadata: oecdTaxingWagesMetadata,
    profile: {
      household: "Persona single senza figli",
      earnings: "100% del salario medio OECD",
      sourceHousehold: oecdTaxingWagesData.profile.householdLabel,
      sourceEarnings: oecdTaxingWagesData.profile.incomePrincipal,
    },
    latest: {
      year: latest.year,
      taxWedge: rate(latest.taxWedgeMillionths),
      incomeTax: rate(latest.incomeTaxMillionths),
      employeeSsc: rate(latest.employeeSscMillionths),
      employerSsc: rate(latest.employerSscMillionths),
      incomeTaxAndEmployeeSsc: rate(latest.incomeTaxAndEmployeeSscMillionths),
      netPersonalAverageTax: rate(latest.netPersonalAverageTaxMillionths),
      lowWageTaxWedge: rate(latest.lowWageTaxWedgeMillionths),
    },
    history,
    components: componentsWithShare,
    comparison,
    maxComparison,
    reconciliationNote: oecdTaxingWagesData.reconciliation.note,
  };
}
