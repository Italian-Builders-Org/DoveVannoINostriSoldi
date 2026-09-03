import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  getCurrentGovernmentScorecardV6Id,
  getGovernmentScorecardV6View,
  isGovernmentScorecardV6GovernmentId,
} from "@/lib/government-scorecard-governments";

import { GovernmentComparison } from "./government-comparison";

export const metadata: Metadata = {
  title: "Confronta due governi · Pagella politico-economica",
  description: "Affianca due governi e confronta gli stessi indicatori e il contesto documentato, senza classifiche o vincitori.",
};

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function GovernmentComparisonPage({
  searchParams,
}: {
  searchParams: Promise<{ sinistra?: string | string[]; destra?: string | string[] }>;
}) {
  const currentId = getCurrentGovernmentScorecardV6Id();
  const currentView = getGovernmentScorecardV6View(currentId);
  const currentIndex = currentView.compare.options.findIndex((option) => option.id === currentId);
  const previousId = currentView.compare.options[Math.max(0, currentIndex - 1)]?.id;
  if (!previousId || previousId === currentId) throw new Error("secondo governo predefinito non disponibile");

  const query = await searchParams;
  const leftId = firstQueryValue(query.sinistra) ?? currentId;
  const rightId = firstQueryValue(query.destra) ?? previousId;
  if (
    !isGovernmentScorecardV6GovernmentId(leftId)
    || !isGovernmentScorecardV6GovernmentId(rightId)
    || leftId === rightId
  ) {
    notFound();
  }

  const view = getGovernmentScorecardV6View(leftId);
  return <GovernmentComparison compare={view.compare} charts={view.charts} leftId={leftId} rightId={rightId} />;
}
