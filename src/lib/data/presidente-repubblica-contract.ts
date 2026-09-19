import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const presidenteRepubblicaSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    office: z.object({
      id: z.literal("presidente-della-repubblica"),
      role: z.string().min(1),
      institutionLabel: z.string().min(1),
      officialPage: z.string().url(),
      since: isoDate,
      secondTermSince: isoDate.nullable(),
      electedOn: isoDate,
      reelectedOn: isoDate.nullable(),
    }),
    holder: z.object({
      personaId: z.string().regex(/^\d+$/u),
      uri: z.string().url(),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      displayName: z.string().min(1),
      photoUrl: z.string().url(),
      photoCredit: z.string().min(1),
      officialPage: z.string().url(),
      biography: z.string().min(1),
      sameAs: z.array(z.string().min(1)),
    }),
    provenance: z.object({
      identity: z.literal("official-sparql"),
      identityEndpoint: z.string().url(),
      office: z.literal("declared-institutional-fact"),
      officeLandingUrl: z.string().url(),
      gap: z.string().min(1),
    }),
    source: z.object({
      owner: z.string().min(1),
      endpointUrl: z.string().url(),
      landingUrl: z.string().url(),
      license: z.string().min(1),
      licenseUrl: z.string().url(),
      observedDate: isoDate,
      acquiredAt: isoDateTime,
      responses: z.record(z.string(), z.object({
        bytes: z.number().int().positive(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      })),
      cadence: z.string().min(1),
    }),
    caveats: z.array(z.string().min(1)).min(1),
  })
  .superRefine((value, ctx) => {
    if (value.office.secondTermSince !== null && value.office.secondTermSince <= value.office.since) {
      ctx.addIssue({ code: "custom", message: "secondo mandato non successivo al primo", path: ["office", "secondTermSince"] });
    }
    if (value.office.electedOn > value.office.since) {
      ctx.addIssue({ code: "custom", message: "elezione successiva al giuramento", path: ["office", "electedOn"] });
    }
  });

export type PresidenteRepubblicaSnapshot = z.infer<typeof presidenteRepubblicaSnapshotSchema>;

export function parsePresidenteRepubblicaSnapshot(input: unknown): PresidenteRepubblicaSnapshot {
  return presidenteRepubblicaSnapshotSchema.parse(input);
}
