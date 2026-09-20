import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const mepId = z.string().regex(/^\d+$/u);

const mepSchema = z.object({
  id: mepId,
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  displayName: z.string().min(1),
  sortLabel: z.string().min(1),
  groupCode: z.string().min(1),
  countryOfRepresentation: z.literal("IT"),
  officialPage: z.string().url(),
  openDataId: z.string().min(1),
});

export const politiciEurodeputatiItSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("politici-eurodeputati-it"),
    institution: z.object({
      id: z.literal("parlamento-europeo"),
      label: z.string().min(1),
      chamberLabel: z.string().min(1),
      landingUrl: z.string().url(),
      openDataUrl: z.string().url(),
    }),
    period: z.object({
      kind: z.literal("point-in-time"),
      label: z.string().min(1),
      observedDate: isoDate,
    }),
    coverage: z.object({
      countryOfRepresentation: z.literal("IT"),
      memberCount: z.number().int().positive(),
      groupCount: z.number().int().positive(),
    }),
    groups: z.array(z.object({
      code: z.string().min(1),
      memberCount: z.number().int().positive(),
    })).min(1),
    meps: z.array(mepSchema).min(1),
    semantics: z.object({
      soldi: z.object({
        present: z.literal(false),
        note: z.string().min(1),
      }),
      periodo: z.object({
        kind: z.literal("point-in-time"),
        observedDate: isoDate,
      }),
      provenance: z.object({
        kind: z.literal("official-open-data-api"),
        endpoint: z.string().url(),
        filter: z.string().min(1),
      }),
    }),
    source: z.object({
      owner: z.string().min(1),
      endpointUrl: z.string().url(),
      landingUrl: z.string().url(),
      apiDocsUrl: z.string().url(),
      license: z.string().min(1),
      licenseUrl: z.string().url(),
      observedDate: isoDate,
      acquiredAt: isoDateTime,
      query: z.object({
        countryOfRepresentation: z.literal("IT"),
        limit: z.number().int().positive(),
        offset: z.number().int().nonnegative(),
      }),
      responses: z.object({
        currentMepsItaly: z.object({
          bytes: z.number().int().positive(),
          sha256: z.string().regex(/^[0-9a-f]{64}$/u),
        }),
      }),
      cadence: z.string().min(1),
    }),
    caveats: z.array(z.string().min(1)).min(4),
  })
  .superRefine((value, ctx) => {
    if (value.coverage.memberCount !== value.meps.length) {
      ctx.addIssue({ code: "custom", message: "memberCount diverge dalle persone", path: ["coverage", "memberCount"] });
    }
    if (value.coverage.groupCount !== value.groups.length) {
      ctx.addIssue({ code: "custom", message: "groupCount diverge dai gruppi", path: ["coverage", "groupCount"] });
    }
    if (value.source.observedDate !== value.period.observedDate) {
      ctx.addIssue({ code: "custom", message: "observedDate source/period diverge", path: ["source", "observedDate"] });
    }
    const seen = new Set<string>();
    const groupCounts = new Map<string, number>();
    let previousKey = "";
    for (const [index, mep] of value.meps.entries()) {
      if (seen.has(mep.id)) {
        ctx.addIssue({ code: "custom", message: `MEP duplicato ${mep.id}`, path: ["meps", index, "id"] });
      }
      seen.add(mep.id);
      if (mep.displayName !== `${mep.givenName} ${mep.familyName}`) {
        ctx.addIssue({ code: "custom", message: "displayName incoerente", path: ["meps", index, "displayName"] });
      }
      if (mep.officialPage !== `https://www.europarl.europa.eu/meps/it/${mep.id}`) {
        ctx.addIssue({ code: "custom", message: "scheda ufficiale non canonica", path: ["meps", index, "officialPage"] });
      }
      const sortKey = `${mep.familyName.toLocaleLowerCase("it-IT")}\0${mep.givenName.toLocaleLowerCase("it-IT")}\0${mep.id}`;
      if (previousKey && previousKey > sortKey) {
        ctx.addIssue({ code: "custom", message: "meps non in ordine alfabetico", path: ["meps", index] });
      }
      previousKey = sortKey;
      groupCounts.set(mep.groupCode, (groupCounts.get(mep.groupCode) ?? 0) + 1);
    }
    for (const [index, group] of value.groups.entries()) {
      if (groupCounts.get(group.code) !== group.memberCount) {
        ctx.addIssue({ code: "custom", message: "conteggio gruppo diverge", path: ["groups", index, "memberCount"] });
      }
    }
    if (![...groupCounts.keys()].every((code) => value.groups.some((group) => group.code === code))) {
      ctx.addIssue({ code: "custom", message: "gruppi incompleti rispetto alle persone", path: ["groups"] });
    }
  });

export type PoliticiEurodeputatiItSnapshot = z.infer<typeof politiciEurodeputatiItSnapshotSchema>;
export type PoliticiEurodeputato = PoliticiEurodeputatiItSnapshot["meps"][number];

export function parsePoliticiEurodeputatiItSnapshot(input: unknown): PoliticiEurodeputatiItSnapshot {
  return politiciEurodeputatiItSnapshotSchema.parse(input);
}
