import rawSnapshot from "@/data/generated/inps-pensions-osservatorio.json";
import {
  validateInpsPensionsOsservatorioSnapshot,
  type InpsPensionsOsservatorioSnapshot,
} from "@/lib/data/inps-pensions-contract";

export const inpsPensionsOsservatorioSnapshot = validateInpsPensionsOsservatorioSnapshot(
  rawSnapshot as InpsPensionsOsservatorioSnapshot,
);

export function queryInpsPensionsOsservatorio() {
  const snapshot = inpsPensionsOsservatorioSnapshot;
  return {
    datasetId: "inps-pensions-osservatorio",
    asOf: snapshot.asOf,
    scope: snapshot.scope,
    stock: snapshot.stock,
    nature: snapshot.nature,
    categories: snapshot.categories,
    managementGroups: snapshot.managementGroups,
    stockSeries: snapshot.stockSeries,
    awardedIn2025: snapshot.awardedIn2025,
    vintageCube: snapshot.vintageCube,
    methodology: snapshot.methodology,
    sources: snapshot.sources,
    caveats: [
      snapshot.methodology.perimeter,
      snapshot.methodology.definitions,
      snapshot.stockSeries.warning,
      snapshot.awardedIn2025.warning,
      snapshot.vintageCube.warning,
      snapshot.methodology.rounding,
    ],
  };
}
