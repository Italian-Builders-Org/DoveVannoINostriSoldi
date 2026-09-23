import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/istat-poverta-regioni-2014-2024.source.json";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const locked = <T>(expected: T) =>
  z.custom<T>((value) => canonical(value) === canonical(expected), "Campo diverso dal lock povertà regioni");
const SCALE_FACTOR = 100;
const FIRST_YEAR = 2014;
const LAST_YEAR = 2024;
const UNDIFFUSED_FLAG = "0";
const MEASURE_KEYS = ["households", "individuals"] as const;

if (sourceLock.semantics.soldi.present !== false
  || sourceLock.measures.length !== MEASURE_KEYS.length
  || sourceLock.measures.some((measure, index) => measure.key !== MEASURE_KEYS[index])) {
  throw new Error("Snapshot povertà regioni: il lock deve dichiarare due misure e nessun importo.");
}

const expectedPublicMetadata = {
  period: [
    `Anni ${FIRST_YEAR}–${LAST_YEAR}, serie corrente post-revisione`,
    sourceLock.semantics.periodo.note,
    `Dataflow aggiornati ${sourceLock.source.dataflowLastUpdate.slice(0, 10)}; acquisizione ${sourceLock.source.acquisitionDate}`,
  ],
  units: [
    `Incidenze in centesimi di punto percentuale (scale factor ${SCALE_FACTOR})`,
    "UNIT_MEAS assente nel payload: l'unità è dichiarata dal codice misura, non dedotta",
  ],
  coverage: sourceLock.reconciliation.note,
  references: sourceLock.source.reuseTermsEvidence.map((url) => ({
    label: url.includes("open-data") ? "ISTAT · Open Data" : "ISTAT · Note legali",
    url,
  })),
};

const measureSchema = z.enum(MEASURE_KEYS);
const yearSchema = z.number().int().min(FIRST_YEAR).max(LAST_YEAR);

const observationSchema = z.object({
  territory: z.string(),
  measure: measureSchema,
  year: yearSchema,
  valueHundredths: z.number().int().min(0).max(100 * SCALE_FACTOR),
}).strict();

/** Cella che la fonte non diffonde: porta un simbolo al posto del numero, mai uno zero. */
const undiffusedSchema = z.object({
  territory: z.string(),
  measure: measureSchema,
  year: yearSchema,
  flag: z.literal(UNDIFFUSED_FLAG),
}).strict();

/** Riga che dalla risposta manca del tutto: è un'assenza diversa, e resta distinta. */
const missingRowSchema = z.object({
  territory: z.string(),
  measure: measureSchema,
  year: yearSchema,
}).strict();

const totals = sourceLock.reconciliation.byMeasure;
const publishedTotal = totals.households.published + totals.individuals.published;
const undiffusedTotal = totals.households.undiffused + totals.individuals.undiffused;
const missingTotal = totals.households.missing + totals.individuals.missing;

const dataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("istat-poverta-regioni"),
  domain: locked(sourceLock.domain),
  period: locked(sourceLock.period),
  periodNote: locked(sourceLock.periodNote),
  measures: locked(sourceLock.measures),
  territories: locked(sourceLock.territories),
  flags: locked(sourceLock.flags),
  caveats: locked(sourceLock.caveats),
  reconciliation: locked(sourceLock.reconciliation),
  scale: z.object({ factor: z.literal(SCALE_FACTOR), note: z.string().min(1) }).strict(),
  observations: z.array(observationSchema).length(publishedTotal),
  undiffused: z.array(undiffusedSchema).length(undiffusedTotal),
  missingRows: z.array(missingRowSchema).length(missingTotal),
  ratioBounds: locked(sourceLock.invariants.individualToHouseholdRatio),
}).strict();

export type IstatPovertaRegioniData = z.infer<typeof dataSchema>;

export function validateIstatPovertaRegioniBundle(data: unknown, metadata: unknown) {
  const { integrity } = sourceLock;
  const normalizedLock = { ...sourceLock, integrity: { ...integrity, sourceLockSha256: "" } };
  if (digest(normalizedLock) !== integrity.sourceLockSha256) {
    throw new Error("Snapshot povertà regioni: hash del source lock diverso.");
  }
  const parsed = dataSchema.parse(data);
  const serialized = canonical(parsed);
  if (digest(parsed) !== integrity.dataArtifact.sha256 || Buffer.byteLength(serialized) !== integrity.dataArtifact.bytes) {
    throw new Error("Snapshot povertà regioni: hash o dimensione dell'artefatto diversi dal lock.");
  }
  const expectedMetadata = {
    schemaVersion: 1,
    datasetId: "istat-poverta-regioni",
    period: sourceLock.period,
    acquiredAt: sourceLock.source.acquisitionDate,
    source: sourceLock.source,
    semantics: sourceLock.semantics,
    publicMetadata: expectedPublicMetadata,
    integrity,
  };
  if (canonical(metadata) !== canonical(expectedMetadata)) {
    throw new Error("Snapshot povertà regioni: metadati diversi da fonte, semantica o integrità dichiarate.");
  }

  const territories = new Map(parsed.territories.map((item) => [item.code, item]));
  for (const territory of parsed.territories) {
    if (territory.parent !== null && !territories.has(territory.parent)) {
      throw new Error("Snapshot povertà regioni: gerarchia territoriale incoerente.");
    }
  }

  const published = new Set<string>();
  const perMeasure = new Map<string, number>();
  for (const row of parsed.observations) {
    const key = `${row.measure}/${row.territory}/${row.year}`;
    if (!territories.has(row.territory) || published.has(key)) {
      throw new Error("Snapshot povertà regioni: chiave duplicata o territorio fuori contratto.");
    }
    published.add(key);
    perMeasure.set(row.measure, (perMeasure.get(row.measure) ?? 0) + 1);
  }

  // Un'assenza dichiarata non può essere anche un valore: sono i due lati dello stesso conto.
  const declared = new Set<string>();
  for (const row of [...parsed.undiffused, ...parsed.missingRows]) {
    const key = `${row.measure}/${row.territory}/${row.year}`;
    if (published.has(key) || declared.has(key) || !territories.has(row.territory)) {
      throw new Error("Snapshot povertà regioni: cella dichiarata assente e insieme pubblicata.");
    }
    declared.add(key);
  }

  const cells = parsed.territories.length * (LAST_YEAR - FIRST_YEAR + 1);
  for (const measure of MEASURE_KEYS) {
    const stats = totals[measure];
    const undiffused = parsed.undiffused.filter((row) => row.measure === measure).length;
    const missing = parsed.missingRows.filter((row) => row.measure === measure).length;
    if ((perMeasure.get(measure) ?? 0) !== stats.published || undiffused !== stats.undiffused || missing !== stats.missing) {
      throw new Error(`Snapshot povertà regioni: copertura di ${measure} diversa dal lock.`);
    }
    if (stats.published + undiffused + missing !== cells) {
      throw new Error(`Snapshot povertà regioni: la griglia di ${measure} non torna.`);
    }
  }

  // Bolzano non ha alcun valore familiare: se ne comparisse uno, l'esclusione va rivista.
  if (parsed.observations.some((row) => row.territory === "ITD1" && row.measure === "households")) {
    throw new Error("Snapshot povertà regioni: Bolzano ora pubblica un valore familiare.");
  }

  // L'invariante che impedisce di leggere una cella non diffusa come uno zero.
  const byKey = new Map(parsed.observations.map((row) => [`${row.measure}/${row.territory}/${row.year}`, row.valueHundredths]));
  const ratios: number[] = [];
  for (const row of parsed.observations) {
    if (row.measure !== "households") continue;
    const individual = byKey.get(`individuals/${row.territory}/${row.year}`);
    if (individual === undefined) continue;
    if (row.valueHundredths <= 0) {
      throw new Error("Snapshot povertà regioni: incidenza familiare nulla fra i valori pubblicati.");
    }
    ratios.push(Math.floor((individual * 10_000) / row.valueHundredths));
  }
  const bounds = { pairs: ratios.length, min: Math.min(...ratios), max: Math.max(...ratios) };
  if (canonical(bounds) !== canonical(parsed.ratioBounds)) {
    throw new Error("Snapshot povertà regioni: rapporto individui/famiglie diverso dall'invariante vincolata.");
  }

  return { data: parsed, metadata: expectedMetadata };
}
