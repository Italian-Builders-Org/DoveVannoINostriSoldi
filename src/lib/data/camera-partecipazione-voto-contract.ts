import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const percent = z.string().regex(/^\d+(?:\.\d+)?%$/u);

const deputyRowSchema = z.object({
  sourceName: z.string().min(1),
  groupLabel: z.string().min(1),
  deputyId: z.string().min(1).nullable(),
  numericId: z.string().regex(/^\d+$/u).nullable(),
  matchKind: z.enum(["exact", "fuzzy-name", "unique-surname", "unmatched"]),
  votesCast: z.number().int().nonnegative(),
  votesCastPercent: percent,
  missions: z.number().int().nonnegative(),
  missionsPercent: percent,
  presenceTotal: z.number().int().nonnegative(),
  presencePercent: percent,
  absences: z.number().int().nonnegative(),
  absencesPercent: percent,
  justifiedAbsences: z.number().int().nonnegative(),
  justifiedAbsencesPercent: percent,
});

export type CameraPartecipazioneDeputy = z.infer<typeof deputyRowSchema>;

export const cameraPartecipazioneVotoSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    chamber: z.literal("camera"),
    legislature: z.object({
      number: z.literal(19),
      label: z.string().min(1),
    }),
    period: z.object({
      label: z.string().min(1),
      observedDate: isoDate,
      monthLabel: z.string().min(1),
    }),
    coverage: z.object({
      rows: z.number().int().positive(),
      matchedDeputies: z.number().int().nonnegative(),
      unmatchedRows: z.number().int().nonnegative(),
      rosterDeputiesWithoutRow: z.number().int().nonnegative(),
    }),
    soldi: z.object({
      present: z.literal(false),
      note: z.string().min(1),
    }),
    source: z.object({
      owner: z.string().min(1),
      title: z.string().min(1),
      pageUrl: z.string().url(),
      landingUrl: z.string().url(),
      license: z.string().min(1),
      licenseUrl: z.string().url(),
      observedDate: isoDate,
      acquiredAt: isoDateTime,
      responses: z.object({
        vista: z.object({ bytes: z.number().int().positive(), sha256 }),
      }),
      cadence: z.string().min(1),
    }),
    provenance: z.object({
      kind: z.literal("official-html-table"),
      page: z.string().url(),
      gap: z.string().min(1),
    }),
    deputies: z.array(deputyRowSchema).min(1),
    caveats: z.array(z.string().min(1)).min(3),
  })
  .superRefine((value, ctx) => {
    if (value.coverage.rows !== value.deputies.length) {
      ctx.addIssue({ code: "custom", message: "coverage.rows", path: ["coverage", "rows"] });
    }
    const matched = value.deputies.filter((row) => row.deputyId !== null).length;
    if (value.coverage.matchedDeputies !== matched) {
      ctx.addIssue({
        code: "custom",
        message: "coverage.matchedDeputies",
        path: ["coverage", "matchedDeputies"],
      });
    }
    if (value.coverage.unmatchedRows !== value.deputies.length - matched) {
      ctx.addIssue({
        code: "custom",
        message: "coverage.unmatchedRows",
        path: ["coverage", "unmatchedRows"],
      });
    }
    const seen = new Set<string>();
    for (const [index, row] of value.deputies.entries()) {
      if (row.presenceTotal !== row.votesCast + row.missions) {
        ctx.addIssue({
          code: "custom",
          message: "presenze != voti+missioni",
          path: ["deputies", index, "presenceTotal"],
        });
      }
      if (row.deputyId) {
        if (seen.has(row.deputyId)) {
          ctx.addIssue({
            code: "custom",
            message: "deputyId duplicato",
            path: ["deputies", index, "deputyId"],
          });
        }
        seen.add(row.deputyId);
        if (!row.numericId) {
          ctx.addIssue({
            code: "custom",
            message: "numericId assente con match",
            path: ["deputies", index, "numericId"],
          });
        }
        if (row.matchKind === "unmatched") {
          ctx.addIssue({
            code: "custom",
            message: "matchKind incoerente",
            path: ["deputies", index, "matchKind"],
          });
        }
      } else if (row.matchKind !== "unmatched") {
        ctx.addIssue({
          code: "custom",
          message: "matchKind incoerente",
          path: ["deputies", index, "matchKind"],
        });
      }
    }
  });

export type CameraPartecipazioneVotoSnapshot = z.infer<typeof cameraPartecipazioneVotoSnapshotSchema>;

export function parseCameraPartecipazioneVotoSnapshot(raw: unknown): CameraPartecipazioneVotoSnapshot {
  return cameraPartecipazioneVotoSnapshotSchema.parse(raw);
}
