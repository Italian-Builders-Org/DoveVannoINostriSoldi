import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);

const responseSchema = z.object({
  bytes: z.number().int().positive(),
  sha256,
});

const senatorSchema = z.object({
  id: z.string().min(1),
  uri: z.string().url(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  displayName: z.string().min(1),
  gender: z.enum(["F", "M"]),
  officialPage: z.string().url(),
  photoUrl: z.string().url(),
  groupId: z.string().min(1),
  groupLabel: z.string().min(1),
  groupRole: z.string().min(1).nullable(),
  groupRoleLabel: z.string().min(1).nullable(),
  institutionalRole: z
    .object({
      role: z.string().min(1),
      label: z.string().min(1),
      since: isoDate,
    })
    .nullable(),
  mandateType: z.string().min(1),
  isLifeSenator: z.boolean(),
  electionType: z.string().min(1).nullable(),
  electionMethod: z.enum(["uninominale", "proporzionale", "circoscrizione-estero"]).nullable(),
  region: z.string().min(1).nullable(),
  college: z.string().min(1).nullable(),
  profession: z.string().min(1).nullable(),
  birthDate: isoDate,
  birthPlace: z.string().min(1),
  biography: z.string().min(1),
});

const groupSchema = z.object({
  id: z.string().min(1),
  uri: z.string().url(),
  label: z.string().min(1),
  memberCount: z.number().int().positive(),
  presidentSenatorId: z.string().min(1).nullable(),
});

export const politiciSenatoSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    chamber: z.literal("senato"),
    legislature: z.object({
      id: z.literal("19"),
      label: z.string().min(1),
      uri: z.string().url(),
      startDate: isoDate,
    }),
    coverage: z.object({
      senators: z.number().int().positive(),
      groups: z.number().int().positive(),
      senatorsWithGroup: z.number().int().nonnegative(),
      electedSenators: z.number().int().positive(),
      lifeSenators: z.number().int().nonnegative(),
      electedSeatCapacity: z.literal(200),
      vacantElectedSeats: z.number().int().nonnegative(),
      senatorsWithPhoto: z.number().int().nonnegative(),
      senatorsWithProfession: z.number().int().nonnegative(),
      senatorsWithRegion: z.number().int().nonnegative(),
      groupLeaders: z.number().int().nonnegative(),
      presidencyRoles: z.number().int().nonnegative(),
    }),
    source: z.object({
      owner: z.string().min(1),
      title: z.string().min(1),
      endpointUrl: z.string().url(),
      sparqlEndpointUrl: z.string().url(),
      presidencyOrganUri: z.string().url(),
      landingUrl: z.string().url(),
      groupsLandingUrl: z.string().url(),
      license: z.string().min(1),
      licenseUrl: z.string().url(),
      observedDate: isoDate,
      acquiredAt: isoDateTime,
      responses: z.record(z.string(), responseSchema),
      cadence: z.string().min(1),
    }),
    caveats: z.array(z.string().min(1)).min(1),
    groups: z.array(groupSchema).min(1),
    senators: z.array(senatorSchema).min(1),
  })
  .superRefine((value, ctx) => {
    if (value.coverage.senators !== value.senators.length) {
      ctx.addIssue({ code: "custom", message: "coverage.senators non coincide con senators.length", path: ["coverage", "senators"] });
    }
    if (value.coverage.groups !== value.groups.length) {
      ctx.addIssue({ code: "custom", message: "coverage.groups non coincide con groups.length", path: ["coverage", "groups"] });
    }
    if (value.coverage.electedSenators + value.coverage.lifeSenators !== value.senators.length) {
      ctx.addIssue({ code: "custom", message: "elettivi e a vita non riconciliano", path: ["coverage", "electedSenators"] });
    }
    const groupIds = new Set(value.groups.map((group) => group.id));
    const ids = new Set<string>();
    let presidents = 0;
    value.senators.forEach((senator, index) => {
      if (ids.has(senator.id)) {
        ctx.addIssue({ code: "custom", message: "senatore duplicato", path: ["senators", index, "id"] });
      }
      ids.add(senator.id);
      if (!groupIds.has(senator.groupId)) {
        ctx.addIssue({ code: "custom", message: "gruppo sconosciuto", path: ["senators", index, "groupId"] });
      }
      if (senator.isLifeSenator !== senator.mandateType.startsWith("a vita")) {
        ctx.addIssue({ code: "custom", message: "mandato a vita incoerente", path: ["senators", index, "isLifeSenator"] });
      }
      if (senator.institutionalRole?.role === "Presidente del Senato") presidents += 1;
    });
    if (presidents !== 1) {
      ctx.addIssue({ code: "custom", message: "Presidente del Senato non unico", path: ["senators"] });
    }
  });

export type PoliticiSenatoSnapshot = z.infer<typeof politiciSenatoSnapshotSchema>;
export type SenatoSenator = PoliticiSenatoSnapshot["senators"][number];
export type SenatoGroup = PoliticiSenatoSnapshot["groups"][number];

export function parsePoliticiSenatoSnapshot(input: unknown): PoliticiSenatoSnapshot {
  return politiciSenatoSnapshotSchema.parse(input);
}
