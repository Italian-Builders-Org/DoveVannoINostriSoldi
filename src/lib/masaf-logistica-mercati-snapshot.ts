import rawData from "@/data/generated/masaf-logistica-mercati.data.json";
import rawMeta from "@/data/generated/masaf-logistica-mercati.meta.json";

export type MasafMercatiStato = "in-graduatoria" | "concessione-pubblicata";

export type MasafMercatiProject = {
  ordine: number;
  codiceDomanda: string;
  beneficiario: string;
  punteggio: number;
  tagGreenPct: number;
  tagDigitalePct: number;
  conformitaDnsh: string;
  macroArea: "Nord" | "Centro" | "Sud";
  dataPresentazione: string;
  oraPresentazione: string;
  agevolazioneRichiestaEuro: number;
  rapportoAgevolazioneCostiPct: number;
  notaAmmissione?: string;
  cup: string | null;
  agevolazioneConcessaEuro: number | null;
  agevolazioneRichiestaCents: number;
  agevolazioneConcessaCents: number | null;
  finanziamentoPnrrEuro: number | null;
  finanziamentoPnrrCents: number | null;
  finanziamentoTotaleEuro: number | null;
  finanziamentoTotaleCents: number | null;
  titoloProgettoRegis: string | null;
  statoAvanzamentoRegis: string | null;
  dataInizioPrevista: string | null;
  dataInizioEffettiva: string | null;
  dataFinePrevista: string | null;
  dataFineEffettiva: string | null;
  dataEstrazioneRegis: string | null;
  regione: string | null;
  provincia: string | null;
  comune: string | null;
  statoDocumentato: MasafMercatiStato;
  concessione: {
    title: string;
    url: string;
    sha256: string;
    bytes: number;
    protocolFromTitle: string | null;
  } | null;
  erogazioniEuro: number | null;
  pagamentiEuro: number | null;
};

export type MasafMercatiDenial = {
  codiceDomanda: string;
  beneficiario: string;
  provvedimento: string;
  motivazione: string;
};

export type MasafMercatiMeta = {
  datasetId: string;
  schemaVersion: number;
  measure: {
    officialName: string;
    pnrrCode: string;
    line: string;
    holder: string;
    gestore: string;
    dotazioneDichiarataEuro: number;
    maxAgevolazionePerProgettoEuro: number;
  };
  sources: Record<string, { url: string; label: string; pdfUrl?: string; license?: string }>;
  referencePeriod: { label: string; avvisoYear: number };
  acquisition: {
    acquiredAt: string;
    concessioniPageUrl: string;
    regisExtractionDate: string;
  };
  licenseStatus: string;
  caveats: string[];
  counts: {
    projects: number;
    withCup: number;
    withGranted: number;
    withRegis: number;
    denials: number;
  };
};

export const masafMercatiMeta = rawMeta as MasafMercatiMeta;
export const masafMercatiProjects = (rawData as { projects: MasafMercatiProject[] }).projects;
export const masafMercatiDenials = (rawData as { denials: MasafMercatiDenial[] }).denials;

const projectsByCup = new Map(
  masafMercatiProjects
    .filter((project) => project.cup)
    .map((project) => [project.cup as string, project]),
);

export function getMasafMercatiProject(cup: string): MasafMercatiProject | null {
  const normalized = cup.trim().toUpperCase();
  if (!/^[A-Z0-9]{15}$/.test(normalized)) {
    throw new MasafMercatiQueryError("CUP non valido");
  }
  return projectsByCup.get(normalized) ?? null;
}

export class MasafMercatiQueryError extends Error {}

export type MasafMercatiSummaryRow = {
  label: string;
  projects: number;
  withCup: number;
  richiestaEuro: number;
  concessaEuro: number | null;
  concessaAvailable: number;
  finanziamentoPnrrEuro: number | null;
  finanziamentoAvailable: number;
};

export type MasafMercatiRecipientRow = {
  ordine: number;
  beneficiario: string;
  codiceDomanda: string;
  cup: string | null;
  macroArea: string;
  regione: string | null;
  richiestaEuro: number;
  concessaEuro: number | null;
  finanziamentoPnrrEuro: number | null;
  statoDocumentato: MasafMercatiStato;
  statoAvanzamentoRegis: string | null;
};

function sumKnown(values: Array<number | null | undefined>): { total: number | null; available: number } {
  let total = 0;
  let available = 0;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    total += value;
    available += 1;
  }
  return { total: available === 0 ? null : total, available };
}

function summarize(label: string, projects: MasafMercatiProject[]): MasafMercatiSummaryRow {
  const richiestaEuro = projects.reduce((sum, project) => sum + project.agevolazioneRichiestaEuro, 0);
  const concessa = sumKnown(projects.map((project) => project.agevolazioneConcessaEuro));
  const finanziamento = sumKnown(projects.map((project) => project.finanziamentoPnrrEuro));
  return {
    label,
    projects: projects.length,
    withCup: projects.filter((project) => project.cup).length,
    richiestaEuro,
    concessaEuro: concessa.total,
    concessaAvailable: concessa.available,
    finanziamentoPnrrEuro: finanziamento.total,
    finanziamentoAvailable: finanziamento.available,
  };
}

function rankingAmount(project: MasafMercatiProject): number {
  return project.agevolazioneConcessaEuro ?? project.finanziamentoPnrrEuro ?? project.agevolazioneRichiestaEuro;
}

/** Summary tables for the page header: totals stay nature-separated. */
export function getMasafMercatiSummaries() {
  const byArea = (["Nord", "Centro", "Sud"] as const).map((area) =>
    summarize(
      area,
      masafMercatiProjects.filter((project) => project.macroArea === area),
    ),
  );
  const byStato = (
    [
      ["concessione-pubblicata", "Concessione pubblicata"],
      ["in-graduatoria", "Solo in graduatoria"],
    ] as const
  ).map(([stato, label]) =>
    summarize(
      label,
      masafMercatiProjects.filter((project) => project.statoDocumentato === stato),
    ),
  );

  const byAvanzamentoMap = new Map<string, MasafMercatiProject[]>();
  for (const project of masafMercatiProjects) {
    const label = project.statoAvanzamentoRegis?.trim() || "Avanzamento non disponibile";
    const bucket = byAvanzamentoMap.get(label) ?? [];
    bucket.push(project);
    byAvanzamentoMap.set(label, bucket);
  }
  const byAvanzamento = [...byAvanzamentoMap.entries()]
    .map(([label, projects]) => summarize(label, projects))
    .sort((a, b) => b.projects - a.projects || a.label.localeCompare(b.label, "it"));

  const byRegioneMap = new Map<string, MasafMercatiProject[]>();
  for (const project of masafMercatiProjects) {
    const label = project.regione?.trim() || "Regione non disponibile";
    const bucket = byRegioneMap.get(label) ?? [];
    bucket.push(project);
    byRegioneMap.set(label, bucket);
  }
  const byRegione = [...byRegioneMap.entries()]
    .map(([label, projects]) => summarize(label, projects))
    .sort((a, b) => b.richiestaEuro - a.richiestaEuro || a.label.localeCompare(b.label, "it"));

  const topBeneficiari: MasafMercatiRecipientRow[] = [...masafMercatiProjects]
    .sort((a, b) => rankingAmount(b) - rankingAmount(a) || a.ordine - b.ordine)
    .slice(0, 12)
    .map((project) => ({
      ordine: project.ordine,
      beneficiario: project.beneficiario,
      codiceDomanda: project.codiceDomanda,
      cup: project.cup,
      macroArea: project.macroArea,
      regione: project.regione,
      richiestaEuro: project.agevolazioneRichiestaEuro,
      concessaEuro: project.agevolazioneConcessaEuro,
      finanziamentoPnrrEuro: project.finanziamentoPnrrEuro,
      statoDocumentato: project.statoDocumentato,
      statoAvanzamentoRegis: project.statoAvanzamentoRegis,
    }));

  return {
    total: summarize("Totale linea Mercati", masafMercatiProjects),
    byArea,
    byStato,
    byAvanzamento,
    byRegione,
    topBeneficiari,
  };
}

export function queryMasafMercati(params: {
  q?: string;
  area?: string;
  stato?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = params.limit ?? 36;
  const offset = params.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new MasafMercatiQueryError("limit non valido");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new MasafMercatiQueryError("offset non valido");
  }

  const q = params.q?.trim().toLowerCase();
  const area = params.area?.trim();
  const stato = params.stato?.trim();

  const filtered = masafMercatiProjects.filter((project) => {
    if (area && project.macroArea !== area) return false;
    if (stato && project.statoDocumentato !== stato) return false;
    if (!q) return true;
    const haystack = [
      project.beneficiario,
      project.codiceDomanda,
      project.cup ?? "",
      project.titoloProgettoRegis ?? "",
      project.regione ?? "",
      project.comune ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  return {
    total: filtered.length,
    projects: filtered.slice(offset, offset + limit),
    pagination: { limit, offset },
  };
}
