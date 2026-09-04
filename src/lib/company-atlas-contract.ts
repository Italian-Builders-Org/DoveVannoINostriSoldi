import { z } from "zod";

export const companyAtlasMetricSchema = z.enum([
  "active_enterprises",
  "employees",
  "active_local_units",
  "production_value_band_count",
]);

export const companyAtlasObservationSchema = z.object({
  observationType: z.literal("aggregate"),
  geographyLevel: z.literal("region"),
  geographyCode: z.string().regex(/^\d{2}$/),
  geographyName: z.string().min(1),
  atecoVersion: z.literal("ATECO 2025"),
  sectorCode: z.string().min(1).max(2),
  sectorLabel: z.string().min(1),
  metric: companyAtlasMetricSchema,
  period: z.string().min(1).max(20),
  value: z.number().int().nonnegative().nullable(),
  bandCode: z.string().min(1).max(30).optional(),
  bandLabel: z.string().min(1).optional(),
  sourceId: z.enum(["active-stock", "workforce", "production-value"]),
}).strict();

const sourceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  url: z.string().url(),
  publisher: z.string().min(1),
  license: z.literal("CC BY 4.0"),
  updatedAt: z.string().min(1),
  observedAt: z.string().min(1),
  cadence: z.string().min(1),
  coverage: z.string().min(1),
  caveat: z.string().min(1),
}).strict();

const periodSchema = z.object({
  id: z.string().min(1).max(20),
  label: z.string().min(1),
}).strict();

const observedTimestampSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  "Timestamp con fuso orario non valido",
);

const coverageSchema = z.object({
  activeStockObservations: z.number().int().nonnegative(),
  activeStockNullValues: z.number().int().nonnegative(),
  workforceRowsRead: z.number().int().nonnegative(),
  workforceRowsAccepted: z.number().int().nonnegative(),
  workforceRegionCount: z.number().int().nonnegative(),
  workforceSectorCount: z.number().int().nonnegative(),
  workforceRegionSectorCells: z.number().int().nonnegative(),
  workforceObservedCells: z.number().int().nonnegative(),
  workforceMissingCells: z.number().int().nonnegative(),
  workforceNullObservations: z.number().int().nonnegative(),
  workforceEmployeesTotal: z.number().int().nonnegative(),
  workforceLocalUnitsTotal: z.number().int().nonnegative(),
  workforceObservations: z.number().int().nonnegative(),
  productionValueObservations: z.number().int().nonnegative(),
  productionValueNullValues: z.number().int().nonnegative(),
}).strict();

const companyAtlasSnapshotBaseSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: observedTimestampSchema,
  observationType: z.literal("aggregate"),
  geographyVersion: z.string().min(1),
  atecoVersion: z.literal("ATECO 2025"),
  sources: z.record(z.string(), sourceSchema),
  periods: z.object({
    activeStock: z.array(periodSchema).min(1),
    workforce: z.array(periodSchema).length(1),
    productionValue: z.array(periodSchema).length(1),
  }).strict(),
  regions: z.array(z.object({
    code: z.string().regex(/^\d{2}$/),
    name: z.string().min(1),
  }).strict()).length(20),
  sectors: z.array(z.object({
    code: z.string().min(1).max(2),
    label: z.string().min(1),
  }).strict()).length(23),
  productionBands: z.array(z.object({
    code: z.string().min(1).max(30),
    label: z.string().min(1),
  }).strict()).length(10),
  observations: z.array(companyAtlasObservationSchema).min(1),
  coverage: coverageSchema,
}).strict();

const EXPECTED_REGION_CODES = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
] as const;
const EXPECTED_SECTOR_CODES = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L",
  "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "X",
] as const;
const WORKFORCE_PERIOD = "2026-Q2";
const WORKFORCE_ROWS = 118_673;
const WORKFORCE_EMPLOYEES = 19_490_025;
const WORKFORCE_LOCAL_UNITS = 6_394_474;

export const companyAtlasSnapshotSchema = companyAtlasSnapshotBaseSchema.superRefine((snapshot, ctx) => {
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  };
  const regionCodes = snapshot.regions.map((region) => region.code);
  const sectorCodes = snapshot.sectors.map((sector) => sector.code);
  const regionSet = new Set(regionCodes);
  const sectorSet = new Set(sectorCodes);
  const expectedRegionSet = new Set(EXPECTED_REGION_CODES);
  const expectedSectorSet = new Set(EXPECTED_SECTOR_CODES);
  if (regionSet.size !== regionCodes.length || regionSet.size !== expectedRegionSet.size
    || EXPECTED_REGION_CODES.some((code) => !regionSet.has(code))) {
    issue(["regions"], "La copertura deve contenere esattamente le 20 regioni attese");
  }
  if (sectorSet.size !== sectorCodes.length || sectorSet.size !== expectedSectorSet.size
    || EXPECTED_SECTOR_CODES.some((code) => !sectorSet.has(code))) {
    issue(["sectors"], "La copertura deve contenere esattamente le 23 sezioni ATECO attese");
  }
  const sourceKeys = Object.keys(snapshot.sources);
  const expectedSourceKeys = ["active-stock", "workforce", "production-value"];
  if (sourceKeys.length !== expectedSourceKeys.length || expectedSourceKeys.some((key) => !sourceKeys.includes(key))) {
    issue(["sources"], "Le fonti devono essere esattamente quelle dichiarate");
  }
  for (const [sourceId, source] of Object.entries(snapshot.sources)) {
    if (source.id !== sourceId || source.observedAt !== snapshot.generatedAt) {
      issue(["sources", sourceId], "Identità o observedAt della fonte divergente dallo snapshot");
    }
  }
  const workforceCaveat = snapshot.sources.workforce?.caveat ?? "";
  if (!/posizioni previdenziali attive/i.test(workforceCaveat)
    || !/trimestre precedente/i.test(workforceCaveat)
    || !/occupazione/i.test(workforceCaveat)
    || !/istat.*asia/i.test(workforceCaveat)) {
    issue(["sources", "workforce", "caveat"], "Caveat ufficiale workforce assente o incompleto");
  }
  if (snapshot.periods.workforce[0]?.id !== WORKFORCE_PERIOD) {
    issue(["periods", "workforce"], `Il periodo workforce deve essere ${WORKFORCE_PERIOD}`);
  }

  const observationKeys = new Set<string>();
  const counts = new Map<string, number>();
  const workforceCells = new Map<string, { employees?: number | null; active_local_units?: number | null }>();
  let activeStockNullValues = 0;
  let productionValueNullValues = 0;
  for (const [index, row] of snapshot.observations.entries()) {
    if (!regionSet.has(row.geographyCode) || !sectorSet.has(row.sectorCode)) {
      issue(["observations", index], "Geografia o sezione non dichiarata nel catalogo snapshot");
    }
    if (row.geographyName !== snapshot.regions.find((region) => region.code === row.geographyCode)?.name) {
      issue(["observations", index, "geographyName"], "Nome geografico non coerente con il catalogo");
    }
    const key = [row.sourceId, row.metric, row.period, row.geographyCode, row.sectorCode, row.bandCode ?? ""].join("|");
    if (observationKeys.has(key)) issue(["observations", index], `Osservazione duplicata: ${key}`);
    observationKeys.add(key);
    const groupKey = [row.sourceId, row.metric, row.period].join("|");
    counts.set(groupKey, (counts.get(groupKey) ?? 0) + 1);
    if (row.sourceId === "active-stock") {
      if (row.metric !== "active_enterprises" || row.bandCode !== undefined) {
        issue(["observations", index], "Schema active-stock non coerente");
      }
      if (row.value === null) activeStockNullValues += 1;
    } else if (row.sourceId === "workforce") {
      if ((row.metric !== "employees" && row.metric !== "active_local_units") || row.bandCode !== undefined) {
        issue(["observations", index], "Schema workforce non coerente");
      }
      const cellKey = [row.geographyCode, row.sectorCode].join("|");
      const cell = workforceCells.get(cellKey) ?? {};
      if (row.metric === "employees") cell.employees = row.value;
      if (row.metric === "active_local_units") cell.active_local_units = row.value;
      workforceCells.set(cellKey, cell);
    } else if (row.sourceId === "production-value") {
      if (row.metric !== "production_value_band_count" || row.bandCode === undefined
        || !snapshot.productionBands.some((band) => band.code === row.bandCode)) {
        issue(["observations", index], "Schema production-value non coerente");
      }
      if (row.value === null) productionValueNullValues += 1;
    }
  }

  const activePeriods = snapshot.periods.activeStock.map((period) => period.id);
  if (new Set(activePeriods).size !== activePeriods.length) issue(["periods", "activeStock"], "Periodi active-stock duplicati");
  const expectedCellCount = EXPECTED_REGION_CODES.length * EXPECTED_SECTOR_CODES.length;
  const expectedActiveCount = activePeriods.length * expectedCellCount;
  const expectedProductionCount = expectedCellCount * snapshot.productionBands.length;
  for (const period of activePeriods) {
    const groupKey = ["active-stock", "active_enterprises", period].join("|");
    if ((counts.get(groupKey) ?? 0) !== expectedCellCount) issue(["observations"], `Cardinalità active-stock inattesa per ${period}`);
    for (const regionCode of EXPECTED_REGION_CODES) {
      for (const sectorCode of EXPECTED_SECTOR_CODES) {
        const key = ["active-stock", "active_enterprises", period, regionCode, sectorCode, ""].join("|");
        if (!observationKeys.has(key)) issue(["observations"], `Cella active-stock mancante: ${regionCode}/${sectorCode}/${period}`);
      }
    }
  }
  for (const metric of ["employees", "active_local_units"] as const) {
    const groupKey = ["workforce", metric, WORKFORCE_PERIOD].join("|");
    if ((counts.get(groupKey) ?? 0) !== expectedCellCount) issue(["observations"], `Cardinalità workforce inattesa per ${metric}`);
    for (const regionCode of EXPECTED_REGION_CODES) {
      for (const sectorCode of EXPECTED_SECTOR_CODES) {
        const key = ["workforce", metric, WORKFORCE_PERIOD, regionCode, sectorCode, ""].join("|");
        if (!observationKeys.has(key)) issue(["observations"], `Cella workforce mancante: ${regionCode}/${sectorCode}/${metric}`);
      }
    }
  }
  const productionPeriod = snapshot.periods.productionValue[0]?.id;
  const productionGroupKey = ["production-value", "production_value_band_count", productionPeriod].join("|");
  if ((counts.get(productionGroupKey) ?? 0) !== expectedProductionCount) {
    issue(["observations"], "Cardinalità production-value inattesa");
  }
  for (const regionCode of EXPECTED_REGION_CODES) {
    for (const sectorCode of EXPECTED_SECTOR_CODES) {
      for (const band of snapshot.productionBands) {
        const key = ["production-value", "production_value_band_count", productionPeriod, regionCode, sectorCode, band.code].join("|");
        if (!observationKeys.has(key)) issue(["observations"], `Cella production-value mancante: ${regionCode}/${sectorCode}/${band.code}`);
      }
    }
  }

  let workforceObservedCells = 0;
  let workforceMissingCells = 0;
  let workforceNullObservations = 0;
  let workforceEmployeesTotal = 0;
  let workforceLocalUnitsTotal = 0;
  for (const regionCode of EXPECTED_REGION_CODES) {
    for (const sectorCode of EXPECTED_SECTOR_CODES) {
      const cell = workforceCells.get([regionCode, sectorCode].join("|"));
      if (cell?.employees === undefined || cell.active_local_units === undefined) {
        issue(["observations"], `Cella workforce incompleta: ${regionCode}/${sectorCode}`);
        continue;
      }
      const bothNull = cell.employees === null && cell.active_local_units === null;
      const oneNull = cell.employees === null || cell.active_local_units === null;
      if (oneNull && !bothNull) issue(["observations"], `Null workforce parziale: ${regionCode}/${sectorCode}`);
      if (bothNull) {
        workforceMissingCells += 1;
        workforceNullObservations += 2;
      } else if (typeof cell.employees === "number" && typeof cell.active_local_units === "number") {
        workforceObservedCells += 1;
        workforceEmployeesTotal += cell.employees;
        workforceLocalUnitsTotal += cell.active_local_units;
      }
    }
  }
  const expectedCoverage = {
    activeStockObservations: expectedActiveCount,
    activeStockNullValues,
    workforceRowsRead: WORKFORCE_ROWS,
    workforceRowsAccepted: WORKFORCE_ROWS,
    workforceRegionCount: EXPECTED_REGION_CODES.length,
    workforceSectorCount: EXPECTED_SECTOR_CODES.length,
    workforceRegionSectorCells: expectedCellCount,
    workforceObservedCells,
    workforceMissingCells,
    workforceNullObservations,
    workforceEmployeesTotal: WORKFORCE_EMPLOYEES,
    workforceLocalUnitsTotal: WORKFORCE_LOCAL_UNITS,
    workforceObservations: expectedCellCount * 2,
    productionValueObservations: expectedProductionCount,
    productionValueNullValues,
  };
  for (const [key, value] of Object.entries(expectedCoverage)) {
    if (snapshot.coverage[key as keyof typeof snapshot.coverage] !== value) {
      issue(["coverage", key], `Copertura divergente: atteso ${value}`);
    }
  }
  if (workforceEmployeesTotal !== WORKFORCE_EMPLOYEES || workforceLocalUnitsTotal !== WORKFORCE_LOCAL_UNITS) {
    issue(["observations"], "Totali workforce non riconciliati con la release ufficiale");
  }
  const expectedObservationCount = expectedActiveCount + expectedCellCount * 2 + expectedProductionCount;
  if (snapshot.observations.length !== expectedObservationCount) {
    issue(["observations"], `Cardinalità complessiva inattesa: attese ${expectedObservationCount}`);
  }
});

export type CompanyAtlasMetric = z.infer<typeof companyAtlasMetricSchema>;
export type CompanyAtlasObservation = z.infer<typeof companyAtlasObservationSchema>;
export type CompanyAtlasSource = z.infer<typeof sourceSchema>;
export type CompanyAtlasSnapshot = z.infer<typeof companyAtlasSnapshotSchema>;

export function validateCompanyAtlasSnapshot(input: unknown): CompanyAtlasSnapshot {
  return companyAtlasSnapshotSchema.parse(input);
}
