import { z } from "zod";

export const institutionIdSchema = z.enum(["presidenza-repubblica", "governo", "camera", "senato"]);
export type InstitutionId = z.infer<typeof institutionIdSchema>;

export const chamberIdSchema = z.enum(["camera", "senato"]);
export type ChamberId = z.infer<typeof chamberIdSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

/** Every published field keeps the provenance of the snapshot it came from. */
const sourceRefSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  license: z.string().min(1),
  observedDate: isoDate,
  provenance: z.enum([
    "official-sparql",
    "official-json-exports",
    "official-sparql-and-official-profiles",
    "official-sparql-and-official-roster",
    "official-json-exports-and-official-sparql",
    "official-sparql-identity-with-declared-office",
    "free-licensed-third-party-media",
  ]),
  gap: z.string().min(1).nullable(),
});

const institutionSchema = z.object({
  id: institutionIdSchema,
  kind: z.enum(["capo-stato", "governo", "assemblea"]),
  tier: z.number().int().min(0).max(2),
  label: z.string().min(1),
  shortLabel: z.string().min(1),
  role: z.string().min(1),
  description: z.string().min(1),
  officialPage: z.string().url(),
  memberCount: z.number().int().nonnegative(),
  seatCapacity: z.number().int().positive().nullable(),
  vacantSeats: z.number().int().nonnegative().nullable(),
  leaderPersonId: z.string().min(1).nullable(),
  leaderRoleLabel: z.string().min(1).nullable(),
  source: sourceRefSchema,
});

export const roleKindSchema = z.enum([
  "capo-stato",
  "presidente-del-consiglio",
  "vice-presidente-consiglio",
  "ministro",
  "ministro-senza-portafoglio",
  "vice-ministro",
  "sottosegretario",
  "presidente-assemblea",
  "vicepresidente-assemblea",
  "questore",
  "segretario-presidenza",
  "incarico-gruppo",
  "deputato",
  "senatore",
  "senatore-a-vita",
]);
export type RoleKind = z.infer<typeof roleKindSchema>;

const roleSchema = z.object({
  kind: roleKindSchema,
  label: z.string().min(1),
  institutionId: institutionIdSchema,
  organLabel: z.string().min(1).nullable(),
  since: isoDate.nullable(),
});

const groupSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  chamberId: chamberIdSchema,
  uri: z.string().url(),
  label: z.string().min(1),
  shortLabel: z.string().min(1),
  partyFamily: z.string().min(1),
  officialPage: z.string().url(),
  memberCount: z.number().int().positive(),
  presidentPersonId: z.string().min(1).nullable(),
  componentLabels: z.array(z.string().min(1)),
  relatedGroupIds: z.array(z.string().min(1)),
});

const departmentSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["presidenza", "ministero", "delega"]),
  label: z.string().min(1),
  memberCount: z.number().int().positive(),
});

const personSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  sortKey: z.string().min(1),
  gender: z.enum(["female", "male"]).nullable(),
  tier: z.number().int().min(0).max(3),
  photoUrl: z.string().url().nullable(),
  photoCredit: z.string().min(1).nullable(),
  officialPages: z.array(z.object({ label: z.string().min(1), url: z.string().url() })).min(1),
  primaryInstitutionId: institutionIdSchema,
  primaryRoleKind: roleKindSchema,
  primaryRoleLabel: z.string().min(1),
  chamberId: chamberIdSchema.nullable(),
  groupId: z.string().min(1).nullable(),
  groupLabel: z.string().min(1).nullable(),
  groupShortLabel: z.string().min(1).nullable(),
  partyFamily: z.string().min(1).nullable(),
  componentLabel: z.string().min(1).nullable(),
  groupRoleLabel: z.string().min(1).nullable(),
  roles: z.array(roleSchema).min(1),
  departmentIds: z.array(z.string().min(1)),
  organLabels: z.array(z.string().min(1)),
  constituency: z.string().min(1).nullable(),
  college: z.string().min(1).nullable(),
  profession: z.string().min(1).nullable(),
  birthDate: isoDate.nullable(),
  birthPlace: z.string().min(1).nullable(),
  socialLinks: z
    .object({
      x: z.string().url().optional(),
      facebook: z.string().url().optional(),
      instagram: z.string().url().optional(),
      youtube: z.string().url().optional(),
    })
    .nullable(),
  biography: z.string().min(1),
  isGovernmentMember: z.boolean(),
  isInstitutionalLeader: z.boolean(),
  isGroupLeader: z.boolean(),
  weight: z.number().min(0).max(1),
});

export const edgeKindSchema = z.enum([
  "gerarchia",
  "vertice-istituzionale",
  "gruppo-assemblea",
  "famiglia-politica",
  "incarico-governo",
]);
export type EdgeKind = z.infer<typeof edgeKindSchema>;

const edgeSchema = z.object({
  id: z.string().min(1),
  kind: edgeKindSchema,
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().int().positive(),
});

export const politiciRepubblicaSchema = z
  .object({
    schemaVersion: z.literal(1),
    legislature: z.object({
      id: z.literal("19"),
      label: z.literal("XIX Legislatura"),
      startDate: z.literal("2022-10-13"),
    }),
    updatedAt: isoDate,
    coverage: z.object({
      people: z.number().int().positive(),
      deputies: z.number().int().positive(),
      senators: z.number().int().positive(),
      governmentMembers: z.number().int().positive(),
      nonParliamentaryGovernmentMembers: z.number().int().nonnegative(),
      groups: z.number().int().positive(),
      departments: z.number().int().positive(),
      institutionalLeaders: z.number().int().positive(),
      peopleWithPhoto: z.number().int().nonnegative(),
      peopleWithBiography: z.number().int().nonnegative(),
      crossChamberFamilyLinks: z.number().int().nonnegative(),
    }),
    institutions: z.array(institutionSchema).length(4),
    groups: z.array(groupSchema).min(1),
    departments: z.array(departmentSchema).min(1),
    people: z.array(personSchema).min(1),
    edges: z.array(edgeSchema).min(1),
    partyFamilies: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          shortLabel: z.string().min(1),
          memberCount: z.number().int().positive(),
          chamberIds: z.array(chamberIdSchema).min(1),
        }),
      )
      .min(1),
    caveats: z.array(z.string().min(1)).min(3),
    sources: z.array(sourceRefSchema).min(5),
  })
  .superRefine((value, ctx) => {
    const { coverage, people, groups, institutions, departments, edges } = value;
    if (coverage.people !== people.length) {
      ctx.addIssue({ code: "custom", message: "copertura persone non riconcilia", path: ["coverage", "people"] });
    }
    if (coverage.groups !== groups.length) {
      ctx.addIssue({ code: "custom", message: "copertura gruppi non riconcilia", path: ["coverage", "groups"] });
    }
    if (coverage.departments !== departments.length) {
      ctx.addIssue({ code: "custom", message: "copertura dicasteri non riconcilia", path: ["coverage", "departments"] });
    }

    const personIds = new Set<string>();
    const groupIds = new Set(groups.map((group) => group.id));
    const departmentIds = new Set(departments.map((department) => department.id));
    let deputies = 0;
    let senators = 0;
    let governmentMembers = 0;
    let leaders = 0;

    people.forEach((person, index) => {
      if (personIds.has(person.id)) {
        ctx.addIssue({ code: "custom", message: "persona duplicata", path: ["people", index, "id"] });
      }
      personIds.add(person.id);
      if (person.groupId !== null && !groupIds.has(person.groupId)) {
        ctx.addIssue({ code: "custom", message: "gruppo sconosciuto", path: ["people", index, "groupId"] });
      }
      if (person.chamberId !== null && person.groupId === null) {
        ctx.addIssue({ code: "custom", message: "parlamentare senza gruppo", path: ["people", index, "groupId"] });
      }
      for (const departmentId of person.departmentIds) {
        if (!departmentIds.has(departmentId)) {
          ctx.addIssue({ code: "custom", message: "dicastero sconosciuto", path: ["people", index, "departmentIds"] });
        }
      }
      if (person.isGovernmentMember !== (person.departmentIds.length > 0)) {
        ctx.addIssue({ code: "custom", message: "incarico di governo incoerente", path: ["people", index, "isGovernmentMember"] });
      }
      if (!person.roles.some((role) => role.kind === person.primaryRoleKind)) {
        ctx.addIssue({ code: "custom", message: "ruolo principale non presente tra i ruoli", path: ["people", index, "primaryRoleKind"] });
      }
      if ((person.photoUrl === null) !== (person.photoCredit === null)) {
        ctx.addIssue({ code: "custom", message: "ritratto senza attribuzione", path: ["people", index, "photoCredit"] });
      }
      deputies += person.roles.some((role) => role.kind === "deputato") ? 1 : 0;
      senators += person.roles.some((role) => role.kind === "senatore" || role.kind === "senatore-a-vita") ? 1 : 0;
      governmentMembers += person.isGovernmentMember ? 1 : 0;
      leaders += person.isInstitutionalLeader ? 1 : 0;
    });

    if (coverage.deputies !== deputies) {
      ctx.addIssue({ code: "custom", message: "copertura deputati non riconcilia", path: ["coverage", "deputies"] });
    }
    if (coverage.senators !== senators) {
      ctx.addIssue({ code: "custom", message: "copertura senatori non riconcilia", path: ["coverage", "senators"] });
    }
    if (coverage.governmentMembers !== governmentMembers) {
      ctx.addIssue({ code: "custom", message: "copertura governo non riconcilia", path: ["coverage", "governmentMembers"] });
    }
    if (coverage.institutionalLeaders !== leaders) {
      ctx.addIssue({ code: "custom", message: "copertura vertici non riconcilia", path: ["coverage", "institutionalLeaders"] });
    }
    if (coverage.peopleWithPhoto !== people.filter((person) => person.photoUrl !== null).length) {
      ctx.addIssue({ code: "custom", message: "copertura ritratti non riconcilia", path: ["coverage", "peopleWithPhoto"] });
    }

    groups.forEach((group, index) => {
      const counted = people.filter((person) => person.groupId === group.id).length;
      if (counted !== group.memberCount) {
        ctx.addIssue({ code: "custom", message: "memberCount di gruppo non riconcilia", path: ["groups", index, "memberCount"] });
      }
      if (group.presidentPersonId !== null && !personIds.has(group.presidentPersonId)) {
        ctx.addIssue({ code: "custom", message: "presidente di gruppo sconosciuto", path: ["groups", index, "presidentPersonId"] });
      }
      for (const relatedId of group.relatedGroupIds) {
        const related = groups.find((candidate) => candidate.id === relatedId);
        if (!related || related.chamberId === group.chamberId || related.partyFamily !== group.partyFamily) {
          ctx.addIssue({ code: "custom", message: "collegamento tra rami incoerente", path: ["groups", index, "relatedGroupIds"] });
        }
      }
    });

    const nodeIds = new Set<string>([...personIds, ...groupIds, ...institutions.map((item) => item.id)]);
    const edgeIds = new Set<string>();
    edges.forEach((edge, index) => {
      if (edgeIds.has(edge.id)) {
        ctx.addIssue({ code: "custom", message: "relazione duplicata", path: ["edges", index, "id"] });
      }
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        ctx.addIssue({ code: "custom", message: "relazione verso un nodo inesistente", path: ["edges", index] });
      }
      if (edge.source === edge.target) {
        ctx.addIssue({ code: "custom", message: "relazione riflessiva", path: ["edges", index] });
      }
    });

    for (const institution of institutions) {
      if (institution.leaderPersonId !== null && !personIds.has(institution.leaderPersonId)) {
        ctx.addIssue({ code: "custom", message: "vertice di istituzione sconosciuto", path: ["institutions"] });
      }
    }
  });

export type PoliticiRepubblicaGraph = z.infer<typeof politiciRepubblicaSchema>;
export type RepublicPerson = PoliticiRepubblicaGraph["people"][number];
export type RepublicGroup = PoliticiRepubblicaGraph["groups"][number];
export type RepublicInstitution = PoliticiRepubblicaGraph["institutions"][number];
export type RepublicEdge = PoliticiRepubblicaGraph["edges"][number];
export type RepublicRole = RepublicPerson["roles"][number];

export function parsePoliticiRepubblicaGraph(input: unknown): PoliticiRepubblicaGraph {
  return politiciRepubblicaSchema.parse(input);
}
