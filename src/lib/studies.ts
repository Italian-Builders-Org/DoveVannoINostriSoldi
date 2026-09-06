import childcare from "../content/studies/childcare.json";

/** Occasional research, independent of the monthly editorial calendar.
 * Values are frozen at revision time, never imported from live raw snapshots.
 */
export const childcareStudy = {
  slug: "dai-fondi-ai-posti",
  title: "Dai fondi ai posti",
  subtitle: "Asili nido PNRR: fondi, avanzamento e divari territoriali",
  description: "Uno studio riproducibile su 2.980 progetti: cosa osserviamo tra finanziamento, collaudo e servizio disponibile.",
  path: "/studi/dai-fondi-ai-posti",
  reproducibilityUrl: "https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/tree/4bfeb36a33957f6ba4d2e67ed0f36e738616e6fb/research/pnrr-childcare-delivery",
  assetPath: `/studi/dai-fondi-ai-posti/v${childcare.version}`,
  ...childcare,
} as const;

export const studies = [childcareStudy] as const;
