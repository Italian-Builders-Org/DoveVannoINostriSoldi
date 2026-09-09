import "server-only";

import {
  ANAC_OPERATOR_INDEX,
  getAnacOperatorByRef,
  isAnacOperatorRef,
  loadAnacOperatorIndexMeta,
  loadAnacOperatorNationalSummaries,
  searchAnacOperators,
  type AnacOperatorSummaryHit,
} from "@/lib/data/anac-operator-awards-index";

export const ANAC_OPERATOR_QUERY_LIMIT = 10;

function publicHit(hit: AnacOperatorSummaryHit) {
  return {
    ref: hit.ref,
    name: hit.name,
    awardCount: hit.awardCount,
    attributedAwardCount: hit.attributedAwardCount,
    attributedValue: hit.attributedValue,
    yearMin: hit.yearMin,
    yearMax: hit.yearMax,
    path: `/appalti/operatori/${hit.ref}`,
  };
}

/** The same committed index used by the operator pages, with bounded public rows. */
export function queryAnacOperatorAwards(options: {
  query?: string;
  code?: string;
  measure?: string;
  limit?: number;
}, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const selectors = [options.query, options.code, options.measure].filter((value) => value !== undefined);
  if (selectors.length > 1) throw new Error("Per anac_operatori usa query, code oppure measure, non più filtri insieme.");
  const limit = options.limit ?? 5;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ANAC_OPERATOR_QUERY_LIMIT) {
    throw new Error(`anac_operatori: limit deve essere un intero tra 1 e ${ANAC_OPERATOR_QUERY_LIMIT}.`);
  }
  if (options.code !== undefined && !isAnacOperatorRef(options.code)) {
    throw new Error("anac_operatori: code deve essere un riferimento pubblico op-######## dello snapshot, non un codice fiscale.");
  }
  if (options.measure !== undefined && !["awardCount", "attributedValue"].includes(options.measure)) {
    throw new Error("anac_operatori: measure deve essere awardCount oppure attributedValue.");
  }
  if (options.query !== undefined && (options.query.length > 120 || options.query.normalize("NFKC").toUpperCase().replace(/[^0-9A-Z]+/g, "").length < ANAC_OPERATOR_INDEX.minQueryLength)) {
    throw new Error("anac_operatori: query deve contenere almeno 3 caratteri alfanumerici e non superare 120 caratteri.");
  }
  const meta = loadAnacOperatorIndexMeta();
  const shared = {
    dataset: "anac_operatori" as const,
    freshness: "snapshot" as const,
    observedAt: meta.observedAt,
    generatedAt: meta.generatedAt,
    monetaryUnit: "EUR",
    monetaryNature: "award-declared",
    valueAttribution: "single-resolved-operator-awards-only",
    scope: meta.scope,
    coverage: meta.coverage,
    nationalSnapshotTotals: meta.totals,
    provenance: { ...meta.provenance, sourceSpecSha256: meta.sourceSpecSha256 },
    limitations: meta.limitations,
    referenceNote: "I riferimenti op-######## identificano operatori in questo snapshot; non sono identificativi stabili tra aggiornamenti. Gli importi sono stringhe decimali in euro, non pagamenti o incassi.",
    limit,
  };
  if (options.code !== undefined) {
    const operator = getAnacOperatorByRef(options.code);
    signal?.throwIfAborted();
    return {
      ...shared,
      mode: "detail" as const,
      code: options.code,
      matched: operator ? 1 : 0,
      returned: operator ? 1 : 0,
      rows: operator ? [{
        ...publicHit(operator),
        nameVariants: operator.nameVariants,
        awards: operator.awards.slice(0, limit),
        awardsPublished: operator.awardsPublished,
        awardsReturned: Math.min(operator.awards.length, limit),
        awardsOmittedFromPublished: Math.max(0, operator.awards.length - limit),
        awardsTruncatedInSnapshot: operator.awardsTruncated,
      }] : [],
      selectionNote: "limit limita i CIG restituiti della scheda; awardsPublished è il campione pubblicato (massimo 15), awardCount è il conteggio completo nello snapshot. Il campione non è il totale delle aggiudicazioni.",
    };
  }
  if (options.query !== undefined) {
    const result = searchAnacOperators({ q: options.query, limit });
    signal?.throwIfAborted();
    return {
      ...shared,
      mode: "search" as const,
      query: result.query,
      normalizedQuery: result.normalizedQuery,
      matched: result.matched,
      returned: result.hits.length,
      truncated: result.matched > result.hits.length,
      rows: result.hits.map(publicHit),
      selectionNote: "Ricerca per denominazione normalizzata; risultati ordinati prima per prefisso, poi per conteggio. Omonimie e varianti non autorizzano deduzioni sull'identità legale.",
    };
  }
  const measure = options.measure ?? "awardCount";
  const summaries = loadAnacOperatorNationalSummaries();
  const ranking = measure === "attributedValue" ? summaries.topOperatorsByAttributedValue : summaries.topOperatorsByAwardCount;
  const rows = ranking.slice(0, limit).map(publicHit);
  signal?.throwIfAborted();
  return {
    ...shared,
    mode: "ranking" as const,
    measure,
    matched: meta.totals.operators,
    returned: rows.length,
    truncated: meta.totals.operators > rows.length,
    rows,
    selectionNote: "Prime posizioni della classifica nazionale pubblicata; le righe restituite non sono il totale. Valore attribuibile solo ad aggiudicazioni con operatore unico; i conteggi includono quelle con più operatori.",
  };
}
