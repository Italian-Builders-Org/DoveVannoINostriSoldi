import type { Metadata } from "next";

import { GovernmentScorecardPage } from "./_components/government-scorecard-page";
import {
  getCurrentGovernmentScorecardV6Id,
  getGovernmentScorecardV6View,
} from "@/lib/government-scorecard-governments";

export const metadata: Metadata = {
  title: "Pagella politico-economica dei governi italiani",
  description: "Dati economici osservati, confronto con Francia, Germania e Spagna e contesto documentato dei governi italiani dal 1995.",
};

export default function GovernmentsPage() {
  const view = getGovernmentScorecardV6View(getCurrentGovernmentScorecardV6Id());
  return <GovernmentScorecardPage view={view} />;
}
