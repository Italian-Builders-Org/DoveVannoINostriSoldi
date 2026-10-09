export type InpsCasellarioSistemaObservation = {
  year: number;
  asOf: string;
  pensionCount: number;
  pensionerCount: number;
  amountMillionEuros: number;
  meanBenefitEuros: number;
  meanPensionerIncomeEuros: number;
  pensionsPerPensionerTenths: number;
  source: "comunicato-extract" | "osservatorio-prior-year";
};

export type InpsCasellarioSistemaSnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  scope: "casellario-sistema-pensionistico";
  asOf: "2024-12-31";
  stock: {
    measure: string;
    unitBenefits: "benefits";
    unitPensioners: "people";
    amountUnit: "million-euros";
    amountNote: string;
    pensionCount: number;
    pensionerCount: number;
    amountMillionEuros: number;
    meanBenefitEuros: number;
    meanPensionerIncomeEuros: number;
    pensionsPerPensionerTenths: number;
  };
  series: {
    measure: string;
    warning: string;
    observations: InpsCasellarioSistemaObservation[];
  };
  natureShares: {
    unit: "percent-of-benefits";
    items: Array<{ id: string; label: string; sharePercent: number }>;
    note: string;
  };
  gender: {
    unit: "mean-annual-pensioner-income-euros";
    maschiMeanEuros: number;
    femmineMeanEuros: number;
    note: string;
  };
  methodology: {
    perimeter: string;
    progressioneIstat: string;
    amounts: string;
    priorYear: string;
  };
  sources: Array<{
    id: string;
    title: string;
    owner: string;
    url: string;
    landingUrl: string;
    newsUrl: string;
    documentDate: string;
    publicationDate: string;
    acquiredAt: string;
    checkedAt: string;
    sha256: string;
    bytes: number;
    licenseId: string;
    rightsNote: string;
  }>;
  caveats: string[];
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Snapshot Casellario INPS non valido: ${message}`);
}

function nonEmptyText(value: unknown, label: string): asserts value is string {
  invariant(typeof value === "string" && value.trim().length > 0, `${label} mancante`);
}

function nonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  invariant(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, `${label} non intero`);
}

function sha256(value: unknown, label: string): asserts value is string {
  nonEmptyText(value, label);
  invariant(/^[a-f0-9]{64}$/.test(value), `${label} non è uno sha256`);
}

function httpsInpsUrl(value: unknown, label: string): asserts value is string {
  nonEmptyText(value, label);
  invariant(/^https:\/\/(www\.inps\.it|servizi2\.inps\.it)\//.test(value), `${label} non è un URL INPS`);
}

export function millionEurosToCents(millions: number): number {
  const cents = millions * 100_000_000;
  if (!Number.isSafeInteger(cents)) {
    throw new Error("Importo Casellario INPS fuori dal range intero sicuro");
  }
  return cents;
}

export function validateInpsCasellarioSistemaSnapshot(
  input: unknown,
): InpsCasellarioSistemaSnapshot {
  invariant(input !== null && typeof input === "object", "payload assente");
  const snapshot = input as InpsCasellarioSistemaSnapshot;
  invariant(snapshot.schemaVersion === 1, "schemaVersion");
  invariant(snapshot.scope === "casellario-sistema-pensionistico", "scope");
  invariant(snapshot.asOf === "2024-12-31", "asOf");
  nonEmptyText(snapshot.generatedAt, "generatedAt");

  nonNegativeSafeInteger(snapshot.stock.pensionCount, "pensioni");
  nonNegativeSafeInteger(snapshot.stock.pensionerCount, "pensionati");
  nonNegativeSafeInteger(snapshot.stock.amountMillionEuros, "importo");
  millionEurosToCents(snapshot.stock.amountMillionEuros);
  invariant(snapshot.stock.pensionCount === 23_015_011, "pensioni 2024");
  invariant(snapshot.stock.pensionerCount === 16_305_880, "pensionati 2024");
  invariant(snapshot.stock.amountMillionEuros === 364_132, "importo 2024");
  invariant(snapshot.stock.meanBenefitEuros === 15_821, "media pensione");
  invariant(snapshot.stock.meanPensionerIncomeEuros === 22_331, "media pensionato");
  invariant(snapshot.stock.pensionsPerPensionerTenths === 14, "1,4 pensioni pro capite");

  invariant(snapshot.series.observations.length === 2, "serie 2023-2024");
  const [prior, latest] = snapshot.series.observations;
  invariant(prior?.year === 2023 && latest?.year === 2024, "anni serie");
  invariant(prior.pensionCount === 22_919_888, "pensioni 2023");
  invariant(prior.pensionerCount === 16_230_157, "pensionati 2023");
  invariant(prior.amountMillionEuros === 347_032, "importo 2023");
  invariant(latest.pensionCount === snapshot.stock.pensionCount, "stock vs serie");
  invariant(latest.pensionerCount === snapshot.stock.pensionerCount, "stock pensionati vs serie");

  const yoyPensions = Math.round((latest.pensionCount / prior.pensionCount - 1) * 1000) / 10;
  const yoyPeople = Math.round((latest.pensionerCount / prior.pensionerCount - 1) * 1000) / 10;
  const yoyAmount = Math.round((latest.amountMillionEuros / prior.amountMillionEuros - 1) * 1000) / 10;
  invariant(yoyPensions === 0.4, "YoY pensioni");
  invariant(yoyPeople === 0.5, "YoY pensionati");
  invariant(yoyAmount === 4.9, "YoY importo");

  invariant(snapshot.natureShares.items.length === 3, "quote natura");
  invariant(snapshot.gender.maschiMeanEuros === 25_712, "media uomini");
  invariant(snapshot.gender.femmineMeanEuros === 19_140, "media donne");
  invariant(snapshot.sources.length === 1, "una fonte hashed");
  const source = snapshot.sources[0]!;
  sha256(source.sha256, "sha256");
  httpsInpsUrl(source.url, "url");
  httpsInpsUrl(source.landingUrl, "landingUrl");
  httpsInpsUrl(source.newsUrl, "newsUrl");
  invariant(source.bytes === 107_656, "bytes comunicato");
  invariant(
    source.sha256 === "a326db72e16b60fcf0b69e12fae753b485f0fad250a46c256723456522f4754b",
    "hash comunicato",
  );
  nonEmptyText(snapshot.methodology.progressioneIstat, "progressione");
  invariant(snapshot.caveats.length >= 2, "caveat");
  return snapshot;
}
