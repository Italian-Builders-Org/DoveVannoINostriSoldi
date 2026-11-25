import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const euroIt = z.string().regex(/^\d{1,3}(?:\.\d{3})*,\d{2}$/u);

const componentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  amountEuro: euroIt,
  amountCents: z.number().int().positive(),
  currency: z.literal("EUR"),
  frequency: z.enum(["monthly", "quarterly", "annual"]),
  grossNet: z.enum(["gross", "net-before-local-surtaxes", "allowance", "withholding"]),
  appliesTo: z.literal("deputato"),
});

const historyStepSchema = z.object({
  componentId: z.string().min(1),
  fromYear: z.number().int().min(1948).nullable(),
  fromDate: isoDate.nullable(),
  amountEuro: euroIt,
  amountCents: z.number().int().positive(),
  basis: z.enum(["literal", "derived"]),
  evidence: z.string().min(1),
});

export type CameraTrattamentoHistoryStep = z.infer<typeof historyStepSchema>;

export type CameraTrattamentoComponent = z.infer<typeof componentSchema>;

export const cameraTrattamentoEconomicoSnapshotSchema = z
  .object({
    schemaVersion: z.literal(2),
    chamber: z.literal("camera"),
    referencePeriod: z.string().regex(/^\d{4}-\d{4}$/u),
    period: z.object({
      label: z.string().min(1),
      observedDate: isoDate,
    }),
    coverage: z.object({
      components: z.number().int().positive(),
    }),
    soldi: z.object({
      present: z.literal(true),
      unit: z.literal("EUR-cent"),
      nature: z.literal("institutional-rate"),
      note: z.string().min(1),
    }),
    source: z.object({
      owner: z.string().min(1),
      title: z.string().min(1),
      pageUrl: z.string().url(),
      landingUrl: z.string().url(),
      license: z.string().min(1),
      licenseUrl: z.string().url(),
      publicationDate: isoDate,
      observedDate: isoDate,
      acquiredAt: isoDateTime,
      responses: z.object({
        page: z.object({ bytes: z.number().int().positive(), sha256 }),
      }),
      // Locked hash: the section text. Raw bytes vary with Drupal CSS cache tokens.
      content: z.object({ chars: z.number().int().positive(), sha256 }),
      cadence: z.string().min(1),
    }),
    provenance: z.object({
      kind: z.literal("official-html-page"),
      page: z.string().url(),
      gap: z.string().min(1),
    }),
    summary: z.object({
      indemnityGrossMonthlyCents: z.number().int().positive(),
      indemnityNetBeforeLocalSurtaxesMonthlyCents: z.number().int().positive(),
      diariaMonthlyCents: z.number().int().positive(),
      constituentAllowanceMonthlyCents: z.number().int().positive(),
      indemnityGrossWithoutCutsMonthlyCents: z.number().int().positive(),
      pensionContributionBasisPoints: z.number().int().positive(),
    }),
    components: z.array(componentSchema).min(10),
    history: z.array(historyStepSchema).min(1),
    freeze: z.object({
      adjustmentsSuspendedFromYear: z.number().int(),
      confirmedThroughYear: z.number().int(),
      evidence: z.string().min(1),
    }),
    caveats: z.array(z.string().min(1)).min(3),
  })
  .superRefine((value, ctx) => {
    if (value.coverage.components !== value.components.length) {
      ctx.addIssue({
        code: "custom",
        message: "coverage.components",
        path: ["coverage", "components"],
      });
    }
    const byId = new Map(value.components.map((item) => [item.id, item]));
    for (const item of value.components) {
      if (item.id.startsWith("trattenuta-") !== (item.grossNet === "withholding")) {
        ctx.addIssue({ code: "custom", message: `trattenuta tipizzata male: ${item.id}`, path: ["components"] });
      }
    }
    const series = new Map<string, CameraTrattamentoHistoryStep[]>();
    for (const step of value.history) {
      if (!byId.has(step.componentId)) {
        ctx.addIssue({ code: "custom", message: `history su componente ignoto: ${step.componentId}`, path: ["history"] });
        continue;
      }
      series.set(step.componentId, [...(series.get(step.componentId) ?? []), step]);
    }
    for (const [componentId, steps] of series) {
      const keys = steps.map((step) => `${String(step.fromYear ?? 0).padStart(4, "0")}|${step.fromDate ?? ""}`);
      const ordered = keys.every((key, index) => index === 0 || key > keys[index - 1]!);
      const startsKnown = steps.slice(1).every((step) => step.fromYear !== null);
      if (!ordered || !startsKnown) {
        ctx.addIssue({ code: "custom", message: `history fuori ordine: ${componentId}`, path: ["history"] });
      }
      if (steps.at(-1)!.amountCents !== byId.get(componentId)!.amountCents) {
        ctx.addIssue({ code: "custom", message: `history non arriva all'importo in vigore: ${componentId}`, path: ["history"] });
      }
    }
    const expected = [
      ["indennita-parlamentare-lordo", value.summary.indemnityGrossMonthlyCents],
      ["indennita-parlamentare-netto-prima-addizionali", value.summary.indemnityNetBeforeLocalSurtaxesMonthlyCents],
      ["diaria", value.summary.diariaMonthlyCents],
      ["rimborso-eletti-elettori", value.summary.constituentAllowanceMonthlyCents],
    ] as const;
    for (const [id, cents] of expected) {
      const component = byId.get(id);
      if (!component) {
        ctx.addIssue({ code: "custom", message: `componente assente: ${id}`, path: ["components"] });
        continue;
      }
      if (component.amountCents !== cents) {
        ctx.addIssue({
          code: "custom",
          message: `summary non riconcilia ${id}`,
          path: ["summary"],
        });
      }
    }
  });

export type CameraTrattamentoEconomicoSnapshot = z.infer<typeof cameraTrattamentoEconomicoSnapshotSchema>;

export function parseCameraTrattamentoEconomicoSnapshot(raw: unknown): CameraTrattamentoEconomicoSnapshot {
  return cameraTrattamentoEconomicoSnapshotSchema.parse(raw);
}

export function formatEuroFromCents(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const frac = String(absolute % 100).padStart(2, "0");
  const digits = String(whole);
  const withGroups = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "−" : ""}${withGroups},${frac} €`;
}
