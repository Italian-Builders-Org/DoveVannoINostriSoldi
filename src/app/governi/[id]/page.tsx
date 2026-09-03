import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GovernmentScorecardPage } from "../_components/government-scorecard-page";
import {
  GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS,
  getGovernmentScorecardV6View,
  isGovernmentScorecardV6GovernmentId,
} from "@/lib/government-scorecard-governments";

export const dynamicParams = false;

export function generateStaticParams() {
  return GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS.map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isGovernmentScorecardV6GovernmentId(id)) return {};
  const view = getGovernmentScorecardV6View(id);
  return {
    title: `${view.government.name} · Pagella politico-economica`,
    description: `Dati economici osservati e contesto documentato del ${view.government.name}.`,
  };
}

export default async function GovernmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isGovernmentScorecardV6GovernmentId(id)) notFound();
  return <GovernmentScorecardPage view={getGovernmentScorecardV6View(id)} />;
}
