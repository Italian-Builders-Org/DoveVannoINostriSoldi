import { z } from "zod";

const sourceResponseSchema = z.object({
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const senatorSchema = z.object({
  id: z.string().regex(/^s\d+$/),
  uri: z.string().url(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  displayName: z.string().min(1),
  gender: z.string().nullable(),
  officialPage: z.string().url(),
  photoUrl: z.string().url(),
  groupId: z.string().regex(/^g\d+$/),
  groupLabel: z.string().min(1),
  mandateType: z.string().min(1),
  isLifeSenator: z.boolean(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  birthPlace: z.string().min(1).nullable(),
  biography: z.string().min(1),
});

const groupSchema = z.object({
  id: z.string().regex(/^g\d+$/),
  uri: z.string().url(),
  label: z.string().min(1),
  memberCount: z.number().int().positive(),
});

export const politiciSenatoSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  chamber: z.literal("senato"),
  legislature: z.object({
    id: z.literal("19"),
    label: z.string().min(1),
    uri: z.string().url(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  coverage: z.object({
    senators: z.number().int().min(200).max(210),
    groups: z.number().int().positive(),
    senatorsWithGroup: z.number().int().positive(),
    electedSenators: z.number().int().nonnegative(),
    lifeSenators: z.number().int().nonnegative(),
    electedSeatCapacity: z.literal(200),
    vacantElectedSeats: z.number().int().nonnegative(),
  }),
  source: z.object({
    owner: z.literal("Senato della Repubblica"),
    title: z.string().min(1),
    endpointUrl: z.string().url(),
    landingUrl: z.string().url(),
    groupsLandingUrl: z.string().url(),
    license: z.string().min(1),
    licenseUrl: z.string().url(),
    observedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    acquiredAt: z.string().datetime({ offset: true }),
    responses: z.object({
      legislatureRoster: sourceResponseSchema,
      currentRoster: sourceResponseSchema,
      currentGroups: sourceResponseSchema,
    }),
    cadence: z.string().min(1),
  }),
  caveats: z.array(z.string().min(1)).min(1),
  groups: z.array(groupSchema).min(1),
  senators: z.array(senatorSchema).min(1),
}).superRefine((value, ctx) => {
  if (value.coverage.senators !== value.senators.length) {
    ctx.addIssue({ code: "custom", message: "coverage.senators non riconcilia", path: ["coverage", "senators"] });
  }
  if (value.coverage.groups !== value.groups.length) {
    ctx.addIssue({ code: "custom", message: "coverage.groups non riconcilia", path: ["coverage", "groups"] });
  }
  if (value.coverage.electedSenators + value.coverage.lifeSenators !== value.senators.length) {
    ctx.addIssue({ code: "custom", message: "tipi mandato non riconciliano", path: ["coverage"] });
  }
  if (value.coverage.vacantElectedSeats !== 200 - value.coverage.electedSenators) {
    ctx.addIssue({ code: "custom", message: "seggi elettivi non riconciliano", path: ["coverage", "vacantElectedSeats"] });
  }
  const groupIds = new Set(value.groups.map((group) => group.id));
  const personIds = new Set<string>();
  for (const [index, senator] of value.senators.entries()) {
    if (personIds.has(senator.id)) {
      ctx.addIssue({ code: "custom", message: "senatore duplicato", path: ["senators", index, "id"] });
    }
    personIds.add(senator.id);
    if (!groupIds.has(senator.groupId)) {
      ctx.addIssue({ code: "custom", message: "gruppo sconosciuto", path: ["senators", index, "groupId"] });
    }
  }
  for (const [index, group] of value.groups.entries()) {
    const count = value.senators.filter((senator) => senator.groupId === group.id).length;
    if (count !== group.memberCount) {
      ctx.addIssue({ code: "custom", message: "memberCount non riconcilia", path: ["groups", index, "memberCount"] });
    }
  }
});

export type PoliticiSenatoSnapshot = z.infer<typeof politiciSenatoSnapshotSchema>;

export function parsePoliticiSenatoSnapshot(input: unknown): PoliticiSenatoSnapshot {
  return politiciSenatoSnapshotSchema.parse(input);
}
