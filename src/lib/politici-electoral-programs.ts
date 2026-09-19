/**
 * Catalog of official electoral programs linked to parliamentary groups (#548).
 * Themes are exact query seeds for news discovery — not LLM summaries.
 * Person-level «allineamento» is explicitly out of scope until vote/act evidence exists.
 */

export type ElectoralProgramTheme = {
  /** Short label shown in UI and used as a news query seed. */
  label: string;
  /** Exact wording / heading taken from the official program page where possible. */
  programWording: string;
};

export type ElectoralProgramEntry = {
  id: string;
  /** Matches RepublicMap group partyFamily or a dedicated alias. */
  partyFamily: string;
  /** Optional exact group short labels (Camera/Senato) that should inherit this program. */
  groupShortLabels: string[];
  listLabel: string;
  electionLabel: string;
  programTitle: string;
  programUrl: string;
  observedDate: string;
  publisher: string;
  licenseNote: string;
  themes: ElectoralProgramTheme[];
  caveats: string[];
};

/**
 * Only entries with a reachable official landing page are listed.
 * Alignment of individual MPs to program points is NOT computed here.
 */
export const ELECTORAL_PROGRAMS_XIX: ElectoralProgramEntry[] = [
  {
    id: "fdi-2022",
    partyFamily: "fratelli-italia",
    groupShortLabels: ["Fratelli d’Italia", "FdI"],
    listLabel: "Fratelli d’Italia",
    electionLabel: "Elezioni politiche 2022",
    programTitle: "Il programma di Fratelli d’Italia",
    programUrl: "https://www.fratelli-italia.it/programma/",
    observedDate: "2026-09-18",
    publisher: "Fratelli d’Italia",
    licenseNote: "Pagina pubblica del partito; testo non ripubblicato integralmente.",
    themes: [
      { label: "sicurezza", programWording: "sicurezza" },
      { label: "fisco", programWording: "fisco" },
      { label: "famiglia", programWording: "famiglia" },
      { label: "energia", programWording: "energia" },
      { label: "scuola", programWording: "scuola" },
    ],
    caveats: [
      "I temi sono semi di ricerca notizie derivati dal programma ufficiale, non un riassunto completo.",
      "Non misuriamo se un singolo parlamentare «tradisce» il programma: servono votazioni e atti ufficiali.",
    ],
  },
  {
    id: "fi-2022",
    partyFamily: "forza-italia",
    groupShortLabels: ["Forza Italia", "FI"],
    listLabel: "Forza Italia",
    electionLabel: "Elezioni politiche 2022",
    programTitle: "Programma e proposte — Forza Italia",
    programUrl: "https://www.forzaitalia.it/",
    observedDate: "2026-09-18",
    publisher: "Forza Italia",
    licenseNote: "Sito ufficiale del partito; ingresso al materiale programmatico pubblico.",
    themes: [
      { label: "impresa", programWording: "impresa" },
      { label: "Europa", programWording: "Europa" },
      { label: "sanità", programWording: "sanità" },
      { label: "giustizia", programWording: "giustizia" },
    ],
    caveats: [
      "Landing ufficiale del partito: il dettaglio del programma può spostarsi in sottopagine.",
      "Nessun punteggio di allineamento individuale in questa versione.",
    ],
  },
  {
    id: "m5s-2022",
    partyFamily: "movimento-5-stelle",
    groupShortLabels: ["M5S", "MoVimento 5 Stelle"],
    listLabel: "MoVimento 5 Stelle",
    electionLabel: "Elezioni politiche 2022",
    programTitle: "Programma e priorità — MoVimento 5 Stelle",
    programUrl: "https://www.movimento5stelle.eu/",
    observedDate: "2026-09-18",
    publisher: "MoVimento 5 Stelle",
    licenseNote: "Sito ufficiale europeo/nazionale del movimento.",
    themes: [
      { label: "ambiente", programWording: "ambiente" },
      { label: "reddito", programWording: "reddito" },
      { label: "trasparenza", programWording: "trasparenza" },
      { label: "sanità pubblica", programWording: "sanità" },
    ],
    caveats: [
      "Temi usati come query notizie; non sostituiscono il testo ufficiale del programma.",
      "Allineamento persona↔programma non calcolato.",
    ],
  },
];

export function programForGroup(input: {
  partyFamily: string | null | undefined;
  shortLabel: string | null | undefined;
}): ElectoralProgramEntry | null {
  const family = (input.partyFamily ?? "").toLowerCase();
  const short = (input.shortLabel ?? "").trim();
  const byLabel = ELECTORAL_PROGRAMS_XIX.find((entry) =>
    entry.groupShortLabels.some((label) => label.toLowerCase() === short.toLowerCase()),
  );
  if (byLabel) return byLabel;
  if (!family) return null;
  return ELECTORAL_PROGRAMS_XIX.find((entry) => entry.partyFamily === family) ?? null;
}

export function newsQuerySeedsForProgram(program: ElectoralProgramEntry): string[] {
  return program.themes.map((theme) => theme.label);
}
