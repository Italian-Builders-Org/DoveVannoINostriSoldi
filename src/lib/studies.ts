import childcare from "../content/studies/childcare.json";
import wasteInterventions from "../content/studies/waste-interventions.json";

/** Occasional research, independent of the monthly editorial calendar.
 * Values are frozen at revision time, never imported from live raw snapshots.
 */
export const childcareStudy = {
  slug: "dai-fondi-ai-posti",
  title: "Dai fondi ai posti",
  subtitle: "Asili nido PNRR: fondi, avanzamento e divari territoriali",
  description: "Uno studio riproducibile su 2.980 progetti: cosa osserviamo tra finanziamento, collaudo e servizio disponibile.",
  path: "/studi/dai-fondi-ai-posti",
  reproducibilityUrl: "https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/tree/014af607204776d331cecf6a4e9d1775a219aede/research/pnrr-childcare-delivery",
  assetPath: `/studi/dai-fondi-ai-posti/v${childcare.version}`,
  ...childcare,
} as const;

export const wasteInterventionsStudy = {
  slug: "tre-interventi-sprechi",
  path: "/studi/tre-interventi-sprechi" as const,
  teaser: "Farmaci, giustizia ed edilizia: tre spese da verificare",
  reproducibilityUrl: "https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/tree/95a7e645d32e062b0be3443c324ab86bf2412e98/research/quaderni-sprechi-2026-09",
  assetPath: `/studi/tre-interventi-sprechi/v${wasteInterventions.version}`,
  ...wasteInterventions,
} as const;

export const studies = [wasteInterventionsStudy, childcareStudy] as const;
