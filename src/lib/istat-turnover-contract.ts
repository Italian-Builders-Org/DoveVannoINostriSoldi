import { z } from "zod";

export const istatMacroSectorSchema = z.enum(["ALL", "INDUSTRIA", "SERVIZI"]);
export type IstatMacroSector = z.infer<typeof istatMacroSectorSchema>;

export const istatMetricIdSchema = z.enum([
  "turnover",
  "istat_local_units",
  "istat_employees",
  "istat_value_added",
  "istat_value_added_per_employee",
  "istat_turnover_per_employee",
]);
export type IstatMetricId = z.infer<typeof istatMetricIdSchema>;

export type IstatMetricFormat = "thousand-euro" | "integer" | "decimal" | "euro-per-employee";

export const istatTurnoverObservationSchema = z.object({
  observationType: z.literal("aggregate"),
  geographyLevel: z.literal("region"),
  geographyCode: z.string().regex(/^\d{2}$/),
  geographyName: z.string().min(1),
  macroSector: istatMacroSectorSchema,
  macroSectorLabel: z.string().min(1),
  atecoVersion: z.literal("ATECO 2007 agg. 2022"),
  metric: z.literal("turnover"),
  period: z.literal("2024"),
  unit: z.literal("migliaia di euro"),
  value: z.number().int().nonnegative(),
  localUnits: z.number().int().nonnegative().optional(),
  employees: z.number().nonnegative().optional(),
  payrollEmployees: z.number().nonnegative().optional(),
  laborCostThousandEuro: z.number().int().nonnegative().optional(),
  valueAddedThousandEuro: z.number().int().nonnegative().optional(),
  purchasesThousandEuro: z.number().int().nonnegative().optional(),
  sourceId: z.literal("istat-frame-territoriale-2024"),
}).strict();

export const istatTurnoverSourceSchema = z.object({
  id: z.literal("istat-frame-territoriale-2024"),
  label: z.string().min(1),
  publisher: z.string().min(1),
  url: z.string().url(),
  archive: z.object({
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  landingUrl: z.string().url(),
  license: z.literal("CC BY 4.0"),
  licenseUrl: z.string().url(),
  updatedAt: z.string().min(1),
  observedAt: z.string().min(1),
  cadence: z.string().min(1),
  coverage: z.string().min(1),
  caveat: z.string().min(1),
}).strict();

const EXPECTED_REGION_CODES = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
] as const;

export const istatTurnoverSnapshotBaseSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().min(1),
  observationType: z.literal("aggregate"),
  geographyLevel: z.literal("region"),
  geographyVersion: z.string().min(1),
  atecoVersion: z.literal("ATECO 2007 agg. 2022"),
  period: z.literal("2024"),
  unit: z.literal("migliaia di euro"),
  source: istatTurnoverSourceSchema,
  macroSectors: z.array(z.object({
    code: istatMacroSectorSchema,
    label: z.string().min(1),
  }).strict()).length(3),
  regions: z.array(z.object({
    code: z.string().regex(/^\d{2}$/),
    name: z.string().min(1),
  }).strict()).length(20),
  national: z.object({
    turnoverThousandEuro: z.number().int().nonnegative(),
    industryTurnoverThousandEuro: z.number().int().nonnegative(),
    servicesTurnoverThousandEuro: z.number().int().nonnegative(),
    localUnits: z.number().int().nonnegative(),
    industryLocalUnits: z.number().int().nonnegative(),
    servicesLocalUnits: z.number().int().nonnegative(),
    employees: z.number().nonnegative(),
    industryEmployees: z.number().nonnegative(),
    servicesEmployees: z.number().nonnegative(),
    valueAddedThousandEuro: z.number().int().nonnegative(),
    industryValueAddedThousandEuro: z.number().int().nonnegative(),
    servicesValueAddedThousandEuro: z.number().int().nonnegative(),
    laborCostThousandEuro: z.number().int().nonnegative(),
    industryLaborCostThousandEuro: z.number().int().nonnegative(),
    servicesLaborCostThousandEuro: z.number().int().nonnegative(),
    purchasesThousandEuro: z.number().int().nonnegative(),
    industryPurchasesThousandEuro: z.number().int().nonnegative(),
    servicesPurchasesThousandEuro: z.number().int().nonnegative(),
  }).strict(),
  observations: z.array(istatTurnoverObservationSchema).min(1),
  coverage: z.object({
    regionCount: z.literal(20),
    macroSectorCount: z.literal(3),
    totalObservations: z.literal(60),
    nullValues: z.literal(0),
    nationalTurnoverThousandEuro: z.number().int().nonnegative(),
    campaniaTurnoverThousandEuro: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export const istatTurnoverSnapshotSchema = istatTurnoverSnapshotBaseSchema.superRefine((snapshot, ctx) => {
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  };

  const regionCodes = snapshot.regions.map((region) => region.code);
  const regionSet = new Set(regionCodes);
  if (regionSet.size !== 20 || EXPECTED_REGION_CODES.some((code) => !regionSet.has(code))) {
    issue(["regions"], "La copertura deve contenere esattamente le 20 regioni ISTAT attese");
  }

  const observationKeys = new Set<string>();
  const byRegionSector = new Map<string, number>();

  for (const [index, row] of snapshot.observations.entries()) {
    if (!regionSet.has(row.geographyCode)) {
      issue(["observations", index], `Regione sconosciuta: ${row.geographyCode}`);
    }
    const key = `${row.geographyCode}|${row.macroSector}`;
    if (observationKeys.has(key)) {
      issue(["observations", index], `Osservazione duplicata per ${key}`);
    }
    observationKeys.add(key);
    byRegionSector.set(key, row.value);
  }

  if (snapshot.observations.length !== 60) {
    issue(["observations"], `Attese esattamente 60 osservazioni (20 regioni x 3 macro-settori), trovate ${snapshot.observations.length}`);
  }

  // Campania parity check: Tavola 1 turnover must be exactly 216750478
  const campaniaAll = byRegionSector.get("15|ALL");
  const campaniaInd = byRegionSector.get("15|INDUSTRIA");
  const campaniaSer = byRegionSector.get("15|SERVIZI");

  if (campaniaAll !== 216_750_478) {
    issue(["observations"], `Valore Campania ALL non conforme: atteso 216750478, ricevuto ${campaniaAll}`);
  }
  if (campaniaInd !== 78_917_895) {
    issue(["observations"], `Valore Campania INDUSTRIA non conforme: atteso 78917895, ricevuto ${campaniaInd}`);
  }
  if (campaniaSer !== 137_832_583) {
    issue(["observations"], `Valore Campania SERVIZI non conforme: atteso 137832583, ricevuto ${campaniaSer}`);
  }
  if (campaniaInd !== undefined && campaniaSer !== undefined && campaniaAll !== undefined) {
    if (campaniaInd + campaniaSer !== campaniaAll) {
      issue(["observations"], "La somma di Campania Industria e Servizi non coincide con il totale Campania");
    }
  }

  // National total parity
  if (snapshot.national.turnoverThousandEuro !== 3_768_464_269) {
    issue(["national", "turnoverThousandEuro"], "Totale nazionale fatturato non conforme all'aggregato ufficiale");
  }
});

export type IstatTurnoverObservation = z.infer<typeof istatTurnoverObservationSchema>;
export type IstatTurnoverSource = z.infer<typeof istatTurnoverSourceSchema>;
export type IstatTurnoverSnapshot = z.infer<typeof istatTurnoverSnapshotSchema>;

export function validateIstatTurnoverSnapshot(input: unknown): IstatTurnoverSnapshot {
  return istatTurnoverSnapshotSchema.parse(input);
}
