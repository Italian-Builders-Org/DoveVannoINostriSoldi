import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  getCurrentGovernmentScorecardV6Id,
  getGovernmentScorecardV6View,
  isGovernmentScorecardV6GovernmentId,
} from "@/lib/government-scorecard-governments";
import type {
  GovernmentScorecardV6ComparisonDetail,
  GovernmentScorecardV6PageView,
} from "@/lib/government-scorecard-page";

import { GovernmentComparison } from "./government-comparison";

export const metadata: Metadata = {
  title: "Confronta due governi · Pagella politico-economica",
  description: "Affianca due governi e confronta gli stessi indicatori e il contesto documentato, senza classifiche o vincitori.",
};

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function comparisonDetail(
  view: GovernmentScorecardV6PageView,
  id: string,
): GovernmentScorecardV6ComparisonDetail {
  const option = view.compare.options.find((candidate) => candidate.id === id);
  if (!option || view.charts.status !== "ready") {
    throw new Error(`dettaglio confronto non disponibile per ${id}`);
  }
  return {
    ...option,
    chart_windows: view.charts.slides.map((chart) => ({
      indicator_id: chart.indicator_id,
      start_year: chart.mandate_window.start_year,
      end_year: chart.mandate_window.end_year,
      start_date: chart.mandate_window.start_date,
      end_date: chart.mandate_window.end_date,
      end_exclusive: chart.mandate_window.end_exclusive,
    })),
    context: view.context.slides,
  };
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

  const leftView = getGovernmentScorecardV6View(leftId);
  const rightView = getGovernmentScorecardV6View(rightId);
  return (
    <GovernmentComparison
      compare={leftView.compare}
      charts={leftView.charts}
      left={comparisonDetail(leftView, leftId)}
      right={comparisonDetail(rightView, rightId)}
    />
  );
}
