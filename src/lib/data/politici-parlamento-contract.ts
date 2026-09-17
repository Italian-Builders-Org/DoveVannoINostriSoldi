import { z } from "zod";

export const chamberIdSchema = z.enum(["camera", "senato"]);
export type ChamberId = z.infer<typeof chamberIdSchema>;

const parliamentaryGroupSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  chamber: chamberIdSchema,
  uri: z.string().url(),
  label: z.string().min(1),
  shortLabel: z.string().min(1),
  partyFamily: z.string().min(1),
  memberCount: z.number().int().positive(),
  relatedGroupIds: z.array(z.string().min(1)),
});

const parliamentPersonSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  chamber: chamberIdSchema,
  uri: z.string().url(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  displayName: z.string().min(1),
  roleLabel: z.string().min(1),
  gender: z.string().nullable(),
  officialPage: z.string().url(),
  photoUrl: z.string().url(),
  groupId: z.string().min(1),
  groupLabel: z.string().min(1),
  biography: z.string().min(1),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  birthPlace: z.string().min(1).nullable(),
});

export const politiciParlamentoSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  legislature: z.object({
    id: z.literal("19"),
    label: z.literal("XIX Legislatura"),
    startDate: z.literal("2022-10-13"),
  }),
  coverage: z.object({
    people: z.number().int().positive(),
    cameraMembers: z.number().int().positive(),
    senateMembers: z.number().int().positive(),
    groups: z.number().int().positive(),
    crossChamberGroupLinks: z.number().int().nonnegative(),
  }),
  chambers: z.array(z.object({
    id: chamberIdSchema,
    label: z.string().min(1),
    memberCount: z.number().int().positive(),
    seatCapacity: z.number().int().positive(),
    vacantSeats: z.number().int().nonnegative(),
    observedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sourceTitle: z.string().min(1),
    sourceUrl: z.string().url(),
    license: z.string().min(1),
  })).length(2),
  caveats: z.array(z.string().min(1)).min(1),
  groups: z.array(parliamentaryGroupSchema).min(1),
  people: z.array(parliamentPersonSchema).min(1),
}).superRefine((value, ctx) => {
  if (value.coverage.people !== value.people.length
    || value.coverage.cameraMembers + value.coverage.senateMembers !== value.people.length) {
    ctx.addIssue({ code: "custom", message: "copertura persone non riconcilia", path: ["coverage"] });
  }
  if (value.coverage.groups !== value.groups.length) {
    ctx.addIssue({ code: "custom", message: "copertura gruppi non riconcilia", path: ["coverage", "groups"] });
  }
  const groupIds = new Set(value.groups.map((group) => group.id));
  const personIds = new Set<string>();
  for (const [index, person] of value.people.entries()) {
    if (personIds.has(person.id)) {
      ctx.addIssue({ code: "custom", message: "persona duplicata", path: ["people", index, "id"] });
    }
    personIds.add(person.id);
    if (!groupIds.has(person.groupId)) {
      ctx.addIssue({ code: "custom", message: "gruppo sconosciuto", path: ["people", index, "groupId"] });
    }
  }
  for (const [index, group] of value.groups.entries()) {
    const count = value.people.filter((person) => person.groupId === group.id).length;
    if (count !== group.memberCount) {
      ctx.addIssue({ code: "custom", message: "memberCount non riconcilia", path: ["groups", index, "memberCount"] });
    }
    for (const relatedId of group.relatedGroupIds) {
      const related = value.groups.find((candidate) => candidate.id === relatedId);
      if (!related || related.chamber === group.chamber || related.partyFamily !== group.partyFamily) {
        ctx.addIssue({ code: "custom", message: "collegamento inter-camera incoerente", path: ["groups", index, "relatedGroupIds"] });
      }
    }
  }
});

export type PoliticiParlamentoSnapshot = z.infer<typeof politiciParlamentoSnapshotSchema>;
export type ParliamentPerson = PoliticiParlamentoSnapshot["people"][number];
export type ParliamentaryGroup = PoliticiParlamentoSnapshot["groups"][number];

export function parsePoliticiParlamentoSnapshot(input: unknown): PoliticiParlamentoSnapshot {
  return politiciParlamentoSnapshotSchema.parse(input);
}
