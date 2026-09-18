import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);

const responseSchema = z.object({
  bytes: z.number().int().positive(),
  sha256,
});

const portraitSchema = z.object({
  personaId: z.string().regex(/^\d+$/u),
  displayName: z.string().min(1),
  role: z.string().min(1),
  wikidataId: z.string().regex(/^Q\d+$/u),
  wikidataLabel: z.string().min(1),
  wikidataPage: z.string().url(),
  fileTitle: z.string().min(1),
  filePage: z.string().url(),
  photoUrl: z.string().url().startsWith("https://upload.wikimedia.org/"),
  mime: z.enum(["image/jpeg", "image/png"]),
  width: z.number().int().min(200),
  height: z.number().int().min(200),
  bytes: z.number().int().min(4097),
  sha256,
  author: z.string().min(1),
  license: z.string().min(1),
  licenseId: z.string().min(1),
  licenseUrl: z.string().url().nullable(),
  credit: z.string().min(1),
});

export type FreePortrait = z.infer<typeof portraitSchema>;

export const ritrattiLiberiSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    coverage: z.object({
      portraits: z.number().int().positive(),
      declaredPeople: z.number().int().positive(),
      knownWithoutPortrait: z.number().int().nonnegative(),
    }),
    source: z.object({
      owner: z.string().min(1),
      title: z.string().min(1),
      wikidataApiUrl: z.string().url(),
      commonsApiUrl: z.string().url(),
      landingUrl: z.string().url(),
      license: z.string().min(1),
      licenseUrl: z.string().url(),
      thumbnailWidth: z.number().int().min(240).max(1024),
      observedDate: isoDate,
      acquiredAt: isoDateTime,
      responses: z.object({ wikidata: responseSchema, commons: responseSchema }),
      cadence: z.string().min(1),
    }),
    provenance: z.object({
      kind: z.literal("free-licensed-third-party-media"),
      wikidata: z.string().url(),
      commons: z.string().url(),
      gap: z.string().min(1),
    }),
    knownWithoutPortrait: z.array(
      z.object({
        personaId: z.string().regex(/^\d+$/u),
        displayName: z.string().min(1),
        wikidataId: z.string().regex(/^Q\d+$/u),
        note: z.string().min(1),
      }),
    ),
    portraits: z.array(portraitSchema).min(1),
    caveats: z.array(z.string().min(1)).min(3),
  })
  .superRefine((value, ctx) => {
    if (value.coverage.portraits !== value.portraits.length) {
      ctx.addIssue({ code: "custom", message: "coverage.portraits non riconcilia", path: ["coverage", "portraits"] });
    }
    if (value.coverage.knownWithoutPortrait !== value.knownWithoutPortrait.length) {
      ctx.addIssue({
        code: "custom",
        message: "coverage.knownWithoutPortrait non riconcilia",
        path: ["coverage", "knownWithoutPortrait"],
      });
    }
    const people = new Set<string>();
    const digests = new Set<string>();
    value.portraits.forEach((portrait, index) => {
      if (people.has(portrait.personaId)) {
        ctx.addIssue({ code: "custom", message: "persona duplicata", path: ["portraits", index, "personaId"] });
      }
      people.add(portrait.personaId);
      // Two people sharing a file would mean one of them is the wrong person.
      if (digests.has(portrait.sha256)) {
        ctx.addIssue({ code: "custom", message: "immagine condivisa da due persone", path: ["portraits", index, "sha256"] });
      }
      digests.add(portrait.sha256);
      if (!portrait.credit.includes(portrait.author) || !portrait.credit.includes(portrait.license)) {
        ctx.addIssue({
          code: "custom",
          message: "attribuzione incompleta",
          path: ["portraits", index, "credit"],
        });
      }
    });
    for (const gap of value.knownWithoutPortrait) {
      if (people.has(gap.personaId)) {
        ctx.addIssue({
          code: "custom",
          message: "persona dichiarata senza ritratto ma pubblicata con ritratto",
          path: ["knownWithoutPortrait"],
        });
      }
    }
  });

export type RitrattiLiberiSnapshot = z.infer<typeof ritrattiLiberiSnapshotSchema>;

export function parseRitrattiLiberiSnapshot(payload: unknown): RitrattiLiberiSnapshot {
  return ritrattiLiberiSnapshotSchema.parse(payload);
}
