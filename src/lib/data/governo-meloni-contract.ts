import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);

const responseSchema = z.object({
  bytes: z.number().int().positive(),
  sha256,
});

export const governmentRoleKindSchema = z.enum([
  "presidente-del-consiglio",
  "vice-presidente",
  "ministro",
  "ministro-senza-portafoglio",
  "vice-ministro",
  "sottosegretario",
]);
export type GovernmentRoleKind = z.infer<typeof governmentRoleKindSchema>;

const departmentSchema = z.object({
  id: z.string().min(1),
  uri: z.string().url(),
  label: z.string().min(1),
  displayLabel: z.string().min(1),
  kind: z.enum(["presidenza", "ministero", "delega"]),
  memberCount: z.number().int().positive(),
});

const appointmentSchema = z.object({
  id: z.string().min(1),
  uri: z.string().url(),
  personaId: z.string().regex(/^\d+$/u),
  personName: z.string().min(1),
  role: z.string().min(1),
  roleKind: governmentRoleKindSchema,
  roleLabel: z.string().min(1),
  departmentId: z.string().min(1),
  since: isoDate,
  interim: z.boolean(),
});

const personSchema = z.object({
  personaId: z.string().regex(/^\d+$/u),
  uri: z.string().url(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  displayName: z.string().min(1),
  appointmentIds: z.array(z.string().min(1)).min(1),
  officialPage: z.string().url().nullable(),
  cameraLegislature: z.number().int().min(13).max(19).nullable(),
  photoUrl: z.string().url().nullable(),
  professionNote: z.string().min(1).nullable(),
  primaryRoleKind: governmentRoleKindSchema,
  primaryRoleLabel: z.string().min(1),
  primaryDepartmentId: z.string().min(1),
  since: isoDate,
  biography: z.string().min(1),
});

export const governoSnapshotSchema = z
  .object({
    schemaVersion: z.literal(2),
    government: z.object({
      id: z.string().min(1),
      uri: z.string().url(),
      label: z.string().min(1),
      startDate: isoDate,
      legislatureUri: z.string().url(),
      landingUrl: z.string().url(),
    }),
    coverage: z.object({
      appointments: z.number().int().positive(),
      people: z.number().int().positive(),
      departments: z.number().int().positive(),
      ministries: z.number().int().positive(),
      ministers: z.number().int().positive(),
      viceMinisters: z.number().int().nonnegative(),
      undersecretaries: z.number().int().nonnegative(),
      peopleWithOfficialPage: z.number().int().nonnegative(),
      peopleWithPhoto: z.number().int().nonnegative(),
      peopleWithProfessionNote: z.number().int().nonnegative(),
    }),
    source: z.object({
      owner: z.string().min(1),
      title: z.string().min(1),
      endpointUrl: z.string().url(),
      landingUrl: z.string().url(),
      rosterUrl: z.string().url(),
      legislatureUri: z.string().url(),
      license: z.string().min(1),
      licenseUrl: z.string().url(),
      acquiredAt: isoDateTime,
      responses: z.object({
        members: responseSchema,
        identities: responseSchema,
        roster: responseSchema,
      }),
      cadence: z.string().min(1),
    }),
    caveats: z.array(z.string().min(1)).min(1),
    departments: z.array(departmentSchema).min(1),
    appointments: z.array(appointmentSchema).min(1),
    people: z.array(personSchema).min(1),
  })
  .superRefine((value, ctx) => {
    if (value.coverage.people !== value.people.length) {
      ctx.addIssue({ code: "custom", message: "coverage.people non riconcilia", path: ["coverage", "people"] });
    }
    if (value.coverage.appointments !== value.appointments.length) {
      ctx.addIssue({ code: "custom", message: "coverage.appointments non riconcilia", path: ["coverage", "appointments"] });
    }
    const departmentIds = new Set(value.departments.map((department) => department.id));
    const appointmentIds = new Set(value.appointments.map((appointment) => appointment.id));
    value.appointments.forEach((appointment, index) => {
      if (!departmentIds.has(appointment.departmentId)) {
        ctx.addIssue({ code: "custom", message: "dicastero sconosciuto", path: ["appointments", index, "departmentId"] });
      }
    });
    const premiers = value.appointments.filter((item) => item.roleKind === "presidente-del-consiglio");
    if (premiers.length !== 1) {
      ctx.addIssue({ code: "custom", message: "Presidente del Consiglio non unico", path: ["appointments"] });
    }
    const personaIds = new Set<string>();
    value.people.forEach((person, index) => {
      if (personaIds.has(person.personaId)) {
        ctx.addIssue({ code: "custom", message: "persona duplicata", path: ["people", index, "personaId"] });
      }
      personaIds.add(person.personaId);
      for (const appointmentId of person.appointmentIds) {
        if (!appointmentIds.has(appointmentId)) {
          ctx.addIssue({ code: "custom", message: "incarico sconosciuto", path: ["people", index, "appointmentIds"] });
        }
      }
      if ((person.photoUrl === null) !== (person.cameraLegislature === null)) {
        // A portrait only exists in the archive of a legislature the person sat in,
        // but a mandate does not guarantee the picture was published.
        if (person.photoUrl !== null) {
          ctx.addIssue({ code: "custom", message: "ritratto senza mandato Camera", path: ["people", index, "photoUrl"] });
        }
      }
      if (person.photoUrl !== null && !person.photoUrl.endsWith(`d${person.personaId}.jpg`)) {
        ctx.addIssue({ code: "custom", message: "ritratto di un'altra persona", path: ["people", index, "photoUrl"] });
      }
    });
  });

export type GovernoSnapshot = z.infer<typeof governoSnapshotSchema>;
export type GovernoPerson = GovernoSnapshot["people"][number];
export type GovernoAppointment = GovernoSnapshot["appointments"][number];
export type GovernoDepartment = GovernoSnapshot["departments"][number];

export function parseGovernoSnapshot(input: unknown): GovernoSnapshot {
  return governoSnapshotSchema.parse(input);
}
