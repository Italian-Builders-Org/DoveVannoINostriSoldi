/**
 * Boundary contracts for the three annual index snapshots used to compare the
 * deputies' institutional rate with wages: HICP (Eurostat), FOI (ISTAT) and the
 * contractual wage index per employee (ISTAT). The ETL already locks bytes and
 * hashes; here we only refuse shapes the UI cannot read safely: wrong dataset,
 * missing or unordered years, non-positive indices, missing provenance.
 *
 * Validation is written by hand on purpose: the equivalent Zod schemas cost
 * about 30k checker types, enough to push the repository typecheck past the
 * CI heap limit. Only the listed fields are returned.
 */

export type AnnualIndexProvenance = {
  holder: string;
  landingUrl: string;
  license: string;
  acquisitionDate: string;
};

type Snapshot<Id extends string, Observation, Provenance> = {
  datasetId: Id;
  referencePeriod: string;
  caveats: string[];
  observations: Observation[];
  semantics: { provenance: Provenance };
};

export type EurostatHicpAnnualSnapshot = Snapshot<
  "eurostat-hicp-annuale",
  { year: number; indexTenths: number },
  AnnualIndexProvenance & { url: string }
>;

export type IstatFoiAnnualSnapshot = Snapshot<
  "istat-foi-annuale",
  { year: number; base2025: { foiHundredths: number } },
  AnnualIndexProvenance
>;

export type IstatContractualWagesSnapshot = Snapshot<
  "istat-retribuzioni-contrattuali",
  { year: number; indexTenths: number },
  AnnualIndexProvenance & { url: string }
>;

type Fields = Record<string, unknown>;

class ContractError extends Error {}

function record(value: unknown, path: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ContractError(`${path}: oggetto atteso`);
  return value as Fields;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new ContractError(`${path}: testo atteso`);
  return value;
}

function httpsUrl(value: unknown, path: string): string {
  const url = text(value, path);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ContractError(`${path}: URL non valido`);
  }
  if (parsed.protocol !== "https:") throw new ContractError(`${path}: URL https atteso`);
  return url;
}

function isoDate(value: unknown, path: string): string {
  const date = text(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new ContractError(`${path}: data ISO attesa`);
  return date;
}

function positiveInt(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new ContractError(`${path}: intero positivo atteso`);
  return value as number;
}

function year(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1990 || (value as number) > 2100) throw new ContractError(`${path}: anno non valido`);
  return value as number;
}

function provenance(value: unknown, withUrl: boolean): AnnualIndexProvenance & { url?: string } {
  const raw = record(value, "semantics.provenance");
  return {
    holder: text(raw.holder, "provenance.holder"),
    landingUrl: httpsUrl(raw.landingUrl, "provenance.landingUrl"),
    license: text(raw.license, "provenance.license"),
    acquisitionDate: isoDate(raw.acquisitionDate, "provenance.acquisitionDate"),
    ...(withUrl ? { url: httpsUrl(raw.url, "provenance.url") } : {}),
  };
}

function parseSnapshot<Observation extends { year: number }>(
  name: string,
  raw: unknown,
  readObservation: (value: Fields, path: string) => Observation,
  withUrl: boolean,
) {
  try {
    const root = record(raw, name);
    if (root.schemaVersion !== 1) throw new ContractError("schemaVersion 1 atteso");
    if (root.datasetId !== name) throw new ContractError(`datasetId ${name} atteso`);
    const referencePeriod = text(root.referencePeriod, "referencePeriod");
    if (!/^\d{4}-\d{4}$/u.test(referencePeriod)) throw new ContractError("referencePeriod AAAA-AAAA atteso");
    if (!Array.isArray(root.caveats) || root.caveats.length === 0) throw new ContractError("caveats assenti");
    const caveats = root.caveats.map((caveat, index) => text(caveat, `caveats[${index}]`));
    if (!Array.isArray(root.observations) || root.observations.length < 2) throw new ContractError("servono almeno due osservazioni");
    const observations = root.observations.map((value, index) => readObservation(record(value, `observations[${index}]`), `observations[${index}]`));
    for (let index = 1; index < observations.length; index += 1) {
      if (observations[index]!.year !== observations[index - 1]!.year + 1) {
        throw new ContractError(`anni non consecutivi: ${observations[index - 1]!.year} poi ${observations[index]!.year}`);
      }
    }
    const semantics = record(root.semantics, "semantics");
    return { datasetId: name, referencePeriod, caveats, observations, semantics: { provenance: provenance(semantics.provenance, withUrl) } };
  } catch (error) {
    if (error instanceof ContractError) throw new Error(`snapshot ${name} non valido: ${error.message}`);
    throw error;
  }
}

const indexObservation = (value: Fields, path: string) => ({
  year: year(value.year, `${path}.year`),
  indexTenths: positiveInt(value.indexTenths, `${path}.indexTenths`),
});

export function parseEurostatHicpAnnualSnapshot(raw: unknown): EurostatHicpAnnualSnapshot {
  return parseSnapshot("eurostat-hicp-annuale", raw, indexObservation, true) as EurostatHicpAnnualSnapshot;
}

export function parseIstatFoiAnnualSnapshot(raw: unknown): IstatFoiAnnualSnapshot {
  return parseSnapshot("istat-foi-annuale", raw, (value, path) => ({
    year: year(value.year, `${path}.year`),
    base2025: { foiHundredths: positiveInt(record(value.base2025, `${path}.base2025`).foiHundredths, `${path}.base2025.foiHundredths`) },
  }), false) as IstatFoiAnnualSnapshot;
}

export function parseIstatContractualWagesSnapshot(raw: unknown): IstatContractualWagesSnapshot {
  return parseSnapshot("istat-retribuzioni-contrattuali", raw, indexObservation, true) as IstatContractualWagesSnapshot;
}
