import { z } from "zod";

/**
 * Judicial proceedings of XIX-legislature members of parliament.
 *
 * The contract is deliberately stricter than the shape of the data: it re-checks
 * the rules that keep a named person from being described as guilty, because the
 * snapshot is written by a curated research process rather than by an official
 * register. Anything that does not add up fails closed.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const looseDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/u);
const memberId = z.string().regex(/^(d\d+_19|s\d+)$/u, "memberId deve essere un id Camera (d<numero>_19) o Senato (s<numero>)");
/** Absent stays absent: an amount that nobody published must never arrive as a zero. */
const euroCents = z.number().int().nonnegative().safe().nullable();
const months = z.number().nonnegative().nullable();

const CONVICTION_STATUSES = ["condanna_definitiva", "condanna_non_definitiva", "patteggiamento"] as const;
const ACCOUNTING_STATUSES = ["contabile_definitiva", "contabile_non_definitiva"] as const;
const CLEARED_STATUSES = ["riformata_assoluzione", "prescrizione", "altra_estinzione"] as const;

export const CASE_STATUSES = [...CONVICTION_STATUSES, ...ACCOUNTING_STATUSES, ...CLEARED_STATUSES] as const;
export const OUTCOME_BUCKETS = ["condannato", "contabile", "non_condannato", "esito_ignoto"] as const;

const sourceSchema = z
  .object({
    url: z.string().url(),
    publisher: z.string().min(1),
    publishedAt: z.string().min(1).nullable(),
    kind: z.enum(["primary", "agency", "press"]),
    confirms: z.string().min(1),
    openedByResearcher: z.boolean(),
  })
  .strict();

const eventSchema = z
  .object({
    date: z.string().min(1),
    instance: z.enum([
      "primo_grado",
      "appello",
      "cassazione",
      "rinvio",
      "patteggiamento",
      "decreto_penale",
      "corte_conti_primo",
      "corte_conti_appello",
    ]),
    court: z.string().min(1),
    outcome: z.enum([
      "condanna",
      "assoluzione",
      "prescrizione",
      "annullamento_con_rinvio",
      "conferma",
      "riduzione_pena",
      "altro",
    ]),
    sentenceMonths: months,
    fineEuroCents: euroCents,
    damagesEuroCents: euroCents,
    sentenceType: z.enum([
      "carcere",
      "detenzione_domiciliare",
      "misura_alternativa",
      "pena_sospesa",
      "solo_pecuniaria",
      "non_ancora_esecutiva",
      "contabile",
      "non_applicabile",
      "non_noto",
    ]),
    note: z.string().min(1).nullable(),
  })
  .strict();

const caseSchema = z
  .object({
    caseId: z.string().min(1),
    memberId,
    memberSourceId: z.string().min(1),
    chamber: z.enum(["camera", "senato"]),
    displayName: z.string().min(1),
    birthDate: isoDate.nullable(),
    group: z.string().min(1),
    groupAtStart: z.string().min(1),
    region: z.string().min(1),
    mandateEnded: isoDate.nullable(),
    inPoliticiRoster: z.boolean().nullable(),
    title: z.string().min(1),
    offence: z.string().min(1),
    offenceCategory: z.enum([
      "pubblica_amministrazione",
      "finanziari_fiscali",
      "diffamazione",
      "ambiente_urbanistica",
      "violenza_persona",
      "elettorali",
      "mafia_criminalita",
      "altro",
    ]),
    jurisdiction: z.enum(["penale", "contabile"]),
    status: z.enum(CASE_STATUSES),
    statusLabel: z.string().min(1),
    statusAsOf: looseDate,
    outcomeBucket: z.enum(OUTCOME_BUCKETS),
    beforeMandate: z.boolean(),
    firstConvictionDate: looseDate.nullable(),
    latestSentenceMonths: months,
    latestSentenceType: z.string().min(1).nullable(),
    evidenceTier: z.enum(["atto-ufficiale", "stampa-concordante"]),
    evidenceLabel: z.enum(["official-finding", "needs-explanation"]),
    evidenceNote: z.string().min(1).nullable(),
    identityEvidence: z.string().min(1),
    notes: z.string().min(1).nullable(),
    correction: z.string().min(1).nullable(),
    events: z.array(eventSchema).min(1, "un caso senza gradi di giudizio non e documentato"),
    sources: z.array(sourceSchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const publishers = new Set(value.sources.map((source) => source.publisher.toLowerCase()));
    const hasOfficialAct = value.sources.some((source) => source.kind === "primary");
    if (!hasOfficialAct && publishers.size < 2) {
      ctx.addIssue({
        code: "custom",
        message: "senza un atto ufficiale servono almeno due editori indipendenti",
        path: ["sources"],
      });
    }
    if (value.evidenceTier === "atto-ufficiale" && !hasOfficialAct) {
      ctx.addIssue({ code: "custom", message: "evidenceTier atto-ufficiale senza fonte primaria", path: ["evidenceTier"] });
    }
    const definitive: readonly string[] = ["condanna_definitiva", "contabile_definitiva"];
    if (value.evidenceLabel === "official-finding" && !(hasOfficialAct && definitive.includes(value.status))) {
      ctx.addIssue({
        code: "custom",
        message: "official-finding e ammessa solo per una condanna definitiva con atto pubblicato",
        path: ["evidenceLabel"],
      });
    }
    const conviction: readonly string[] = CONVICTION_STATUSES;
    const accounting: readonly string[] = ACCOUNTING_STATUSES;
    const expected = value.outcomeBucket === "esito_ignoto"
      ? value.outcomeBucket
      : conviction.includes(value.status)
        ? "condannato"
        : accounting.includes(value.status)
          ? "contabile"
          : "non_condannato";
    if (value.outcomeBucket !== expected) {
      ctx.addIssue({ code: "custom", message: "outcomeBucket non coerente con lo stato del procedimento", path: ["outcomeBucket"] });
    }
    if (value.jurisdiction === "contabile" && value.events.some((event) => event.sentenceMonths !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "un procedimento contabile non infligge mesi di pena",
        path: ["events"],
      });
    }
  });

const coverageSchema = z
  .object({
    membersExamined: z.number().int().positive(),
    membersSearched: z.number().int().nonnegative().nullable(),
    membersSearchedWithQueryLog: z.number().int().nonnegative().nullable(),
    membersSearchedDeclaredOnly: z.number().int().nonnegative().nullable(),
    membersNotSearched: z.array(z.string().min(1)).nullable(),
    checkedAt: isoDate,
    cases: z.number().int().nonnegative(),
    casesByOutcome: z.record(z.enum(OUTCOME_BUCKETS), z.number().int().nonnegative()),
    membersByOutcome: z.record(z.enum(OUTCOME_BUCKETS), z.number().int().nonnegative()),
    membersWithCase: z.number().int().nonnegative(),
    membersNotInPoliticiRoster: z.array(memberId).nullable(),
    casesBackedByOfficialAct: z.number().int().nonnegative(),
    casesBackedByPressOnly: z.number().int().nonnegative(),
    casesWithoutSentenceLength: z.number().int().nonnegative(),
  })
  .strict();

const rosterSourceSchema = z
  .object({
    holder: z.string().min(1),
    canonicalUrl: z.string().url(),
    license: z.enum(["verified-open", "restricted", "not-declared", "unknown"]),
    licenseName: z.string().min(1).nullable(),
    use: z.string().min(1),
  })
  .strict();

const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    dataset: z.literal("parlamento-giudiziario-xix"),
    legislature: z
      .object({
        number: z.literal(19),
        chamberScope: z.array(z.enum(["camera", "senato"])).min(1),
        startDate: isoDate,
      })
      .strict(),
    coverage: coverageSchema,
    totals: z
      .object({
        definitiveSentenceMonths: z.number().nonnegative(),
        nonDefinitiveSentenceMonths: z.number().nonnegative(),
        accountingDamageEuroCents: z.number().int().nonnegative().safe(),
        note: z.string().min(1),
      })
      .strict(),
    source: z
      .object({
        holder: z.string().min(1),
        authority: z.literal("secondary"),
        license: z.literal("not-declared"),
        referencePeriod: z.string().min(1),
        publicationDate: z.null(),
        acquisitionDate: isoDate,
        checkedAt: isoDate,
        updateFrequency: z.string().min(1),
        canonicalUrls: z.array(z.string().url()).min(1),
        rosterSources: z.array(rosterSourceSchema).min(1),
        evidenceRule: z.string().min(1),
        verificationRule: z.string().min(1),
      })
      .strict(),
    caveats: z.array(z.string().min(1)).min(1, "il dataset deve dichiarare cosa non misura"),
    cases: z.array(caseSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    for (const [index, item] of value.cases.entries()) {
      if (ids.has(item.caseId)) {
        ctx.addIssue({ code: "custom", message: "caseId duplicato", path: ["cases", index, "caseId"] });
      }
      ids.add(item.caseId);
    }
    if (value.coverage.cases !== value.cases.length) {
      ctx.addIssue({ code: "custom", message: "coverage.cases non coincide con i casi", path: ["coverage", "cases"] });
    }
    const byOutcome = new Map<string, number>();
    const membersByOutcome = new Map<string, Set<string>>();
    for (const item of value.cases) {
      byOutcome.set(item.outcomeBucket, (byOutcome.get(item.outcomeBucket) ?? 0) + 1);
      const members = membersByOutcome.get(item.outcomeBucket) ?? new Set<string>();
      members.add(item.memberId);
      membersByOutcome.set(item.outcomeBucket, members);
    }
    for (const [bucket, count] of Object.entries(value.coverage.casesByOutcome)) {
      if ((byOutcome.get(bucket) ?? 0) !== count) {
        ctx.addIssue({ code: "custom", message: `casesByOutcome.${bucket} non ricalcolato`, path: ["coverage", "casesByOutcome"] });
      }
    }
    for (const [bucket, count] of Object.entries(value.coverage.membersByOutcome)) {
      if ((membersByOutcome.get(bucket)?.size ?? 0) !== count) {
        ctx.addIssue({ code: "custom", message: `membersByOutcome.${bucket} non ricalcolato`, path: ["coverage", "membersByOutcome"] });
      }
    }
    const definitive = value.cases
      .filter((item) => item.outcomeBucket === "condannato" && item.status === "condanna_definitiva")
      .reduce((total, item) => total + (item.latestSentenceMonths ?? 0), 0);
    if (Math.abs(definitive - value.totals.definitiveSentenceMonths) > 0.001) {
      ctx.addIssue({ code: "custom", message: "totale delle pene definitive non ricalcolato", path: ["totals", "definitiveSentenceMonths"] });
    }
    const searched = value.coverage.membersSearched ?? 0;
    const notSearched = value.coverage.membersNotSearched?.length ?? 0;
    if (searched + notSearched !== value.coverage.membersExamined) {
      ctx.addIssue({ code: "custom", message: "copertura incoerente con i parlamentari esaminati", path: ["coverage"] });
    }
  });

export type ParlamentoGiudiziarioSnapshot = z.infer<typeof snapshotSchema>;
export type GiudiziarioCase = ParlamentoGiudiziarioSnapshot["cases"][number];
export type GiudiziarioEvent = GiudiziarioCase["events"][number];
export type GiudiziarioSource = GiudiziarioCase["sources"][number];
export type GiudiziarioOutcome = (typeof OUTCOME_BUCKETS)[number];

export function parseParlamentoGiudiziarioSnapshot(input: unknown): ParlamentoGiudiziarioSnapshot {
  return snapshotSchema.parse(input);
}
