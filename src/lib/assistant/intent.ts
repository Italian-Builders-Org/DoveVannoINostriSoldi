import type { DatasetQuery } from "@/lib/mcp/catalog";
import {
  ASSISTANT_EXAMPLES,
  assistantFailure,
  assistantHelpResponse,
  type AssistantIntent,
  type AssistantResponse,
} from "@/lib/assistant/contracts";
import { REGION_PROMPT_ALIASES } from "@/lib/region-query";

const UNSAFE_PATTERNS = [
  /\b(frode|frodi|corruzion\p{Letter}*|evasione|truffa|colpevol\p{Letter}*|responsabilit\p{Letter}*|inculpat\p{Letter}*|reato\p{Letter}*|criminal\p{Letter}*|illegal\p{Letter}*|colpa)\b/u,
  /\b(ignore|ignora|bypass|jailbreak|system prompt|developer message|istruzioni precedenti)\b/u,
  /<\s*script\b|javascript:|data:text\/html|file:\/\//u,
  /\b(select|insert|update|delete|drop)\s+.+\s+from\b/u,
  /https?:\/\//u,
];

const UNSUPPORTED_PATTERNS = [
  /\b(classifica|classifiche|miglior[ei]?|peggior[ei]?|best|worst|efficienza|spreco)\b/u,
  /\b(voce|vocale|audio|parlami|telefon|chatgpt|claude|mcp)\b/u,
  /\bcomune\s+(di|del|della)\b/u,
  /\b(provincia|province)\b/u,
  /\b(come|perch[eé]|dimostra|prova)\b/u,
];

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("it-IT")
    .replace(/[’']/gu, " ")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

// Match the whole comparison: extra topics, months, territories or causal
// clauses must never silently become a comparison of annual national totals.
const COMPARISON = /^(?:come sono (?:cambiati|variati) i|confronta i) pagamenti (?:siope )?dei comuni(?: (?:in|della|del|dell) (.+?))? (?:tra (?:il )?(20\d{2}|21\d{2}) e (?:il )?(20\d{2}|21\d{2})|dal (20\d{2}|21\d{2}) al (20\d{2}|21\d{2}))$/u;

function comparisonIntent(text: string): AssistantIntent | AssistantResponse {
  const match = COMPARISON.exec(text);
  const scope = match?.[1];
  const region = scope ? REGION_PROMPT_ALIASES.get(scope) : undefined;
  if (!match || (scope && scope !== "italia" && !region)) {
    return assistantHelpResponse("Per confrontare due anni, prova: «Come sono cambiati i pagamenti dei Comuni in Calabria tra il 2024 e il 2025?». Posso confrontare soltanto lo stesso territorio e i pagamenti SIOPE complessivi.");
  }
  const years = [Number(match[2] ?? match[4]), Number(match[3] ?? match[5])].sort((a, b) => a - b);
  if (years[0] === years[1]) {
    return assistantHelpResponse("Indica due anni diversi per il confronto.");
  }
  const query = (year: number): DatasetQuery => region
    ? { dataset: "siope_comuni", year, region }
    : { dataset: "siope_comuni", year };
  return { kind: "siope_comparison", queries: [query(years[0]), query(years[1])] };
}

function regionFrom(prompt: string): string | undefined {
  const found = [...REGION_PROMPT_ALIASES.entries()]
    .sort(([left], [right]) => right.length - left.length)
    .find(([alias]) => new RegExp(`\\b${alias.replace(/ /gu, "\\s+")}\\b`, "u").test(prompt));
  return found?.[1];
}

function hasNationalMunicipalQuestion(prompt: string): boolean {
  return /\bquanto(?: hanno| ha)? speso\b[\s\S]*\bcomuni\b/u.test(prompt) ||
    /\bpagamenti\b[\s\S]*\bcomuni\b/u.test(prompt);
}

function hasStateQuestion(prompt: string): boolean {
  return /\bquanto(?: ha| hanno)? speso\b[\s\S]*\bstato\b/u.test(prompt) ||
    /\bpagamenti\b[\s\S]*\bstato\b/u.test(prompt);
}

function hasIrpefQuestion(prompt: string): boolean {
  return /\bimposta\s+netta\s+dichiarata\b/u.test(prompt);
}

function queryIntent(query: DatasetQuery, description: string): AssistantIntent {
  return { kind: "dataset_query", query, description };
}

/**
 * Parses only a small, explicit Italian vocabulary. No user-provided text is
 * used as a dataset identifier, URL, code path, SQL fragment or function name.
 */
export function parseAssistantIntent(prompt: string): AssistantIntent | AssistantResponse {
  const text = normalized(prompt);

  if (UNSAFE_PATTERNS.some((pattern) => pattern.test(text))) {
    return assistantFailure(
      "refusal",
      "unsafe_request",
      "Non posso attribuire frodi, corruzione o responsabilità individuali. Posso mostrare soltanto dati pubblici aggregati e le loro fonti.",
    );
  }

  if (text === "aiuto" || text === "help" || /\b(cosa puoi fare|esempi|come funziona)\b/u.test(text)) {
    return assistantHelpResponse();
  }

  const years = [...text.matchAll(/\b\d{4}\b/gu)].map(([year]) => Number(year));
  if (years.length > 1 || /\b(confronta|confronto|cambiati|variati|differenza)\b/u.test(text)) {
    return comparisonIntent(text);
  }

  if (UNSUPPORTED_PATTERNS.some((pattern) => pattern.test(text))) {
    return assistantHelpResponse(
      "Questa versione risponde a pochi confronti aggregati e verificabili; non produce classifiche, spiegazioni causali o dati per singolo Comune.",
    );
  }

  const year = years[0];
  if (year === undefined) {
    return assistantHelpResponse("Indica anche l’anno di riferimento, per esempio 2025.");
  }

  const region = regionFrom(text);
  if (hasIrpefQuestion(text) && region && year === 2024) {
    return queryIntent(
      {
        dataset: "mef_irpef_comunale",
        year,
        level: "region",
        region,
      },
      "Imposta netta dichiarata MEF per Regione",
    );
  }

  if (hasNationalMunicipalQuestion(text)) {
    return queryIntent(
      region
        ? { dataset: "siope_comuni", year, region }
        : { dataset: "siope_comuni", year },
      region
        ? "Pagamenti SIOPE dei Comuni nella Regione indicata"
        : "Pagamenti SIOPE dei Comuni in Italia",
    );
  }

  if (hasStateQuestion(text)) {
    if (region) {
      return assistantHelpResponse("La spesa dello Stato non è regionalizzata in questa interfaccia; posso mostrarti il rilascio nazionale OpenBDAP.");
    }
    return queryIntent(
      { dataset: "openbdap_spesa_stato", year },
      "Pagamenti dello Stato nel periodo ufficiale disponibile",
    );
  }

  return assistantHelpResponse(
    `Non ho trovato una domanda supportata. Prova, per esempio: ${ASSISTANT_EXAMPLES[0]} Non posso inventare filtri o stimare dati mancanti.`,
  );
}

export function isAssistantIntent(value: AssistantIntent | AssistantResponse): value is AssistantIntent {
  return value.kind === "dataset_query" || value.kind === "siope_comparison";
}
