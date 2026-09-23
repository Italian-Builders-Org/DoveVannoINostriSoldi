import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const chamber = z.enum(["camera", "senato"]);
const legislature = z.number().int().min(1).max(19);
const CURRENT_LEGISLATURE = 19;

const sourceSchema = z.object({
  owner: z.string().min(1),
  endpointUrl: z.string().url(),
  landingUrl: z.string().url(),
  license: z.string().min(1),
  licenseUrl: z.string().url(),
  identity: z.string().min(1),
  response: z.object({ bytes: z.number().int().positive(), sha256 }),
});

const mandateSchema = z.object({
  chamber,
  legislature,
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
});

const memberSchema = z.object({
  id: z.string().regex(/^(d\d+_19|s\d+)$/u),
  chamber,
  sourceUri: z.string().url(),
  legislatures: z.object({
    camera: z.array(legislature),
    senato: z.array(legislature),
    parliament: z.array(legislature).min(1),
  }),
  firstTermInChamber: z.boolean(),
  firstTermInParliament: z.boolean(),
  mandates: z.array(mandateSchema).min(1),
});

function distinctSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export const parlamentoMandatiSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("parlamento-mandati-xix"),
    legislature: z.object({ number: z.literal(CURRENT_LEGISLATURE), label: z.string().min(1) }),
    coverage: z.object({
      deputies: z.number().int().positive(),
      senators: z.number().int().positive(),
      firstTermInChamberDeputies: z.number().int().nonnegative(),
      firstTermInChamberSenators: z.number().int().nonnegative(),
      firstTermInParliamentDeputies: z.number().int().nonnegative(),
      firstTermInParliamentSenators: z.number().int().nonnegative(),
      membersWithOtherChamberMandates: z.number().int().nonnegative(),
    }),
    source: z.object({
      acquiredAt: isoDateTime,
      camera: sourceSchema.extend({ endpointUrl: z.literal("https://dati.camera.it/sparql") }),
      senato: sourceSchema.extend({ endpointUrl: z.literal("https://dati.senato.it/sparql") }),
    }),
    caveats: z.array(z.string().min(1)).min(3),
    members: z.array(memberSchema).min(1),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    value.members.forEach((member, index) => {
      const path = ["members", index];
      if (ids.has(member.id)) ctx.addIssue({ code: "custom", message: "membro duplicato", path: [...path, "id"] });
      ids.add(member.id);
      if ((member.chamber === "camera") !== member.id.startsWith("d")) {
        ctx.addIssue({ code: "custom", message: "id e ramo discordano", path: [...path, "chamber"] });
      }
      const expected = {
        camera: distinctSorted(member.mandates.filter((item) => item.chamber === "camera").map((item) => item.legislature)),
        senato: distinctSorted(member.mandates.filter((item) => item.chamber === "senato").map((item) => item.legislature)),
        parliament: distinctSorted(member.mandates.map((item) => item.legislature)),
      };
      for (const key of ["camera", "senato", "parliament"] as const) {
        if (!sameList(member.legislatures[key], expected[key])) {
          ctx.addIssue({ code: "custom", message: `legislature.${key} non riconcilia con i mandati`, path: [...path, "legislatures", key] });
        }
      }
      if (!member.mandates.some((item) => item.chamber === member.chamber && item.legislature === CURRENT_LEGISLATURE && item.endDate === null)) {
        ctx.addIssue({ code: "custom", message: "nessun mandato XIX aperto nel ramo", path: [...path, "mandates"] });
      }
      if (member.firstTermInChamber !== sameList(expected[member.chamber], [CURRENT_LEGISLATURE])) {
        ctx.addIssue({ code: "custom", message: "firstTermInChamber incoerente", path: [...path, "firstTermInChamber"] });
      }
      if (member.firstTermInParliament !== sameList(expected.parliament, [CURRENT_LEGISLATURE])) {
        ctx.addIssue({ code: "custom", message: "firstTermInParliament incoerente", path: [...path, "firstTermInParliament"] });
      }
    });
    const count = (predicate: (member: (typeof value.members)[number]) => boolean) => value.members.filter(predicate).length;
    const expectedCoverage = {
      deputies: count((member) => member.chamber === "camera"),
      senators: count((member) => member.chamber === "senato"),
      firstTermInChamberDeputies: count((member) => member.chamber === "camera" && member.firstTermInChamber),
      firstTermInChamberSenators: count((member) => member.chamber === "senato" && member.firstTermInChamber),
      firstTermInParliamentDeputies: count((member) => member.chamber === "camera" && member.firstTermInParliament),
      firstTermInParliamentSenators: count((member) => member.chamber === "senato" && member.firstTermInParliament),
      membersWithOtherChamberMandates: count((member) => member.mandates.some((item) => item.chamber !== member.chamber)),
    };
    for (const [key, expected] of Object.entries(expectedCoverage)) {
      if (value.coverage[key as keyof typeof expectedCoverage] !== expected) {
        ctx.addIssue({ code: "custom", message: `coverage.${key} non riconcilia`, path: ["coverage", key] });
      }
    }
  });

export type ParlamentoMandatiSnapshot = z.infer<typeof parlamentoMandatiSnapshotSchema>;
export type ParlamentoMandatiMember = ParlamentoMandatiSnapshot["members"][number];

export function parseParlamentoMandatiSnapshot(input: unknown): ParlamentoMandatiSnapshot {
  return parlamentoMandatiSnapshotSchema.parse(input);
}
