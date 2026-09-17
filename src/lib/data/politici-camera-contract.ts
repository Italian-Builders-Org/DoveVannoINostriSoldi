import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });

const deputySchema = z.object({
  id: z.string().min(1),
  uri: z.string().url(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  displayName: z.string().min(1),
  gender: z.string().nullable().optional(),
  officialPage: z.string().url().nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  groupId: z.string().nullable(),
  groupLabel: z.string().nullable(),
});

const groupSchema = z.object({
  id: z.string().min(1),
  uri: z.string().url(),
  label: z.string().min(1),
  memberCount: z.number().int().nonnegative(),
});

export const politiciCameraSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  chamber: z.literal("camera"),
  legislature: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    uri: z.string().url(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  coverage: z.object({
    deputies: z.number().int().positive(),
    groups: z.number().int().positive(),
    deputiesWithGroup: z.number().int().nonnegative(),
    deputiesWithoutGroup: z.number().int().nonnegative(),
    seatCapacity: z.literal(400),
    vacantSeats: z.number().int().nonnegative(),
  }),
  source: z.object({
    owner: z.string().min(1),
    title: z.string().min(1),
    endpointUrl: z.string().url(),
    landingUrl: z.string().url(),
    license: z.string().min(1),
    licenseUrl: z.string().url(),
    legislatureUri: z.string().url(),
    acquiredAt: isoDateTime,
    responseBytes: z.number().int().positive(),
    responseSha256: z.string().regex(/^[0-9a-f]{64}$/),
    cadence: z.string().min(1),
  }),
  caveats: z.array(z.string().min(1)).min(1),
  groups: z.array(groupSchema).min(1),
  deputies: z.array(deputySchema).min(1),
}).superRefine((value, ctx) => {
  if (value.coverage.deputies !== value.deputies.length) {
    ctx.addIssue({ code: "custom", message: "coverage.deputies non coincide con deputies.length", path: ["coverage", "deputies"] });
  }
  if (value.coverage.groups !== value.groups.length) {
    ctx.addIssue({ code: "custom", message: "coverage.groups non coincide con groups.length", path: ["coverage", "groups"] });
  }
  if (value.coverage.deputiesWithGroup + value.coverage.deputiesWithoutGroup !== value.deputies.length) {
    ctx.addIssue({ code: "custom", message: "coverage with/without group non riconcilia", path: ["coverage"] });
  }
  if (value.coverage.vacantSeats !== value.coverage.seatCapacity - value.deputies.length) {
    ctx.addIssue({ code: "custom", message: "vacantSeats non riconcilia", path: ["coverage", "vacantSeats"] });
  }
  const groupIds = new Set(value.groups.map((group) => group.id));
  for (const [index, deputy] of value.deputies.entries()) {
    if (deputy.groupId && !groupIds.has(deputy.groupId)) {
      ctx.addIssue({ code: "custom", message: "deputato con groupId sconosciuto", path: ["deputies", index, "groupId"] });
    }
  }
  for (const [index, group] of value.groups.entries()) {
    const counted = value.deputies.filter((deputy) => deputy.groupId === group.id).length;
    if (counted !== group.memberCount) {
      ctx.addIssue({ code: "custom", message: "memberCount non riconcilia", path: ["groups", index, "memberCount"] });
    }
  }
});

export type PoliticiCameraSnapshot = z.infer<typeof politiciCameraSnapshotSchema>;

export function parsePoliticiCameraSnapshot(input: unknown): PoliticiCameraSnapshot {
  return politiciCameraSnapshotSchema.parse(input);
}
