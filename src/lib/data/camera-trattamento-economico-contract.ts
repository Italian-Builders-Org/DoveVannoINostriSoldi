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
  frequency: z.literal("monthly"),
  grossNet: z.enum(["gross", "net-before-local-surtaxes", "allowance"]),
  appliesTo: z.literal("deputato"),
});

export type CameraTrattamentoComponent = z.infer<typeof componentSchema>;

export const cameraTrattamentoEconomicoSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    chamber: z.literal("camera"),
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
      observedDate: isoDate,
      acquiredAt: isoDateTime,
      responses: z.object({
        page: z.object({ bytes: z.number().int().positive(), sha256 }),
      }),
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
    }),
    components: z.array(componentSchema).min(4),
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
