import "server-only";

import snapshotJson from "@/data/generated/politici-eurodeputati-it.json";
import {
  parsePoliticiEurodeputatiItSnapshot,
  type PoliticiEurodeputatiItSnapshot,
} from "@/lib/data/politici-eurodeputati-it-contract";

const snapshot = parsePoliticiEurodeputatiItSnapshot(snapshotJson);

export function getPoliticiEurodeputatiItSnapshot(): PoliticiEurodeputatiItSnapshot {
  return snapshot;
}

export type EurodeputatiPageGroup = Readonly<{
  code: string;
  memberCount: number;
  meps: PoliticiEurodeputatiItSnapshot["meps"];
}>;

export type EurodeputatiPageView = Readonly<{
  institution: PoliticiEurodeputatiItSnapshot["institution"];
  period: PoliticiEurodeputatiItSnapshot["period"];
  coverage: PoliticiEurodeputatiItSnapshot["coverage"];
  groups: readonly EurodeputatiPageGroup[];
  source: PoliticiEurodeputatiItSnapshot["source"];
  caveats: PoliticiEurodeputatiItSnapshot["caveats"];
}>;

/** Page view: groups keep EP codes; people stay alphabetical inside each group. */
export function buildEurodeputatiPageView(
  data: PoliticiEurodeputatiItSnapshot = snapshot,
): EurodeputatiPageView {
  const byGroup = new Map<string, PoliticiEurodeputatiItSnapshot["meps"][number][]>();
  for (const mep of data.meps) {
    const bucket = byGroup.get(mep.groupCode) ?? [];
    bucket.push(mep);
    byGroup.set(mep.groupCode, bucket);
  }

  const groups = data.groups.map((group) => {
    const meps = byGroup.get(group.code) ?? [];
    if (meps.length !== group.memberCount) {
      throw new Error(`Gruppo ${group.code}: conteggio pagina diverso dallo snapshot.`);
    }
    return { code: group.code, memberCount: group.memberCount, meps };
  });

  return {
    institution: data.institution,
    period: data.period,
    coverage: data.coverage,
    groups,
    source: data.source,
    caveats: data.caveats,
  };
}
