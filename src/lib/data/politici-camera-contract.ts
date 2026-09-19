import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);

const responseSchema = z.object({
  bytes: z.number().int().positive(),
  sha256,
});

const institutionalRoleSchema = z.object({
  role: z.string().min(1),
  label: z.string().min(1),
  organ: z.string().min(1),
  since: isoDate,
});

const deputySchema = z.object({
  id: z.string().min(1),
  numericId: z.string().regex(/^\d+$/u),
  uri: z.string().url(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  displayName: z.string().min(1),
  gender: z.enum(["female", "male"]).nullable(),
  officialPage: z.string().url(),
  photoUrl: z.string().url(),
  groupId: z.string().min(1),
  groupLabel: z.string().min(1),
  groupDisplayLabel: z.string().min(1),
  groupSince: isoDate.nullable(),
  groupRole: z.string().min(1).nullable(),
  groupRoleLabel: z.string().min(1).nullable(),
  componentLabel: z.string().min(1).nullable(),
  institutionalRole: institutionalRoleSchema.nullable(),
  organIds: z.array(z.string().min(1)),
  birthDate: isoDate.nullable(),
  birthPlace: z.string().min(1).nullable(),
  constituency: z.string().min(1).nullable(),
  college: z.string().min(1).nullable(),
  coalition: z.string().min(1).nullable(),
  professionNote: z.string().min(1).nullable(),
  socialLinks: z
    .object({
      x: z.string().url().optional(),
      facebook: z.string().url().optional(),
      instagram: z.string().url().optional(),
      youtube: z.string().url().optional(),
    })
    .nullable(),
  biography: z.string().min(1),
});

const groupSchema = z.object({
  id: z.string().min(1),
  uri: z.string().url(),
  label: z.string().min(1),
  displayLabel: z.string().min(1),
  componentLabels: z.array(z.string().min(1)).nullable(),
  officialPage: z.string().url(),
  memberCount: z.number().int().positive(),
  presidentDeputyId: z.string().min(1).nullable(),
});

const organSchema = z.object({
  id: z.string().min(1),
  uri: z.string().url(),
  label: z.string().min(1),
  kind: z.enum([
    "commissione-permanente",
    "commissione",
    "bicamerale",
    "giunta",
    "comitato",
    "delegazione",
    "ufficio",
    "organo",
  ]),
  memberCount: z.number().int().positive(),
});

export const politiciCameraSnapshotSchema = z
  .object({
    schemaVersion: z.literal(2),
    chamber: z.literal("camera"),
    legislature: z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      uri: z.string().url(),
      startDate: isoDate,
    }),
    coverage: z.object({
      deputies: z.number().int().positive(),
      groups: z.number().int().positive(),
      deputiesWithGroup: z.number().int().nonnegative(),
      deputiesWithoutGroup: z.literal(0),
      seatCapacity: z.literal(400),
      vacantSeats: z.number().int().nonnegative(),
      deputiesWithPhoto: z.number().int().nonnegative(),
      deputiesWithBirthDate: z.number().int().nonnegative(),
      deputiesWithConstituency: z.number().int().nonnegative(),
      deputiesWithProfession: z.number().int().nonnegative(),
      groupLeaders: z.number().int().nonnegative(),
      institutionalRoles: z.number().int().nonnegative(),
      organs: z.number().int().nonnegative(),
    }),
    source: z.object({
      owner: z.string().min(1),
      title: z.string().min(1),
      endpointUrl: z.string().url(),
      landingUrl: z.string().url(),
      profileBaseUrl: z.string().url(),
      photoBaseUrl: z.string().url(),
      license: z.string().min(1),
      licenseUrl: z.string().url(),
      legislatureUri: z.string().url(),
      acquiredAt: isoDateTime,
      responses: z.object({
        roster: responseSchema,
        groupRoles: responseSchema,
        organs: responseSchema,
        profiles: responseSchema,
      }),
      cadence: z.string().min(1),
    }),
    caveats: z.array(z.string().min(1)).min(1),
    groups: z.array(groupSchema).min(1),
    organs: z.array(organSchema).min(1),
    deputies: z.array(deputySchema).min(1),
  })
  .superRefine((value, ctx) => {
    if (value.coverage.deputies !== value.deputies.length) {
      ctx.addIssue({ code: "custom", message: "coverage.deputies non coincide con deputies.length", path: ["coverage", "deputies"] });
    }
    if (value.coverage.groups !== value.groups.length) {
      ctx.addIssue({ code: "custom", message: "coverage.groups non coincide con groups.length", path: ["coverage", "groups"] });
    }
    if (value.coverage.deputies + value.coverage.vacantSeats !== value.coverage.seatCapacity) {
      ctx.addIssue({ code: "custom", message: "seggi e vacanze non riconciliano", path: ["coverage", "vacantSeats"] });
    }
    const groupIds = new Set(value.groups.map((group) => group.id));
    const organIds = new Set(value.organs.map((organ) => organ.id));
    const ids = new Set<string>();
    let presidents = 0;
    const membersByGroup = new Map<string, number>();
    value.deputies.forEach((deputy, index) => {
      if (ids.has(deputy.id)) {
        ctx.addIssue({ code: "custom", message: "deputato duplicato", path: ["deputies", index, "id"] });
      }
      ids.add(deputy.id);
      if (!groupIds.has(deputy.groupId)) {
        ctx.addIssue({ code: "custom", message: "gruppo sconosciuto", path: ["deputies", index, "groupId"] });
      } else {
        membersByGroup.set(deputy.groupId, (membersByGroup.get(deputy.groupId) ?? 0) + 1);
      }
      for (const organId of deputy.organIds) {
        if (!organIds.has(organId)) {
          ctx.addIssue({ code: "custom", message: "organo sconosciuto", path: ["deputies", index, "organIds"] });
        }
      }
      if (deputy.institutionalRole?.role === "PRESIDENTE" && deputy.institutionalRole.organ === "CAMERA DEI DEPUTATI") {
        presidents += 1;
      }
    });
    value.groups.forEach((group, index) => {
      if ((membersByGroup.get(group.id) ?? 0) !== group.memberCount) {
        ctx.addIssue({ code: "custom", message: "memberCount non coincide con i deputati del gruppo", path: ["groups", index, "memberCount"] });
      }
    });
    if (presidents !== 1) {
      ctx.addIssue({ code: "custom", message: "Presidente della Camera non unico", path: ["deputies"] });
    }
  });

export type PoliticiCameraSnapshot = z.infer<typeof politiciCameraSnapshotSchema>;
export type CameraDeputy = PoliticiCameraSnapshot["deputies"][number];
export type CameraGroup = PoliticiCameraSnapshot["groups"][number];

export function parsePoliticiCameraSnapshot(input: unknown): PoliticiCameraSnapshot {
  return politiciCameraSnapshotSchema.parse(input);
}
