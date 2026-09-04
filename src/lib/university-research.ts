import {
  getCommittedBudgetLawMissionSeries,
  selectBudgetLawMission,
} from "@/lib/bdap-legge-bilancio";

// RGS mission taxonomy. The committed AMPMA aggregate uses the exact labels,
// not codes; keep this mapping explicit instead of matching words or ministries.
export const UNIVERSITY_RESEARCH_MISSIONS = [
  {
    code: "023",
    label: "Istruzione universitaria e formazione post-universitaria",
    title: "Università",
    note: "Comprende il sistema universitario, il diritto allo studio e l’alta formazione artistica, musicale e coreutica.",
  },
  {
    code: "017",
    label: "Ricerca e innovazione",
    title: "Ricerca",
    note: "Comprende anche enti e attività non universitari: non è la sola ricerca universitaria.",
  },
] as const;

export function getUniversityResearchView() {
  const series = getCommittedBudgetLawMissionSeries(10);
  return {
    years: series.years,
    dataset: series.dataset,
    observedAt: series.observedAt,
    missions: UNIVERSITY_RESEARCH_MISSIONS.map((mission) => ({
      ...mission,
      allocations: selectBudgetLawMission(series, mission.label).allocations.toSorted((a, b) => a.year - b.year),
    })),
  };
}
