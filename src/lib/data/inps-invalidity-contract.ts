export type InpsSourceDocument = {
  id: string;
  title: string;
  owner: string;
  url: string;
  documentDate: string;
  dateNote: string;
  locator: string;
  observedAt: string;
  sha256: string;
  rightsNote: string;
};

export type InpsCivilInvaliditySnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  scope: "civil-invalidity-benefits";
  spending: {
    unit: "euro-cents";
    measure: string;
    series: Array<{ year: number; amountCents: number }>;
    latestChangeCents: number;
    latestChangePercent: number;
    sourceId: string;
  };
  managementDetail2024: {
    unit: "million-euros-rounded";
    scope: string;
    civilInvalidityPensions: number;
    attendanceAllowances: number;
    sourceId: string;
    warning: string;
  };
  benefitsStock: {
    asOf: string;
    totalBenefits: number;
    attendanceAllowances: number;
    civilInvalidityPensions: number;
    sourceId: string;
  };
  regionalNewPensions: {
    measure: string;
    unit: "benefits";
    years: number[];
    provisionalYears: number[];
    excludedRegions: string[];
    regions: Array<{ region: string; values: number[] }>;
    nationalTotals: number[];
    sourceId: string;
    warning: string;
  };
  territorialAvailability: {
    publicStructuredLevel: "region";
    province: string;
    municipality: string;
    individuals: string;
  };
  methodology: {
    definitions: string;
    comparability: string;
    interpretation: string;
    perCapita: string;
  };
  sources: InpsSourceDocument[];
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Snapshot INPS non valido: ${message}`);
}

function nonEmptyText(value: unknown, label: string): asserts value is string {
  invariant(typeof value === "string" && value.trim().length > 0, `${label} mancante`);
}

function isoDate(value: unknown, label: string): asserts value is string {
  nonEmptyText(value, label);
  invariant(!Number.isNaN(Date.parse(value)), `${label} non valida`);
}

function nonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  invariant(Number.isSafeInteger(value) && Number(value) >= 0, `${label} non valido`);
}

function uniqueNonEmptyTexts(values: unknown, label: string): asserts values is string[] {
  invariant(Array.isArray(values), `${label} non è un elenco`);
  values.forEach((value, index) => nonEmptyText(value, `${label}[${index}]`));
  invariant(new Set(values).size === values.length, `${label} contiene duplicati`);
}

export function validateInpsCivilInvaliditySnapshot(
  snapshot: InpsCivilInvaliditySnapshot,
): InpsCivilInvaliditySnapshot {
  invariant(snapshot.schemaVersion === 1, "schemaVersion non supportata");
  isoDate(snapshot.generatedAt, "generatedAt");
  invariant(snapshot.scope === "civil-invalidity-benefits", "perimetro inatteso");
  invariant(snapshot.spending.unit === "euro-cents", "unità della spesa inattesa");
  nonEmptyText(snapshot.spending.measure, "misura della spesa");
  nonEmptyText(snapshot.spending.sourceId, "fonte della spesa");
  invariant(snapshot.spending.series.length >= 2, "serie di spesa insufficiente");
  invariant(snapshot.sources.length >= 3, "provenienza incompleta");

  const spendingYears = snapshot.spending.series.map((point) => point.year);
  invariant(new Set(spendingYears).size === spendingYears.length, "anni di spesa duplicati");
  invariant(
    snapshot.spending.series.every(
      (point, index) =>
        Number.isSafeInteger(point.year) &&
        point.year >= 1900 &&
        point.year <= 2100 &&
        Number.isSafeInteger(point.amountCents) &&
        point.amountCents >= 0 &&
        (index === 0 || point.year > snapshot.spending.series[index - 1].year),
    ),
    "serie di spesa non valida o non ordinata",
  );

  const sourceIds = new Set(snapshot.sources.map((source) => source.id));
  invariant(sourceIds.size === snapshot.sources.length, "identificativi fonte duplicati");
  for (const source of snapshot.sources) {
    nonEmptyText(source.id, "identificativo fonte");
    nonEmptyText(source.title, `titolo fonte ${source.id}`);
    nonEmptyText(source.owner, `titolare fonte ${source.id}`);
    nonEmptyText(source.dateNote, `nota data fonte ${source.id}`);
    nonEmptyText(source.rightsNote, `nota diritti fonte ${source.id}`);
    invariant(/^https:\/\/www\.inps\.it\//.test(source.url), `URL non ufficiale: ${source.url}`);
    invariant(/^[a-f0-9]{64}$/.test(source.sha256), `hash non valido: ${source.id}`);
    isoDate(source.documentDate, `data documento ${source.id}`);
    isoDate(source.observedAt, `data osservazione ${source.id}`);
    nonEmptyText(source.locator, `riferimento pagina ${source.id}`);
  }

  invariant(
    snapshot.managementDetail2024.unit === "million-euros-rounded",
    "unità del dettaglio 2024 inattesa",
  );
  nonEmptyText(snapshot.managementDetail2024.scope, "perimetro del dettaglio 2024");
  nonEmptyText(snapshot.managementDetail2024.sourceId, "fonte del dettaglio 2024");
  nonEmptyText(snapshot.managementDetail2024.warning, "avvertenza del dettaglio 2024");
  nonNegativeSafeInteger(
    snapshot.managementDetail2024.civilInvalidityPensions,
    "pensioni nel dettaglio 2024",
  );
  nonNegativeSafeInteger(
    snapshot.managementDetail2024.attendanceAllowances,
    "accompagnamenti nel dettaglio 2024",
  );

  isoDate(snapshot.benefitsStock.asOf, "data dello stock prestazioni");
  nonEmptyText(snapshot.benefitsStock.sourceId, "fonte dello stock prestazioni");
  nonNegativeSafeInteger(snapshot.benefitsStock.totalBenefits, "stock totale prestazioni");
  nonNegativeSafeInteger(
    snapshot.benefitsStock.attendanceAllowances,
    "stock indennità di accompagnamento",
  );
  nonNegativeSafeInteger(
    snapshot.benefitsStock.civilInvalidityPensions,
    "stock pensioni di invalidità civile",
  );

  const years = snapshot.regionalNewPensions.years;
  invariant(new Set(years).size === years.length, "anni regionali duplicati");
  invariant(
    years.every(
      (year, index) =>
        Number.isSafeInteger(year) &&
        year >= 1900 &&
        year <= 2100 &&
        (index === 0 || year > years[index - 1]),
    ),
    "anni regionali non ordinati",
  );
  invariant(
    snapshot.regionalNewPensions.unit === "benefits",
    "unità della serie regionale inattesa",
  );
  nonEmptyText(snapshot.regionalNewPensions.measure, "misura della serie regionale");
  nonEmptyText(snapshot.regionalNewPensions.sourceId, "fonte della serie regionale");
  nonEmptyText(snapshot.regionalNewPensions.warning, "avvertenza della serie regionale");
  uniqueNonEmptyTexts(snapshot.regionalNewPensions.excludedRegions, "regioni escluse");
  invariant(
    snapshot.regionalNewPensions.provisionalYears.every(
      (year) => Number.isSafeInteger(year) && years.includes(year),
    ),
    "anni provvisori non presenti nella serie regionale",
  );
  invariant(
    years.length === snapshot.regionalNewPensions.nationalTotals.length,
    "totali nazionali non allineati agli anni",
  );
  invariant(
    snapshot.regionalNewPensions.nationalTotals.every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ),
    "totali nazionali regionali non validi",
  );
  for (const region of snapshot.regionalNewPensions.regions) {
    nonEmptyText(region.region, "nome regione");
    invariant(
      region.values.length === years.length,
      `serie regionale incompleta: ${region.region}`,
    );
    invariant(
      region.values.every((value) => Number.isInteger(value) && value >= 0),
      `valore regionale non valido: ${region.region}`,
    );
  }
  const regionNames = snapshot.regionalNewPensions.regions.map((region) => region.region);
  invariant(new Set(regionNames).size === regionNames.length, "regioni duplicate");
  invariant(
    regionNames.every(
      (region, index) =>
        index === 0 || regionNames[index - 1].localeCompare(region, "it-IT") <= 0,
    ),
    "regioni non ordinate alfabeticamente",
  );
  years.forEach((year, index) => {
    const regionalTotal = snapshot.regionalNewPensions.regions.reduce(
      (sum, region) => sum + region.values[index],
      0,
    );
    invariant(
      regionalTotal === snapshot.regionalNewPensions.nationalTotals[index],
      `totale ${year} non riconciliato`,
    );
  });

  invariant(
    snapshot.benefitsStock.attendanceAllowances +
      snapshot.benefitsStock.civilInvalidityPensions ===
      snapshot.benefitsStock.totalBenefits,
    "stock prestazioni non riconciliato",
  );
  invariant(
    Number.isSafeInteger(snapshot.spending.latestChangeCents),
    "variazione assoluta della spesa non valida",
  );
  invariant(
    Number.isFinite(snapshot.spending.latestChangePercent),
    "variazione percentuale della spesa non valida",
  );
  invariant(
    snapshot.spending.latestChangeCents ===
      snapshot.spending.series.at(-1)!.amountCents -
        snapshot.spending.series.at(-2)!.amountCents,
    "variazione di spesa non riconciliata",
  );
  const previousSpending = snapshot.spending.series.at(-2)!.amountCents;
  const computedChangePercent =
    previousSpending === 0
      ? 0
      : (snapshot.spending.latestChangeCents / previousSpending) * 100;
  invariant(
    Math.abs(computedChangePercent - snapshot.spending.latestChangePercent) < 0.05,
    "percentuale di variazione non riconciliata",
  );
  for (const sourceId of [
    snapshot.spending.sourceId,
    snapshot.managementDetail2024.sourceId,
    snapshot.benefitsStock.sourceId,
    snapshot.regionalNewPensions.sourceId,
  ]) {
    invariant(sourceIds.has(sourceId), `fonte mancante: ${sourceId}`);
  }

  invariant(
    snapshot.territorialAvailability.publicStructuredLevel === "region",
    "livello territoriale pubblico inatteso",
  );
  nonEmptyText(snapshot.territorialAvailability.province, "disponibilità provinciale");
  nonEmptyText(snapshot.territorialAvailability.municipality, "disponibilità comunale");
  nonEmptyText(snapshot.territorialAvailability.individuals, "disponibilità individuale");
  nonEmptyText(snapshot.methodology.definitions, "definizioni metodologiche");
  nonEmptyText(snapshot.methodology.comparability, "nota di comparabilità");
  nonEmptyText(snapshot.methodology.interpretation, "nota interpretativa");
  nonEmptyText(snapshot.methodology.perCapita, "nota pro capite");

  return snapshot;
}
