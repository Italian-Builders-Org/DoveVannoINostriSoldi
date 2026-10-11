import rawSnapshot from "@/data/generated/inps-casellario-sistema.json";
import {
  validateInpsCasellarioSistemaSnapshot,
  type InpsCasellarioSistemaSnapshot,
} from "@/lib/data/inps-casellario-sistema-contract";

export const inpsCasellarioSistemaSnapshot = validateInpsCasellarioSistemaSnapshot(
  rawSnapshot as InpsCasellarioSistemaSnapshot,
);

export function queryInpsCasellarioSistema() {
  const snapshot = inpsCasellarioSistemaSnapshot;
  return {
    datasetId: "inps-casellario-sistema",
    asOf: snapshot.asOf,
    scope: snapshot.scope,
    stock: snapshot.stock,
    series: snapshot.series,
    natureShares: snapshot.natureShares,
    gender: snapshot.gender,
    methodology: snapshot.methodology,
    sources: snapshot.sources,
    caveats: snapshot.caveats,
  };
}
