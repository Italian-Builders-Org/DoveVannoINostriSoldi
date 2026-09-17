export const MOP_DATASET_ID = "bda1676b-62ab-44b7-8f9a-ca93b8534488@rgs";

export const MOP_SCHEMA = {
  localCode: ["ccodice_locale_progetto", "Codice Locale Progetto", "STRING"],
  cup: ["ccodice_cup", "Codice CUP", "STRING"],
  description: ["cdescrizione_cup_integrale", "Descrizione CUP Integrale", "STRING"],
  statusCode: ["ccodice_stato_cup", "Codice Stato CUP", "STRING"],
  status: ["cdescrizione_stato_cup", "Descrizione Stato CUP", "STRING"],
  holderName: ["cdescrizione_titolare", "Descrizione Titolare", "STRING"],
  holderTaxCode: ["ccodice_fiscale_titolare", "Codice Fiscale Titolare", "STRING"],
  entityCode: ["ccodice_ente", "Codice Ente", "STRING"],
  entityName: ["cdescrizione_ente", "Descrizione Ente", "STRING"],
  nature: ["cnatura_intervento", "Natura Intervento", "STRING"],
  interventionType: ["ctipologia_intervento", "Tipologia Intervento", "STRING"],
  sector: ["csettore_interv_inv", "Settore Interv Inv", "STRING"],
  subsector: ["csottosettore_interv_inv", "Sottosettore Interv Inv", "STRING"],
  category: ["ccategoria_interv_inv", "Categoria Interv Inv", "STRING"],
  plannedExecutionStart: ["cinizio_esecuzione_prevista", "Inizio esecuzione prevista", "STRING"],
  plannedExecutionEnd: ["cfine_esecuzione_prevista", "Fine esecuzione prevista", "STRING"],
  actualExecutionStart: ["cinizio_esecuzione_effettiva", "Inizio esecuzione effettiva", "STRING"],
  actualExecutionEnd: ["cfine_esecuzione_effettiva", "Fine esecuzione effettiva", "STRING"],
  plannedOperationStart: ["cinizio_funzionalit__prevista", "Inizio funzionalità prevista", "STRING"],
  actualOperationStart: ["cinizio_funzionalit__effettiva", "Inizio funzionalità effettiva", "STRING"],
  plannedWorksCost: ["ccosto_lavori_previsto", "Costo Lavori Previsto", "NUMERIC"],
  plannedAvailableSums: ["csomme_a_disposizione_previste", "Somme a disposizione Previste", "NUMERIC"],
  plannedInvestmentCharges: ["coneri_investimento_previsti", "Oneri Investimento Previsti", "NUMERIC"],
  actualWorksCost: ["ccosto_lavori_effettivo", "Costo Lavori Effettivo", "NUMERIC"],
  actualAvailableSums: ["csomme_a_disposizione_effettiv", "Somme a disposizione Effettive", "NUMERIC"],
  actualInvestmentCharges: ["coneri_investimento_effettivi", "Oneri Investimento Effettivi", "NUMERIC"],
  stateFunding: ["cfinanziamenti_statali", "Finanziamenti Statali", "NUMERIC"],
  europeanFunding: ["cfinanziamenti_europei", "Finanziamenti Europei", "NUMERIC"],
  territorialFunding: ["cfinanziamenti_enti_territoria", "Finanziamenti Enti Territorial", "NUMERIC"],
  privateFunding: ["cfinanziamenti_privati", "Finanziamenti Privati", "NUMERIC"],
  otherFunding: ["caltre_fonti_di_finanziamento", "Altre fonti di finanziamento", "NUMERIC"],
  fundingToFind: ["cfinanziamenti_da_reperire", "Finanziamenti da reperire", "NUMERIC"],
  economies: ["ctotale_economie", "Totale Economie", "NUMERIC"],
} as const;

export type MopField = keyof typeof MOP_SCHEMA;
export type MopFieldMap = Record<MopField, string>;

export type MopDatasetMetadata = {
  datasetId: typeof MOP_DATASET_ID;
  sourceLastUpdate: string;
  referenceDate: string;
  ready: true;
};

export type MopSchemaContract = {
  fields: MopFieldMap;
  columnCount: number;
  localProjectCardinality: number;
  cupCardinality: number;
};

export type PublicWorkSignal = {
  code: "data-quality" | "schedule-check" | "cost-growth" | "funding-gap";
  level: "information" | "attention";
  label: string;
  explanation: string;
  verificationUse: "screening-only";
  benignExplanations: string[];
};

export type PublicWork = {
  localCode: string;
  cup: string;
  description: string;
  statusCode: string;
  status: string;
  holder: {
    name: string;
    taxCode: string | null;
  };
  reportingEntity: {
    code: string | null;
    name: string | null;
  };
  classification: {
    nature: string | null;
    interventionType: string | null;
    sector: string | null;
    subsector: string | null;
    category: string | null;
  };
  dates: {
    plannedExecutionStart: string | null;
    plannedExecutionEnd: string | null;
    actualExecutionStart: string | null;
    actualExecutionEnd: string | null;
    plannedOperationStart: string | null;
    actualOperationStart: string | null;
  };
  costs: {
    plannedWorksCents: number;
    plannedAvailableSumsCents: number;
    plannedInvestmentChargesCents: number;
    plannedTotalCents: number;
    actualWorksCents: number;
    actualAvailableSumsCents: number;
    actualInvestmentChargesCents: number;
    actualTotalCents: number;
    changeBasisPoints: number | null;
  };
  funding: {
    stateCents: number;
    europeanCents: number;
    territorialCents: number;
    privateCents: number;
    otherCents: number;
    securedTotalCents: number;
    toFindCents: number;
    economiesCents: number;
  };
  dataQualityWarnings: string[];
  signals: PublicWorkSignal[];
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, field: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`OpenBDAP MOP: ${field} deve essere un oggetto`);
  }
  return value as UnknownRecord;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`OpenBDAP MOP: ${field} deve essere una lista`);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`OpenBDAP MOP: ${field} mancante`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > Number.MAX_SAFE_INTEGER) {
    throw new Error(`OpenBDAP MOP: ${field} non è un intero sicuro`);
  }
  return value as number;
}

export function normalizeCup(value: string): string {
  const cup = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{15}$/.test(cup)) throw new Error("CUP non valido: sono richiesti 15 caratteri alfanumerici");
  return cup;
}

export function parseMopDatasetMetadata(payload: unknown): MopDatasetMetadata {
  const root = record(payload, "risposta metadata");
  const data = record(root.d, "d");
  if (data.id !== MOP_DATASET_ID) throw new Error("OpenBDAP MOP: identificativo dataset inatteso");
  if (data.inferredDataType !== "STATISTIC" || data.isReady !== true) {
    throw new Error("OpenBDAP MOP: dataset non pronto o di tipo inatteso");
  }
  const sourceLastUpdate = text(data.lastUpdate, "lastUpdate");
  const match = sourceLastUpdate.match(/^(\d{2})\/(\d{2})\/(20\d{2}) \d{2}:\d{2}:\d{2}$/);
  if (!match) throw new Error("OpenBDAP MOP: data di aggiornamento inattesa");
  return {
    datasetId: MOP_DATASET_ID,
    sourceLastUpdate,
    referenceDate: `${match[3]}-${match[2]}-${match[1]}`,
    ready: true,
  };
}

export function parseMopSchema(payload: unknown): MopSchemaContract {
  const root = record(payload, "risposta schema");
  const data = record(root.d, "d");
  const columns = array(data.results, "d.results").map((value, index) => record(value, `colonna ${index}`));
  const byPhysicalName = new Map(columns.map((column) => [text(column.physicalName, "physicalName"), column]));
  const fields = {} as MopFieldMap;
  const uniqueIds = new Set<string>();

  for (const [field, expected] of Object.entries(MOP_SCHEMA) as [MopField, readonly [string, string, string]][]) {
    const column = byPhysicalName.get(expected[0]);
    if (!column) throw new Error(`OpenBDAP MOP: colonna mancante ${expected[0]}`);
    if (column.logicalName !== expected[1] || column.dbType !== expected[2]) {
      throw new Error(`OpenBDAP MOP: definizione cambiata per ${expected[0]}`);
    }
    const uniqueId = text(column.colUniqueId, `${expected[0]}.colUniqueId`);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(uniqueId) || uniqueIds.has(uniqueId)) {
      throw new Error(`OpenBDAP MOP: alias non valido o duplicato per ${expected[0]}`);
    }
    fields[field] = uniqueId;
    uniqueIds.add(uniqueId);
  }

  const localProject = byPhysicalName.get(MOP_SCHEMA.localCode[0]);
  const cup = byPhysicalName.get(MOP_SCHEMA.cup[0]);
  return {
    fields,
    columnCount: columns.length,
    localProjectCardinality: safeInteger(localProject?.cardinality, "cardinalità codici locali"),
    cupCardinality: safeInteger(cup?.cardinality, "cardinalità CUP"),
  };
}

function sourceValue(row: UnknownRecord, fields: MopFieldMap, field: MopField): unknown {
  return row[fields[field]];
}

function moneyCents(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    throw new Error(`OpenBDAP MOP: importo non valido in ${field}`);
  }
  const [euros, decimals = ""] = value.trim().split(".");
  const cents = Number(euros) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error(`OpenBDAP MOP: importo oltre il limite sicuro in ${field}`);
  return cents;
}

function dateValue(
  value: unknown,
  field: string,
  warnings: string[],
): string | null {
  const raw = optionalText(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const year = match ? Number(match[1]) : 0;
  const date = match ? new Date(`${raw}T00:00:00Z`) : null;
  if (
    !match || year < 1900 || year > 2200 || !date || Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== raw
  ) {
    warnings.push(`${field}: la fonte contiene una data non utilizzabile (${raw})`);
    return null;
  }
  return raw;
}

function deriveSignals(work: Omit<PublicWork, "signals">, observedDate: string): PublicWorkSignal[] {
  const signals: PublicWorkSignal[] = [];
  if (work.dataQualityWarnings.length > 0) {
    signals.push({
      code: "data-quality",
      level: "information",
      label: "Dati da verificare alla fonte",
      explanation: "Alcuni campi della fonte non possono essere usati in un confronto automatico.",
      verificationUse: "screening-only",
      benignExplanations: ["Errore di compilazione", "Dato storico non migrato", "Formato cambiato nel tempo"],
    });
  }
  if (
    work.statusCode !== "C" && work.dates.plannedExecutionEnd &&
    work.dates.plannedExecutionEnd < observedDate && !work.dates.actualExecutionEnd
  ) {
    signals.push({
      code: "schedule-check",
      level: "attention",
      label: "Fine prevista superata",
      explanation: "La data prevista è passata e la fonte non riporta una data effettiva di fine esecuzione.",
      verificationUse: "screening-only",
      benignExplanations: ["Aggiornamento non ancora trasmesso", "Cronoprogramma rivisto", "Opera sospesa o ridefinita"],
    });
  }
  if (work.costs.changeBasisPoints !== null && work.costs.changeBasisPoints >= 1_000) {
    signals.push({
      code: "cost-growth",
      level: "attention",
      label: "Costo effettivo superiore al previsto",
      explanation: "Le componenti di costo effettive superano di almeno il 10% quelle previste nella stessa scheda.",
      verificationUse: "screening-only",
      benignExplanations: ["Perizia di variante", "Adeguamento prezzi", "Ampliamento documentato dell'intervento"],
    });
  }
  if (work.funding.toFindCents > 0) {
    signals.push({
      code: "funding-gap",
      level: "attention",
      label: "Finanziamenti ancora da reperire",
      explanation: "La scheda ufficiale riporta una quota di finanziamento ancora da reperire.",
      verificationUse: "screening-only",
      benignExplanations: ["Copertura programmata in un esercizio successivo", "Dato non ancora aggiornato"],
    });
  }
  return signals;
}

export function normalizeMopRow(
  raw: unknown,
  fields: MopFieldMap,
  observedDate: string,
): PublicWork {
  const row = record(raw, "riga");
  const warnings: string[] = [];
  const holderTaxCode = optionalText(sourceValue(row, fields, "holderTaxCode"));
  if (holderTaxCode && !/^(?:\d{11}|[A-Z0-9]{16})$/.test(holderTaxCode)) {
    warnings.push(`Codice fiscale titolare non riconosciuto (${holderTaxCode})`);
  }

  const plannedWorksCents = moneyCents(sourceValue(row, fields, "plannedWorksCost"), "costo lavori previsto");
  const plannedAvailableSumsCents = moneyCents(sourceValue(row, fields, "plannedAvailableSums"), "somme previste");
  const plannedInvestmentChargesCents = moneyCents(sourceValue(row, fields, "plannedInvestmentCharges"), "oneri previsti");
  const actualWorksCents = moneyCents(sourceValue(row, fields, "actualWorksCost"), "costo lavori effettivo");
  const actualAvailableSumsCents = moneyCents(sourceValue(row, fields, "actualAvailableSums"), "somme effettive");
  const actualInvestmentChargesCents = moneyCents(sourceValue(row, fields, "actualInvestmentCharges"), "oneri effettivi");
  const plannedTotalCents = plannedWorksCents + plannedAvailableSumsCents + plannedInvestmentChargesCents;
  const actualTotalCents = actualWorksCents + actualAvailableSumsCents + actualInvestmentChargesCents;
  const changeBasisPoints = plannedTotalCents > 0 && actualTotalCents > 0
    ? Math.round(((actualTotalCents - plannedTotalCents) / plannedTotalCents) * 10_000)
    : null;

  const stateCents = moneyCents(sourceValue(row, fields, "stateFunding"), "finanziamenti statali");
  const europeanCents = moneyCents(sourceValue(row, fields, "europeanFunding"), "finanziamenti europei");
  const territorialCents = moneyCents(sourceValue(row, fields, "territorialFunding"), "finanziamenti territoriali");
  const privateCents = moneyCents(sourceValue(row, fields, "privateFunding"), "finanziamenti privati");
  const otherCents = moneyCents(sourceValue(row, fields, "otherFunding"), "altre fonti");

  const withoutSignals: Omit<PublicWork, "signals"> = {
    localCode: text(sourceValue(row, fields, "localCode"), "codice locale"),
    cup: normalizeCup(text(sourceValue(row, fields, "cup"), "CUP")),
    description: text(sourceValue(row, fields, "description"), "descrizione"),
    statusCode: text(sourceValue(row, fields, "statusCode"), "codice stato"),
    status: text(sourceValue(row, fields, "status"), "stato"),
    holder: {
      name: text(sourceValue(row, fields, "holderName"), "titolare"),
      taxCode: holderTaxCode,
    },
    reportingEntity: {
      code: optionalText(sourceValue(row, fields, "entityCode")),
      name: optionalText(sourceValue(row, fields, "entityName")),
    },
    classification: {
      nature: optionalText(sourceValue(row, fields, "nature")),
      interventionType: optionalText(sourceValue(row, fields, "interventionType")),
      sector: optionalText(sourceValue(row, fields, "sector")),
      subsector: optionalText(sourceValue(row, fields, "subsector")),
      category: optionalText(sourceValue(row, fields, "category")),
    },
    dates: {
      plannedExecutionStart: dateValue(sourceValue(row, fields, "plannedExecutionStart"), "Inizio esecuzione previsto", warnings),
      plannedExecutionEnd: dateValue(sourceValue(row, fields, "plannedExecutionEnd"), "Fine esecuzione prevista", warnings),
      actualExecutionStart: dateValue(sourceValue(row, fields, "actualExecutionStart"), "Inizio esecuzione effettivo", warnings),
      actualExecutionEnd: dateValue(sourceValue(row, fields, "actualExecutionEnd"), "Fine esecuzione effettiva", warnings),
      plannedOperationStart: dateValue(sourceValue(row, fields, "plannedOperationStart"), "Entrata in funzione prevista", warnings),
      actualOperationStart: dateValue(sourceValue(row, fields, "actualOperationStart"), "Entrata in funzione effettiva", warnings),
    },
    costs: {
      plannedWorksCents,
      plannedAvailableSumsCents,
      plannedInvestmentChargesCents,
      plannedTotalCents,
      actualWorksCents,
      actualAvailableSumsCents,
      actualInvestmentChargesCents,
      actualTotalCents,
      changeBasisPoints,
    },
    funding: {
      stateCents,
      europeanCents,
      territorialCents,
      privateCents,
      otherCents,
      securedTotalCents: stateCents + europeanCents + territorialCents + privateCents + otherCents,
      toFindCents: moneyCents(sourceValue(row, fields, "fundingToFind"), "finanziamenti da reperire"),
      economiesCents: moneyCents(sourceValue(row, fields, "economies"), "economie"),
    },
    dataQualityWarnings: warnings,
  };
  return {
    ...withoutSignals,
    signals: deriveSignals(withoutSignals, observedDate),
  };
}
