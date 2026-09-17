export type CptRegionalFiscalRow = {
  year: number;
  regionCode: string;
  region: string;
  revenueCents: number;
  expenditureCents: number;
  balanceCents: number;
  population: number | null;
  revenuePerCapitaCents: number | null;
  expenditurePerCapitaCents: number | null;
  balancePerCapitaCents: number | null;
};

export type CptRegionalFiscalSnapshot = {
  schemaVersion: 1;
  referenceYears: number[];
  defaultYear: number;
  unit: "euro_cents";
  rows: CptRegionalFiscalRow[];
  definitions: {
    scope: string;
    accountingBasis: string;
    balanceFormula: "entrate meno spese";
    positiveBalanceMeaning: string;
    population: string;
  };
  methodology: {
    warning: string;
    comparability: string;
    notFiscalResidual: string;
  };
  provenance: {
    owner: string;
    catalogUrl: string;
    observedAt: string;
    rightsNote: string;
    inputs: Array<{
      kind: "revenue" | "expenditure" | "population";
      resourceUrl: string;
      rightsNote: string;
      bytes: number;
      sha256: string;
      referenceDate?: string;
      locator?: string;
      normalizedValuesSha256?: string;
    }>;
  };
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Snapshot CPT non valido: ${message}`);
}

function text(value: unknown, label: string): asserts value is string {
  invariant(typeof value === "string" && value.trim().length > 0, `${label} mancante`);
}

function roundHalfAwayFromZero(numerator: number, denominator: number): number {
  const sign = numerator < 0 ? -1 : 1;
  const absolute = Math.abs(numerator);
  const quotient = Math.trunc(absolute / denominator);
  const remainder = absolute % denominator;
  return sign * (quotient + (remainder * 2 >= denominator ? 1 : 0));
}

export function validateCptRegionalFiscalSnapshot(
  snapshot: CptRegionalFiscalSnapshot,
): CptRegionalFiscalSnapshot {
  invariant(snapshot.schemaVersion === 1, "schemaVersion non supportata");
  invariant(snapshot.unit === "euro_cents", "unità inattesa");
  invariant(snapshot.referenceYears.length > 0, "anni mancanti");
  invariant(
    snapshot.referenceYears.every(
      (year, index) => Number.isInteger(year) && (index === 0 || year > snapshot.referenceYears[index - 1]),
    ),
    "anni non ordinati o duplicati",
  );
  invariant(snapshot.referenceYears.includes(snapshot.defaultYear), "anno predefinito assente");
  invariant(snapshot.rows.length === snapshot.referenceYears.length * 21, "copertura territoriale incompleta");

  const keys = new Set<string>();
  const codesByYear = new Map<number, Set<string>>();
  for (const row of snapshot.rows) {
    const key = `${row.year}:${row.regionCode}`;
    invariant(!keys.has(key), `riga duplicata ${key}`);
    keys.add(key);
    const yearCodes = codesByYear.get(row.year) ?? new Set<string>();
    yearCodes.add(row.regionCode);
    codesByYear.set(row.year, yearCodes);
    invariant(snapshot.referenceYears.includes(row.year), `anno inatteso ${row.year}`);
    invariant(/^\d{2}$/.test(row.regionCode), `codice regione non valido ${row.regionCode}`);
    text(row.region, `nome regione ${key}`);
    invariant(Number.isSafeInteger(row.revenueCents) && row.revenueCents >= 0, `entrate non valide ${key}`);
    invariant(Number.isSafeInteger(row.expenditureCents) && row.expenditureCents >= 0, `spese non valide ${key}`);
    invariant(Number.isSafeInteger(row.balanceCents), `saldo non valido ${key}`);
    invariant(row.balanceCents === row.revenueCents - row.expenditureCents, `saldo non riconciliato ${key}`);
    if (row.population === null) {
      invariant(
        row.revenuePerCapitaCents === null &&
          row.expenditurePerCapitaCents === null &&
          row.balancePerCapitaCents === null,
        `pro capite senza popolazione ${key}`,
      );
    } else {
      invariant(Number.isSafeInteger(row.population) && row.population > 0, `popolazione non valida ${key}`);
      invariant(
        [row.revenuePerCapitaCents, row.expenditurePerCapitaCents, row.balancePerCapitaCents].every(
          (value) => Number.isSafeInteger(value),
        ),
        `pro capite non valido ${key}`,
      );
      const rounded = (amount: number) => roundHalfAwayFromZero(amount, row.population!);
      invariant(row.revenuePerCapitaCents === rounded(row.revenueCents), `entrate pro capite non riconciliate ${key}`);
      invariant(row.expenditurePerCapitaCents === rounded(row.expenditureCents), `spese pro capite non riconciliate ${key}`);
      invariant(row.balancePerCapitaCents === rounded(row.balanceCents), `saldo pro capite non riconciliato ${key}`);
    }
  }
  const expectedCodes = codesByYear.get(snapshot.defaultYear);
  invariant(expectedCodes?.size === 21, "codici territoriali predefiniti incompleti");
  for (const year of snapshot.referenceYears) {
    const codes = codesByYear.get(year);
    invariant(
      codes?.size === 21 && [...expectedCodes].every((code) => codes.has(code)),
      `copertura territoriale divergente nel ${year}`,
    );
  }

  for (const value of Object.values(snapshot.definitions)) text(value, "definizione");
  for (const value of Object.values(snapshot.methodology)) text(value, "metodologia");
  text(snapshot.provenance.owner, "titolare fonte");
  invariant(/^https:\/\/politichecoesione\.governo\.it\//.test(snapshot.provenance.catalogUrl), "catalogo non ufficiale");
  invariant(!Number.isNaN(Date.parse(snapshot.provenance.observedAt)), "observedAt non valida");
  text(snapshot.provenance.rightsNote, "condizioni di riuso");
  invariant(snapshot.provenance.inputs.length === 3, "provenienza incompleta");
  invariant(
    new Set(snapshot.provenance.inputs.map((input) => input.kind)).size === 3,
    "tipi di input duplicati o mancanti",
  );
  for (const input of snapshot.provenance.inputs) {
    const expectedOrigin = input.kind === "population" ? "https://www.istat.it" : "https://politichecoesione.governo.it";
    invariant(new URL(input.resourceUrl).origin === expectedOrigin, `URL risorsa non ufficiale: ${input.kind}`);
    text(input.rightsNote, `condizioni di riuso ${input.kind}`);
    invariant(Number.isSafeInteger(input.bytes) && input.bytes > 0, `dimensione non valida: ${input.kind}`);
    invariant(/^[a-f0-9]{64}$/.test(input.sha256), `hash non valido: ${input.kind}`);
    if (input.kind === "population") {
      invariant(input.referenceDate === "2023-12-31", "data di riferimento popolazione inattesa");
      text(input.locator, "localizzatore popolazione");
      invariant(
        /^[a-f0-9]{64}$/.test(input.normalizedValuesSha256 ?? ""),
        "fingerprint normalizzazione popolazione non valido",
      );
    }
  }
  return snapshot;
}
