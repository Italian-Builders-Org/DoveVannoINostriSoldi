import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);

const actId = z.string().regex(/^ddl-\d+$/u);
const numericId = z.string().regex(/^\d+$/u);
const voteId = z.string().regex(/^19-\d+-\d+$/u);
const sessionId = z.string().regex(/^19-\d+$/u);
const voteCode = z.enum(["F", "C", "A", "P", "M"]);

const phaseSchema = z
  .object({
    ddlUri: z.string().url(),
    idFase: numericId,
    fase: z.string().regex(/^[SC]\.\d+(?:-\d+)*(?:-B)?$/u),
    ramo: z.enum(["S", "C"]),
    progressivo: z.number().int().nonnegative(),
    kind: z.enum(["presentato", "trasmesso"]),
    presentedDate: isoDate,
    state: z.string().min(1),
    stateDate: isoDate,
  })
  .strict();

export type SenatoActPhase = z.infer<typeof phaseSchema>;

const actSchema = z
  .object({
    id: actId,
    idDdl: numericId,
    number: z.string().regex(/^S\.\d+$/u),
    natureId: z.enum(["ordinaria", "costituzionale"]),
    title: z.string().min(1).nullable(),
    presentedDate: isoDate,
    phases: z.array(phaseSchema).min(1),
    currentPhase: phaseSchema,
    outcomeClass: z.string().min(1),
    firstSignerId: numericId,
    coSignerIds: z.array(numericId),
    finalVoteIds: z.array(voteId),
    officialPage: z.string().url(),
  })
  .strict();

export type SenatoAct = z.infer<typeof actSchema>;

const finalVoteSchema = z
  .object({
    id: voteId,
    uri: z.string().url(),
    label: z.string().min(1),
    esito: z.string().min(1),
    favorevoli: z.number().int().nonnegative(),
    contrari: z.number().int().nonnegative(),
    astenuti: z.number().int().nonnegative(),
    presenti: z.number().int().nonnegative(),
    votanti: z.number().int().nonnegative(),
    maggioranza: z.number().int().nonnegative(),
    voteType: z.string().min(1),
    sessionId,
    sessionUri: z.string().url(),
    date: isoDate,
    approved: z.boolean(),
    secret: z.boolean(),
    votes: z.record(numericId, voteCode),
  })
  .strict();

export type SenatoFinalVote = z.infer<typeof finalVoteSchema>;

const pagedResponseSchema = z
  .object({
    pages: z.number().int().positive(),
    rows: z.number().int().positive(),
    bytes: z.number().int().positive(),
    sha256,
  })
  .strict();

export const senatoAttiVotiSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    chamber: z.literal("senato"),
    legislature: z
      .object({
        number: z.literal(19),
        id: z.literal("19"),
        label: z.string().min(1),
        uri: z.string().url(),
        startDate: isoDate,
      })
      .strict(),
    period: z
      .object({
        kind: z.literal("legislature-to-date"),
        startDate: isoDate,
        observedDate: isoDate,
        label: z.string().min(1),
      })
      .strict(),
    soldi: z
      .object({
        present: z.literal(false),
        note: z.string().min(1),
      })
      .strict(),
    provenance: z
      .object({
        kind: z.literal("official-sparql"),
        owner: z.string().min(1),
        title: z.string().min(1),
        endpointUrl: z.string().url(),
        landingUrl: z.string().url(),
        license: z.string().min(1),
        licenseUrl: z.string().url(),
        legislatureUri: z.string().url(),
        acquiredAt: isoDateTime,
        responses: z
          .object({
            phases: pagedResponseSchema,
            signers: pagedResponseSchema,
            finalVotes: pagedResponseSchema,
            disegniXix: pagedResponseSchema,
            sessions: pagedResponseSchema,
            nominalVotes: z
              .object({
                count: z.number().int().positive(),
                rows: z.number().int().positive(),
                bytes: z.number().int().positive(),
                sha256,
              })
              .strict(),
          })
          .strict(),
        gap: z.string().min(1),
      })
      .strict(),
    outcomeClasses: z
      .array(
        z
          .object({
            id: z.string().min(1),
            label: z.string().min(1),
            officialStates: z.array(z.string().min(1)).min(1),
          })
          .strict(),
      )
      .min(1),
    coverage: z
      .object({
        acts: z.number().int().positive(),
        actsByNature: z.record(z.string(), z.number().int().positive()),
        phases: z.number().int().positive(),
        actsWithMultiplePhases: z.number().int().nonnegative(),
        signatures: z.number().int().nonnegative(),
        actsExcludedNonSenatorFirstSigner: z.number().int().nonnegative(),
        finalVotes: z.number().int().nonnegative(),
        finalVotesOnOtherActs: z.number().int().nonnegative(),
        nominalVotes: z.number().int().nonnegative(),
        secretFinalVotes: z.number().int().nonnegative(),
        senatorsAsFirstSigner: z.number().int().nonnegative(),
        senatorsAsCoSigner: z.number().int().nonnegative(),
        actsByOutcomeClass: z.record(z.string(), z.number().int().positive()),
      })
      .strict(),
    acts: z.array(actSchema).min(1),
    finalVotes: z.array(finalVoteSchema).min(1),
    caveats: z.array(z.string().min(1)).min(6),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.coverage.acts !== value.acts.length) {
      ctx.addIssue({ code: "custom", message: "coverage.acts", path: ["coverage", "acts"] });
    }
    if (value.coverage.finalVotes !== value.finalVotes.length) {
      ctx.addIssue({ code: "custom", message: "coverage.finalVotes", path: ["coverage", "finalVotes"] });
    }
    if (
      value.coverage.phases !==
      value.acts.reduce((sum, act) => sum + act.phases.length, 0)
    ) {
      ctx.addIssue({ code: "custom", message: "coverage.phases", path: ["coverage", "phases"] });
    }
    const voteIds = new Set(value.finalVotes.map((vote) => vote.id));
    const actIds = new Set<string>();
    for (const [index, act] of value.acts.entries()) {
      if (actIds.has(act.id)) {
        ctx.addIssue({ code: "custom", message: "atto duplicato", path: ["acts", index, "id"] });
      }
      actIds.add(act.id);
      if (act.id !== `ddl-${act.idDdl}`) {
        ctx.addIssue({ code: "custom", message: "idDdl incoerente", path: ["acts", index, "idDdl"] });
      }
      const progressivi = act.phases.map((phase) => phase.progressivo);
      const sorted = [...progressivi].sort((a, b) => a - b);
      if (progressivi.some((prog, i) => prog !== sorted[i])) {
        ctx.addIssue({ code: "custom", message: "phases non ordinate", path: ["acts", index, "phases"] });
      }
      const lowest = progressivi[0];
      if (
        !act.phases.some(
          (phase) => phase.progressivo === lowest && phase.kind === "presentato" && phase.ramo === "S",
        )
      ) {
        ctx.addIssue({
          code: "custom",
          message: "fase iniziale non presentata al Senato",
          path: ["acts", index, "phases"],
        });
      }
      const last = act.phases[act.phases.length - 1]!;
      const currentOk =
        JSON.stringify(act.currentPhase) === JSON.stringify(last) ||
        act.phases.some(
          (phase) =>
            phase.progressivo === last.progressivo &&
            JSON.stringify(phase) === JSON.stringify(act.currentPhase),
        );
      if (!currentOk) {
        ctx.addIssue({
          code: "custom",
          message: "currentPhase non fra le fasi a progressivo massimo",
          path: ["acts", index, "currentPhase"],
        });
      }
      const coSigners = new Set(act.coSignerIds);
      if (coSigners.size !== act.coSignerIds.length || coSigners.has(act.firstSignerId)) {
        ctx.addIssue({
          code: "custom",
          message: "coSignerIds incoerenti",
          path: ["acts", index, "coSignerIds"],
        });
      }
      for (const linked of act.finalVoteIds) {
        if (!voteIds.has(linked)) {
          ctx.addIssue({
            code: "custom",
            message: "finalVoteId irrisolto",
            path: ["acts", index, "finalVoteIds"],
          });
        }
      }
    }
    for (const [index, vote] of value.finalVotes.entries()) {
      if (!vote.id.startsWith(`${vote.sessionId}-`)) {
        ctx.addIssue({
          code: "custom",
          message: "sessionId incoerente con id",
          path: ["finalVotes", index, "sessionId"],
        });
      }
      const counts = { F: 0, C: 0, A: 0 };
      for (const code of Object.values(vote.votes)) {
        if (code === "F") counts.F += 1;
        else if (code === "C") counts.C += 1;
        else if (code === "A") counts.A += 1;
      }
      if (counts.F !== vote.favorevoli || counts.C !== vote.contrari || counts.A !== vote.astenuti) {
        ctx.addIssue({
          code: "custom",
          message: "conteggi nominali non riconciliati",
          path: ["finalVotes", index, "votes"],
        });
      }
      if (vote.favorevoli + vote.contrari + vote.astenuti !== vote.votanti) {
        ctx.addIssue({
          code: "custom",
          message: "votanti != favorevoli+contrari+astenuti",
          path: ["finalVotes", index, "votanti"],
        });
      }
      if (vote.presenti < vote.votanti) {
        ctx.addIssue({
          code: "custom",
          message: "presenti < votanti",
          path: ["finalVotes", index, "presenti"],
        });
      }
      if (vote.approved !== (vote.favorevoli > vote.maggioranza)) {
        ctx.addIssue({ code: "custom", message: "approvato incoerente", path: ["finalVotes", index, "approved"] });
      }
      if (vote.secret && Object.keys(vote.votes).length > 0) {
        ctx.addIssue({ code: "custom", message: "nominale su voto segreto", path: ["finalVotes", index, "secret"] });
      }
      if (!vote.secret && Object.keys(vote.votes).length === 0) {
        ctx.addIssue({ code: "custom", message: "nominale assente", path: ["finalVotes", index, "votes"] });
      }
    }
    const referencedVoteIds = new Set(value.acts.flatMap((act) => act.finalVoteIds));
    for (const [index, vote] of value.finalVotes.entries()) {
      if (!referencedVoteIds.has(vote.id)) {
        ctx.addIssue({ code: "custom", message: "votazione non referenziata da alcun atto", path: ["finalVotes", index, "id"] });
      }
    }
  });

export type SenatoAttiVotiSnapshot = z.infer<typeof senatoAttiVotiSnapshotSchema>;

export function parseSenatoAttiVotiSnapshot(raw: unknown): SenatoAttiVotiSnapshot {
  return senatoAttiVotiSnapshotSchema.parse(raw);
}
