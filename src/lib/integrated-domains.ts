/**
 * Italian names for the integrated catalogue's domains.
 *
 * The catalogue stores domains as English slugs. They are an internal key, not
 * a label: every public surface reads them from here so a reader never meets a
 * raw `appointments` or `participations` in the middle of an Italian page.
 */

export const INTEGRATED_DOMAIN_LABELS: Readonly<Record<string, string>> = {
  cohesion: "PNRR e investimenti",
  procurement: "Appalti e fornitori",
  consultancies: "Consulenze e incarichi",
  appointments: "Incarichi nominativi",
  personnel: "Personale e organi",
  operations: "Spese operative",
  health: "Dotazione sanitaria",
  demography: "Contesto demografico",
  education: "Servizi scolastici",
  transparency: "Trasparenza",
  oversight: "Controlli e atti",
  benchmarks: "Benchmark",
  evidence: "Segnali ed evidenze",
  sources: "Indici delle fonti",
  entities: "Enti",
  participations: "Partecipazioni pubbliche",
  "state-accounts": "Conti dello Stato",
  projects: "Progetti",
  "public-spending": "Pagamenti della Pubblica amministrazione",
  "candidate-batches": "Working set contabilizzati",
};

/** Reading order of the domains on the catalogue page. */
export const INTEGRATED_DOMAIN_ORDER: readonly string[] = Object.keys(INTEGRATED_DOMAIN_LABELS);

export function integratedDomainLabel(domain: string): string {
  return INTEGRATED_DOMAIN_LABELS[domain] ?? domain;
}
