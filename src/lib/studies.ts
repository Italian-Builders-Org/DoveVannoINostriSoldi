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
  assetPath: "/studi/dai-fondi-ai-posti/v1.2",
  ...childcare,
} as const;

export const studies = [childcareStudy] as const;
