import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);

const actId = z.string().regex(/^ac19_\d+(?:-[A-Za-z]+)?$/u);
const deputyId = z.string().regex(/^d\d+_19$/u);
const voteId = z.string().regex(/^vs19_\d+_\d+$/u);
const sessionId = z.string().regex(/^s19_\d+$/u);
const voteCode = z.enum(["F", "C", "A", "N", "V"]);

const iterEntrySchema = z
  .object({
    state: z.string().min(1),
    date: isoDate,
  })
  .strict();

const actSchema = z
  .object({
    id: actId,
    number: z.string().regex(/^\d+(?:-[A-Za-z]+)?$/u),
    baseNumber: z.number().int().positive(),
    uri: z.string().url(),
    natureId: z.enum([
      "proposta_legge_ordinaria",
      "proposta_legge_costituzionale",
      "disegno_legge_ordinario",
      "disegno_legge_costituzionale",
    ]),
    title: z.string().min(1),
    presentedDate: isoDate.nullable(),
    initiative: z.string().min(1).nullable(),
    firstSignerId: deputyId,
    coSignerIds: z.array(deputyId),
    iter: z.array(iterEntrySchema),
    currentState: iterEntrySchema.nullable(),
    outcomeClass: z.string().min(1).nullable(),
    finalVoteIds: z.array(voteId),
    officialPage: z.string().url(),
  })
  .strict();

export type CameraAct = z.infer<typeof actSchema>;

const finalVoteSchema = z
  .object({
    id: voteId,
    uri: z.string().url(),
    actId,
    label: z.string().min(1),
    sessionId,
    date: isoDate,
    favorevoli: z.number().int().nonnegative(),
    contrari: z.number().int().nonnegative(),
    astenuti: z.number().int().nonnegative(),
    presenti: z.number().int().nonnegative(),
    votanti: z.number().int().nonnegative(),
    maggioranza: z.number().int().nonnegative(),
    approved: z.boolean(),
    confidenceVote: z.boolean(),
    secret: z.boolean(),
    votes: z.record(z.string().regex(/^\d+$/u), voteCode),
  })
  .strict();

export type CameraFinalVote = z.infer<typeof finalVoteSchema>;

const pagedResponseSchema = z
  .object({
    pages: z.number().int().positive(),
    rows: z.number().int().positive(),
    bytes: z.number().int().positive(),
    sha256,
  })
  .strict();

export const cameraAttiVotiSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    chamber: z.literal("camera"),
    legislature: z
      .object({
        number: z.literal(19),
        id: z.literal("repubblica_19"),
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
            acts: pagedResponseSchema,
            coSigners: pagedResponseSchema,
            iterStates: pagedResponseSchema,
            finalVotes: pagedResponseSchema,
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
        actsWithGovernmentFirstSigner: z.number().int().nonnegative(),
        actsByNature: z.record(z.string(), z.number().int().positive()),
        signatures: z.number().int().nonnegative(),
        coSignersNotDeputyXix: z.number().int().nonnegative(),
        actsWithoutIterState: z.number().int().nonnegative(),
        finalVotes: z.number().int().nonnegative(),
        finalVotesOnOtherActs: z.number().int().nonnegative(),
        nominalVotes: z.number().int().nonnegative(),
        secretFinalVotes: z.number().int().nonnegative(),
        deputiesAsFirstSigner: z.number().int().nonnegative(),
        deputiesAsCoSigner: z.number().int().nonnegative(),
        actsByOutcomeClass: z.record(z.string(), z.number().int().positive()),
      })
      .strict(),
    acts: z.array(actSchema).min(1),
    finalVotes: z.array(finalVoteSchema).min(1),
    caveats: z.array(z.string().min(1)).min(5),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.coverage.acts !== value.acts.length) {
      ctx.addIssue({ code: "custom", message: "coverage.acts", path: ["coverage", "acts"] });
    }
    if (value.coverage.finalVotes !== value.finalVotes.length) {
      ctx.addIssue({ code: "custom", message: "coverage.finalVotes", path: ["coverage", "finalVotes"] });
    }
    const voteIds = new Set(value.finalVotes.map((vote) => vote.id));
    const actIds = new Set<string>();
    for (const [index, act] of value.acts.entries()) {
      if (actIds.has(act.id)) {
        ctx.addIssue({ code: "custom", message: "atto duplicato", path: ["acts", index, "id"] });
      }
      actIds.add(act.id);
      for (const linked of act.finalVoteIds) {
        if (!voteIds.has(linked)) {
          ctx.addIssue({
            code: "custom",
            message: "finalVoteId irrisolto",
            path: ["acts", index, "finalVoteIds"],
          });
        }
      }
      const coSigners = new Set(act.coSignerIds);
      if (coSigners.size !== act.coSignerIds.length || coSigners.has(act.firstSignerId)) {
        ctx.addIssue({
          code: "custom",
          message: "coSignerIds incoerenti",
          path: ["acts", index, "coSignerIds"],
        });
      }
    }
    for (const [index, vote] of value.finalVotes.entries()) {
      if (!actIds.has(vote.actId)) {
        ctx.addIssue({ code: "custom", message: "actId irrisolto", path: ["finalVotes", index, "actId"] });
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
      if (vote.favorevoli + vote.contrari !== vote.votanti) {
        ctx.addIssue({ code: "custom", message: "votanti != favorevoli+contrari", path: ["finalVotes", index, "votanti"] });
      }
      if (vote.favorevoli + vote.contrari + vote.astenuti !== vote.presenti) {
        ctx.addIssue({ code: "custom", message: "presenti != favorevoli+contrari+astenuti", path: ["finalVotes", index, "presenti"] });
      }
      if (vote.approved !== (vote.favorevoli > vote.maggioranza)) {
        ctx.addIssue({ code: "custom", message: "approvato incoerente", path: ["finalVotes", index, "approved"] });
      }
      if (vote.secret !== Object.values(vote.votes).includes("V")) {
        ctx.addIssue({ code: "custom", message: "flag secret incoerente", path: ["finalVotes", index, "secret"] });
      }
    }
    const referencedVoteIds = new Set(value.acts.flatMap((act) => act.finalVoteIds));
    for (const [index, vote] of value.finalVotes.entries()) {
      if (!referencedVoteIds.has(vote.id)) {
        ctx.addIssue({ code: "custom", message: "votazione non referenziata da alcun atto", path: ["finalVotes", index, "id"] });
      }
    }
  });

export type CameraAttiVotiSnapshot = z.infer<typeof cameraAttiVotiSnapshotSchema>;

export function parseCameraAttiVotiSnapshot(raw: unknown): CameraAttiVotiSnapshot {
  return cameraAttiVotiSnapshotSchema.parse(raw);
}
