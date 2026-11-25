/**
 * Proposte emendative al disegno di legge di bilancio 2027 (C. 3174-bis) in
 * V Commissione Camera: contratto di confine e vista aggregata per la pagina.
 *
 * Numero, articolo, firmatari, esito e proposte identiche sono fatti della
 * fonte. Spesa dichiarata e Comuni nominati sono letti dal testo con regole
 * dichiarate e restano accompagnati dalla frase di origine: non misurano
 * l'effetto finanziario, che la Camera non pubblica per queste proposte, e
 * per questo non vengono mai sommati tra proposte diverse.
 *
 * Validazione scritta a mano: gli schemi Zod equivalenti costano abbastanza
 * tipi da portare il typecheck oltre l'heap della CI.
 */
import { REGION_NAME_BY_ISTAT_CODE } from "@/lib/italy-regions";

export const BUDGET_YEARS = [2027, 2028, 2029] as const;

export const INADMISSIBILITY_REASONS = {
  carenza_compensazione: "Carenza di compensazione",
  inidoneita_compensazione: "Inidoneità di compensazione",
  carenza_e_inidoneita_compensazione: "Carenza e inidoneità di compensazione",
  estraneita_materia: "Estraneità di materia",
} as const;

export type InadmissibilityReason = keyof typeof INADMISSIBILITY_REASONS;
export type CoverageFund = "fispe" | "esigenze_indifferibili";

/**
 * Collocazione dei gruppi rispetto al Governo in carica nella XIX legislatura.
 * È una classificazione nostra, dichiarata in pagina: il gruppo Misto riunisce
 * componenti di entrambi gli schieramenti e resta a parte.
 */
export const COALITION_BY_GROUP: Record<string, Coalition> = {
  gr4133: "maggioranza", // Fratelli d'Italia
  gr4132: "maggioranza", // Lega
  gr4134: "maggioranza", // Forza Italia
  gr4152: "maggioranza", // Noi Moderati
  gr4136: "opposizione", // Partito Democratico
  gr4131: "opposizione", // MoVimento 5 Stelle
  gr4154: "opposizione", // Alleanza Verdi e Sinistra
  gr4135: "opposizione", // Azione
  gr4211: "opposizione", // Italia Viva
  gr4111: "misto",
  governo: "governo",
};
export type Coalition = "maggioranza" | "opposizione" | "misto" | "governo";
export const COALITION_LABEL: Record<Coalition, string> = {
  maggioranza: "Maggioranza",
  opposizione: "Opposizione",
  misto: "Gruppo Misto",
  governo: "Governo",
};
export type AmendmentOutcome = "ammissibile" | "inammissibile" | "parzialmente_inammissibile";
export type SpendingKind = "spesa autorizzata" | "contributo" | "dotazione di un fondo";

export type AmendmentSpending = {
  kind: SpendingKind;
  /** Null quando il testo non lega ogni importo a un anno: non lo distribuiamo noi. */
  trienniumCents: number | null;
  byYearCents: Record<(typeof BUDGET_YEARS)[number], number> | null;
  permanent: boolean;
  evidence: string;
};

export type NamedMunicipality = { istatCode: string; name: string; regionCode: string; population: number | null };

export type Amendment = {
  id: string;
  section: string;
  position: number;
  additionalArticle: boolean;
  title: string | null;
  proponent: string;
  signers: number;
  /** Gruppi di tutti i firmatari presenti nell'anagrafica acquisita. */
  signerGroups: string[];
  /** Null: nessuna clausola di copertura nel testo. Vuoto: copertura che non cita i due fondi. */
  coverage: CoverageFund[] | null;
  outcome: AmendmentOutcome;
  reason: InadmissibilityReason | null;
  partialNote: string | null;
  identicalTo: string[];
  spending: AmendmentSpending | null;
  territory: { municipalities: NamedMunicipality[]; ambiguousNames: string[]; evidence: string } | null;
};

export type EmendamentiSnapshot = {
  act: { number: string; title: string; committee: string; stage: string; sittingDate: string; actUrl: string };
  source: {
    owner: string;
    landingUrl: string;
    listUrl: string;
    amendmentUrlTemplate: string;
    license: string;
    acquiredAt: string;
    pages: number;
  };
  deputiesSource: { owner: string; landingUrl: string; license: string; acquiredAt: string };
  municipalitiesSource: { owner: string; landingUrl: string; referenceDate: string };
  totals: {
    amendments: number;
    inadmissible: number;
    partiallyInadmissible: number;
    byReason: Record<InadmissibilityReason, number>;
    withIdentical: number;
    sections: number;
    singleSigner: number;
  };
  groups: { id: string; label: string; members: number | null }[];
  proponents: { key: string; name: string; groupId: string | null; constituency: string | null; regionCode: string | null }[];
  amendments: Amendment[];
};

type Fields = Record<string, unknown>;

class ContractError extends Error {}

function fail(message: string): never {
  throw new ContractError(message);
}

function record(value: unknown, path: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${path}: oggetto atteso`);
  return value as Fields;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path}: elenco atteso`);
  return value as unknown[];
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${path}: testo atteso`);
  return value as string;
}

function optionalText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

function httpsUrl(value: unknown, path: string): string {
  const url = text(value, path);
  if (!URL.canParse(url.replace("{id}", "1.1").replace("{published}", "20261123")) || !url.startsWith("https://")) fail(`${path}: URL https atteso`);
  return url;
}

function isoDate(value: unknown, path: string): string {
  const date = text(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) fail(`${path}: data ISO attesa`);
  return date;
}

function count(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`${path}: intero non negativo atteso`);
  return value as number;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(`${path}: booleano atteso`);
  return value as boolean;
}

function regionCode(value: unknown, path: string): string {
  const code = text(value, path);
  if (!(code in REGION_NAME_BY_ISTAT_CODE)) fail(`${path}: regione sconosciuta`);
  return code;
}

function amendmentId(value: unknown, path: string): string {
  const id = text(value, path);
  if (!/^(?:Tab\.[0-9A-Z]+|\d+)\.\d+$/u.test(id)) fail(`${path}: numero di proposta non valido`);
  return id;
}

function spending(value: unknown, path: string): AmendmentSpending | null {
  if (value === null) return null;
  const raw = record(value, path);
  const kind = text(raw.kind, `${path}.kind`);
  if (kind !== "spesa autorizzata" && kind !== "contributo" && kind !== "dotazione di un fondo") fail(`${path}.kind: formula sconosciuta`);
  const evidence = text(raw.evidence, `${path}.evidence`);
  const permanent = bool(raw.permanent, `${path}.permanent`);
  if (raw.trienniumCents === null) {
    if (raw.byYearCents !== null) fail(`${path}: importi per anno senza totale`);
    return { kind: kind as SpendingKind, trienniumCents: null, byYearCents: null, permanent, evidence };
  }
  const years = record(raw.byYearCents, `${path}.byYearCents`);
  const byYearCents = { 2027: 0, 2028: 0, 2029: 0 };
  for (const year of BUDGET_YEARS) byYearCents[year] = count(years[String(year)], `${path}.byYearCents.${year}`);
  const trienniumCents = count(raw.trienniumCents, `${path}.trienniumCents`);
  if (trienniumCents !== byYearCents[2027] + byYearCents[2028] + byYearCents[2029]) fail(`${path}: totale diverso dalla somma degli anni`);
  return { kind: kind as SpendingKind, trienniumCents, byYearCents, permanent, evidence };
}

function territory(value: unknown, path: string): Amendment["territory"] {
  if (value === null) return null;
  const raw = record(value, path);
  const municipalities = list(raw.municipalities, `${path}.municipalities`).map((item, index) => {
    const row = record(item, `${path}.municipalities[${index}]`);
    const istatCode = text(row.istatCode, `${path}.istatCode`);
    if (!/^\d{6}$/u.test(istatCode)) fail(`${path}: codice ISTAT non valido`);
    return {
      istatCode,
      name: text(row.name, `${path}.name`),
      regionCode: regionCode(row.regionCode, `${path}.regionCode`),
      population: row.population === null ? null : count(row.population, `${path}.population`),
    };
  });
  const ambiguousNames = list(raw.ambiguousNames, `${path}.ambiguousNames`).map((name, index) => text(name, `${path}.ambiguousNames[${index}]`));
  if (municipalities.length === 0 && ambiguousNames.length === 0) fail(`${path}: territorio senza Comuni`);
  return { municipalities, ambiguousNames, evidence: text(raw.evidence, `${path}.evidence`) };
}

/** Rifiuta payload che la pagina non può leggere in sicurezza; restituisce solo i campi elencati. */
export function assertEmendamentiSnapshot(value: unknown): EmendamentiSnapshot {
  try {
    const root = record(value, "snapshot");
    if (root.schemaVersion !== 1) fail("schemaVersion 1 atteso");
    if (root.datasetId !== "camera-emendamenti-bilancio-2027") fail("datasetId inatteso");
    const act = record(root.act, "act");
    const source = record(root.source, "source");
    const deputiesSource = record(root.deputiesSource, "deputiesSource");
    const municipalitiesSource = record(root.municipalitiesSource, "municipalitiesSource");
    const groups = list(root.groups, "groups").map((item, index) => {
      const row = record(item, `groups[${index}]`);
      return {
        id: text(row.id, `groups[${index}].id`),
        label: text(row.label, `groups[${index}].label`),
        members: row.members === null ? null : count(row.members, `groups[${index}].members`),
      };
    });
    const groupIds = new Set(groups.map((group) => group.id));
    const proponents = list(root.proponents, "proponents").map((item, index) => {
      const path = `proponents[${index}]`;
      const row = record(item, path);
      const groupId = optionalText(row.groupId, `${path}.groupId`);
      if (groupId !== null && !groupIds.has(groupId)) fail(`${path}: gruppo sconosciuto`);
      return {
        key: text(row.key, `${path}.key`),
        name: text(row.name, `${path}.name`),
        groupId,
        constituency: optionalText(row.constituency, `${path}.constituency`),
        regionCode: row.regionCode === null ? null : regionCode(row.regionCode, `${path}.regionCode`),
      };
    });
    const proponentKeys = new Set(proponents.map((proponent) => proponent.key));
    if (proponentKeys.size !== proponents.length) fail("proponenti duplicati");
    const amendments = list(root.amendments, "amendments").map((item, index): Amendment => {
      const path = `amendments[${index}]`;
      const row = record(item, path);
      const outcome = text(row.outcome, `${path}.outcome`);
      if (outcome !== "ammissibile" && outcome !== "inammissibile" && outcome !== "parzialmente_inammissibile") fail(`${path}: esito sconosciuto`);
      const reason = optionalText(row.reason, `${path}.reason`);
      if (reason !== null && !(reason in INADMISSIBILITY_REASONS)) fail(`${path}: motivo sconosciuto`);
      const partialNote = optionalText(row.partialNote, `${path}.partialNote`);
      // The three states are distinct: a reason only with full inadmissibility, a note only with partial.
      if ((outcome === "inammissibile") !== (reason !== null)) fail(`${path}: esito e motivo incoerenti`);
      if ((outcome === "parzialmente_inammissibile") !== (partialNote !== null)) fail(`${path}: esito e annotazione incoerenti`);
      const proponent = text(row.proponent, `${path}.proponent`);
      if (!proponentKeys.has(proponent)) fail(`${path}: proponente sconosciuto`);
      const signers = count(row.signers, `${path}.signers`);
      if (signers < 1) fail(`${path}: almeno un firmatario atteso`);
      const signerGroups = list(row.signerGroups, `${path}.signerGroups`).map((id) => text(id, `${path}.signerGroups`));
      if (signerGroups.some((id) => !groupIds.has(id)) || signerGroups.length > signers) fail(`${path}: gruppi dei firmatari incoerenti`);
      const coverage =
        row.coverage === null
          ? null
          : list(row.coverage, `${path}.coverage`).map((fund) => {
              if (fund !== "fispe" && fund !== "esigenze_indifferibili") fail(`${path}: fondo di copertura sconosciuto`);
              return fund as CoverageFund;
            });
      const position = count(row.position, `${path}.position`);
      if (position !== index + 1) fail(`${path}: posizione non consecutiva`);
      return {
        id: amendmentId(row.id, `${path}.id`),
        section: text(row.section, `${path}.section`),
        position,
        additionalArticle: bool(row.additionalArticle, `${path}.additionalArticle`),
        title: optionalText(row.title, `${path}.title`),
        proponent,
        signers,
        signerGroups,
        coverage,
        outcome,
        reason: reason as InadmissibilityReason | null,
        partialNote,
        identicalTo: list(row.identicalTo, `${path}.identicalTo`).map((id) => amendmentId(id, `${path}.identicalTo`)),
        spending: spending(row.spending, `${path}.spending`),
        territory: territory(row.territory, `${path}.territory`),
      };
    });
    if (amendments.length === 0) fail("nessuna proposta");
    const amendmentIds = new Set(amendments.map((amendment) => amendment.id));
    if (amendmentIds.size !== amendments.length) fail("numeri di proposta duplicati");
    for (const amendment of amendments) {
      if (amendment.identicalTo.some((id) => !amendmentIds.has(id) || id === amendment.id)) fail(`proposta ${amendment.id}: identica a una proposta assente`);
    }

    const declared = record(root.totals, "totals");
    const declaredReasons = record(declared.byReason, "totals.byReason");
    const byReason = { carenza_compensazione: 0, inidoneita_compensazione: 0, carenza_e_inidoneita_compensazione: 0, estraneita_materia: 0 };
    for (const amendment of amendments) if (amendment.reason) byReason[amendment.reason] += 1;
    const totals = {
      amendments: amendments.length,
      inadmissible: amendments.filter((amendment) => amendment.outcome === "inammissibile").length,
      partiallyInadmissible: amendments.filter((amendment) => amendment.outcome === "parzialmente_inammissibile").length,
      byReason,
      withIdentical: amendments.filter((amendment) => amendment.identicalTo.length > 0).length,
      sections: new Set(amendments.map((amendment) => amendment.section)).size,
      singleSigner: amendments.filter((amendment) => amendment.signers === 1).length,
    };
    // The totals written by the ETL must be the ones the rows give: a truncated payload does not pass.
    for (const key of ["amendments", "inadmissible", "partiallyInadmissible", "withIdentical", "sections", "singleSigner"] as const) {
      if (declared[key] !== totals[key]) fail(`totals.${key}: ${String(declared[key])} dichiarato, ${totals[key]} nelle righe`);
    }
    for (const reason of Object.keys(byReason) as InadmissibilityReason[]) {
      if (declaredReasons[reason] !== byReason[reason]) fail(`totals.byReason.${reason} non riconciliato`);
    }
    const pages = record(source.pages, "source.pages");
    if (pages.count !== amendments.length) fail("source.pages.count diverso dalle proposte");
    return {
      act: {
        number: text(act.number, "act.number"),
        title: text(act.title, "act.title"),
        committee: text(act.committee, "act.committee"),
        stage: text(act.stage, "act.stage"),
        sittingDate: isoDate(act.sittingDate, "act.sittingDate"),
        actUrl: httpsUrl(act.actUrl, "act.actUrl"),
      },
      source: {
        owner: text(source.owner, "source.owner"),
        landingUrl: httpsUrl(source.landingUrl, "source.landingUrl"),
        listUrl: httpsUrl(source.listUrl, "source.listUrl"),
        amendmentUrlTemplate: httpsUrl(source.amendmentUrlTemplate, "source.amendmentUrlTemplate"),
        license: text(source.license, "source.license"),
        acquiredAt: isoDate(source.acquiredAt, "source.acquiredAt"),
        pages: amendments.length,
      },
      deputiesSource: {
        owner: text(deputiesSource.owner, "deputiesSource.owner"),
        landingUrl: httpsUrl(deputiesSource.landingUrl, "deputiesSource.landingUrl"),
        license: text(deputiesSource.license, "deputiesSource.license"),
        acquiredAt: isoDate(deputiesSource.acquiredAt, "deputiesSource.acquiredAt"),
      },
      municipalitiesSource: {
        owner: text(municipalitiesSource.owner, "municipalitiesSource.owner"),
        landingUrl: httpsUrl(municipalitiesSource.landingUrl, "municipalitiesSource.landingUrl"),
        referenceDate: isoDate(municipalitiesSource.referenceDate, "municipalitiesSource.referenceDate"),
      },
      totals,
      groups,
      proponents,
      amendments,
    };
  } catch (error) {
    if (error instanceof ContractError) throw new Error(`Snapshot emendamenti non valido: ${error.message}`);
    throw error;
  }
}

export function amendmentUrl(snapshot: Pick<EmendamentiSnapshot, "source" | "act">, id: string): string {
  return snapshot.source.amendmentUrlTemplate
    .replace("{id}", encodeURIComponent(id))
    .replace("{published}", snapshot.act.sittingDate.replaceAll("-", ""));
}

/** "NOI MODERATI (NOI CON L'ITALIA, ...)-MAIE-CENTRO POPOLARE" resta leggibile in tabella. */
export function shortGroupLabel(label: string): string {
  const cut = label.indexOf(" (");
  return cut > 0 ? label.slice(0, cut) : label;
}

/** Proposte divise per esito: le quattro parti sommano sempre a `amendments`. */
export type OutcomeSplit = {
  amendments: number;
  admissible: number;
  partial: number;
  /** Inammissibili per carenza o inidoneità di compensazione (copertura). */
  coverage: number;
  /** Inammissibili per estraneità di materia. */
  matter: number;
  inadmissible: number;
};

export type GroupRow = OutcomeSplit & {
  id: string;
  label: string;
  members: number | null;
  perMember: number | null;
  singleSigner: number;
};

function emptySplit(): OutcomeSplit {
  return { amendments: 0, admissible: 0, partial: 0, coverage: 0, matter: 0, inadmissible: 0 };
}

function addOutcome(split: OutcomeSplit, amendment: Amendment): void {
  split.amendments += 1;
  if (amendment.outcome === "ammissibile") split.admissible += 1;
  else if (amendment.outcome === "parzialmente_inammissibile") split.partial += 1;
  else {
    split.inadmissible += 1;
    if (amendment.reason === "estraneita_materia") split.matter += 1;
    else split.coverage += 1;
  }
}

export type MunicipalityRow = {
  id: string;
  url: string;
  section: string;
  title: string | null;
  municipality: NamedMunicipality;
  regionName: string;
  proponentName: string;
  groupLabel: string | null;
  constituency: string | null;
  /** Null quando la circoscrizione del primo firmatario non è nota o è estera. */
  sameRegion: boolean | null;
  signers: number;
  outcome: AmendmentOutcome;
  reason: InadmissibilityReason | null;
  spending: AmendmentSpending | null;
  evidence: string;
};

export type CoalitionRow = OutcomeSplit & { key: Coalition; label: string; members: number | null; perMember: number | null };

export type EmendamentiView = {
  totals: EmendamentiSnapshot["totals"] & { admissible: number; withoutGroup: number };
  groups: GroupRow[];
  coalitions: CoalitionRow[];
  signatures: {
    bands: { label: string; amendments: number }[];
    /** Proposte firmate da deputati di almeno due gruppi diversi. */
    multiGroup: number;
    /** Proposte firmate insieme da gruppi di maggioranza e di opposizione. */
    acrossCoalitions: number;
    widest: { id: string; url: string; title: string | null; groups: string[]; signers: number; outcome: AmendmentOutcome }[];
  };
  identical: {
    clusters: number;
    amendments: number;
    /** Testi identici depositati da primi firmatari di gruppi diversi. */
    crossGroup: number;
    acrossCoalitions: number;
    largest: { id: string; url: string; title: string | null; copies: number; groups: string[]; ids: string[] }[];
  };
  coverage: { key: string; label: string; amendments: number }[];
  sections: (OutcomeSplit & { section: string })[];
  proponents: { name: string; groupLabel: string | null; amendments: number; inadmissible: number; singleSigner: number }[];
  municipalities: {
    rows: MunicipalityRow[];
    amendmentsNamingAny: number;
    distinctMunicipalities: number;
    withAmbiguousOnly: number;
    sameRegion: { yes: number; no: number; unknown: number };
    regions: { code: string; name: string; amendments: number; municipalities: number }[];
    repeated: { municipality: NamedMunicipality; regionName: string; amendments: number }[];
  };
  spending: {
    declared: number;
    withTriennium: number;
    withoutYears: number;
    permanent: number;
    classes: { label: string; amendments: number }[];
    largest: { id: string; url: string; title: string | null; proponentName: string; groupLabel: string | null; outcome: AmendmentOutcome; spending: AmendmentSpending }[];
  };
};

const SPENDING_CLASSES = [
  { label: "Meno di 1 milione", below: 1_000_000_00 },
  { label: "Da 1 a 10 milioni", below: 10_000_000_00 },
  { label: "Da 10 a 100 milioni", below: 100_000_000_00 },
  { label: "Da 100 milioni a 1 miliardo", below: 1_000_000_000_00 },
  { label: "1 miliardo o più", below: Number.POSITIVE_INFINITY },
] as const;

export function buildEmendamentiView(snapshot: EmendamentiSnapshot): EmendamentiView {
  const proponentByKey = new Map(snapshot.proponents.map((proponent) => [proponent.key, proponent]));
  const groupById = new Map(snapshot.groups.map((group) => [group.id, group]));
  const groupLabel = (groupId: string | null) => (groupId === null ? null : shortGroupLabel(groupById.get(groupId)!.label));

  const groupRows = new Map<string, GroupRow>(
    snapshot.groups.map((group) => [group.id, { ...emptySplit(), id: group.id, label: shortGroupLabel(group.label), members: group.members, perMember: null, singleSigner: 0 }]),
  );
  const sectionRows = new Map<string, OutcomeSplit & { section: string }>();
  const proponentRows = new Map<string, EmendamentiView["proponents"][number]>();
  let withoutGroup = 0;

  for (const amendment of snapshot.amendments) {
    const proponent = proponentByKey.get(amendment.proponent)!;
    const inadmissible = amendment.outcome === "inammissibile" ? 1 : 0;
    const single = amendment.signers === 1 ? 1 : 0;
    const group = proponent.groupId === null ? undefined : groupRows.get(proponent.groupId);
    if (group) {
      addOutcome(group, amendment);
      group.singleSigner += single;
    } else {
      withoutGroup += 1;
    }
    const section = sectionRows.get(amendment.section) ?? { ...emptySplit(), section: amendment.section };
    addOutcome(section, amendment);
    sectionRows.set(amendment.section, section);
    const row = proponentRows.get(proponent.key) ?? { name: proponent.name, groupLabel: groupLabel(proponent.groupId), amendments: 0, inadmissible: 0, singleSigner: 0 };
    row.amendments += 1;
    row.inadmissible += inadmissible;
    row.singleSigner += single;
    proponentRows.set(proponent.key, row);
  }
  for (const group of groupRows.values()) {
    group.perMember = group.members ? group.amendments / group.members : null;
  }

  // "Un solo Comune": exactly one official name and no homonym left unresolved.
  const municipalityRows: MunicipalityRow[] = [];
  const named = new Map<string, { municipality: NamedMunicipality; amendments: number }>();
  let amendmentsNamingAny = 0;
  let withAmbiguousOnly = 0;
  for (const amendment of snapshot.amendments) {
    if (!amendment.territory) continue;
    if (amendment.territory.municipalities.length === 0) {
      withAmbiguousOnly += 1;
      continue;
    }
    amendmentsNamingAny += 1;
    for (const municipality of amendment.territory.municipalities) {
      const entry = named.get(municipality.istatCode) ?? { municipality, amendments: 0 };
      entry.amendments += 1;
      named.set(municipality.istatCode, entry);
    }
    if (amendment.territory.municipalities.length !== 1 || amendment.territory.ambiguousNames.length > 0) continue;
    const municipality = amendment.territory.municipalities[0]!;
    const proponent = proponentByKey.get(amendment.proponent)!;
    municipalityRows.push({
      id: amendment.id,
      url: amendmentUrl(snapshot, amendment.id),
      section: amendment.section,
      title: amendment.title,
      municipality,
      regionName: REGION_NAME_BY_ISTAT_CODE[municipality.regionCode as keyof typeof REGION_NAME_BY_ISTAT_CODE],
      proponentName: proponent.name,
      groupLabel: groupLabel(proponent.groupId),
      constituency: proponent.constituency,
      sameRegion: proponent.regionCode === null ? null : proponent.regionCode === municipality.regionCode,
      signers: amendment.signers,
      outcome: amendment.outcome,
      reason: amendment.reason,
      spending: amendment.spending,
      evidence: amendment.territory.evidence,
    });
  }
  const regionRows = new Map<string, { code: string; name: string; amendments: number; codes: Set<string> }>();
  const sameRegion = { yes: 0, no: 0, unknown: 0 };
  for (const row of municipalityRows) {
    const region = regionRows.get(row.municipality.regionCode) ?? { code: row.municipality.regionCode, name: row.regionName, amendments: 0, codes: new Set<string>() };
    region.amendments += 1;
    region.codes.add(row.municipality.istatCode);
    regionRows.set(region.code, region);
    sameRegion[row.sameRegion === null ? "unknown" : row.sameRegion ? "yes" : "no"] += 1;
  }

  const withSpending = snapshot.amendments.filter((amendment) => amendment.spending !== null);
  const withTriennium = withSpending.filter((amendment) => amendment.spending!.trienniumCents !== null);
  const classes = SPENDING_CLASSES.map((item) => ({ label: item.label as string, amendments: 0 }));
  for (const amendment of withTriennium) {
    classes[SPENDING_CLASSES.findIndex((item) => amendment.spending!.trienniumCents! < item.below)]!.amendments += 1;
  }

  const byCount = <Row extends { amendments: number }>(a: Row, b: Row) => b.amendments - a.amendments;

  // Maggioranza e opposizione, sempre dal gruppo del primo firmatario.
  const coalitionRows = new Map<Coalition, CoalitionRow>();
  for (const group of groupRows.values()) {
    const key = COALITION_BY_GROUP[group.id];
    if (!key) continue;
    const row = coalitionRows.get(key) ?? { ...emptySplit(), key, label: COALITION_LABEL[key], members: key === "governo" ? null : 0, perMember: null };
    for (const field of ["amendments", "admissible", "partial", "coverage", "matter", "inadmissible"] as const) row[field] += group[field];
    if (row.members !== null && group.members !== null) row.members += group.members;
    coalitionRows.set(key, row);
  }
  for (const row of coalitionRows.values()) row.perMember = row.members ? row.amendments / row.members : null;

  // Firme: quante per proposta e quante proposte uniscono gruppi diversi.
  const bands = [
    { label: "Una firma", max: 1, amendments: 0 },
    { label: "Due firme", max: 2, amendments: 0 },
    { label: "Da 3 a 5 firme", max: 5, amendments: 0 },
    { label: "Da 6 a 10 firme", max: 10, amendments: 0 },
    { label: "11 firme o più", max: Number.POSITIVE_INFINITY, amendments: 0 },
  ];
  const spansCoalitions = (groupIds: Iterable<string | null>) => {
    const sides = new Set([...groupIds].map((id) => (id === null ? undefined : COALITION_BY_GROUP[id])));
    return sides.has("maggioranza") && sides.has("opposizione");
  };
  const shared = snapshot.amendments.filter((amendment) => amendment.signerGroups.length > 1);
  for (const amendment of snapshot.amendments) bands.find((band) => amendment.signers <= band.max)!.amendments += 1;

  // Testi identici: componenti connesse delle annotazioni «ident.» dell'elenco.
  const root = new Map<string, string>();
  const find = (id: string): string => {
    let current = id;
    while (root.get(current) !== undefined && root.get(current) !== current) current = root.get(current)!;
    return current;
  };
  for (const amendment of snapshot.amendments) {
    if (amendment.identicalTo.length === 0) continue;
    if (!root.has(amendment.id)) root.set(amendment.id, amendment.id);
    for (const other of amendment.identicalTo) {
      if (!root.has(other)) root.set(other, other);
      root.set(find(other), find(amendment.id));
    }
  }
  const clusters = new Map<string, Amendment[]>();
  for (const amendment of snapshot.amendments) {
    if (!root.has(amendment.id)) continue;
    const key = find(amendment.id);
    clusters.set(key, [...(clusters.get(key) ?? []), amendment]);
  }
  const clusterRows = [...clusters.values()].map((members) => {
    const groupIds = new Set(members.map((member) => proponentByKey.get(member.proponent)!.groupId));
    return {
      id: members[0]!.id,
      url: amendmentUrl(snapshot, members[0]!.id),
      title: members.find((member) => member.title !== null)?.title ?? null,
      copies: members.length,
      groups: [...groupIds].map((id) => groupLabel(id) ?? "gruppo non presente nell'anagrafica").sort((a, b) => a.localeCompare(b, "it")),
      ids: members.map((member) => member.id),
      crossGroup: groupIds.size > 1,
      acrossCoalitions: spansCoalitions(groupIds),
      position: members[0]!.position,
    };
  });

  const coverageCounts = { fispe: 0, esigenze_indifferibili: 0, both: 0, other: 0, none: 0 };
  for (const amendment of snapshot.amendments) {
    if (amendment.coverage === null) coverageCounts.none += 1;
    else if (amendment.coverage.length === 2) coverageCounts.both += 1;
    else if (amendment.coverage.length === 0) coverageCounts.other += 1;
    else coverageCounts[amendment.coverage[0]!] += 1;
  }

  return {
    coalitions: [...coalitionRows.values()].sort(byCount),
    signatures: {
      bands: bands.map(({ label, amendments }) => ({ label, amendments })),
      multiGroup: shared.length,
      acrossCoalitions: shared.filter((amendment) => spansCoalitions(amendment.signerGroups)).length,
      widest: [...shared]
        .sort((a, b) => b.signerGroups.length - a.signerGroups.length || b.signers - a.signers || a.position - b.position)
        .slice(0, 8)
        .map((amendment) => ({
          id: amendment.id,
          url: amendmentUrl(snapshot, amendment.id),
          title: amendment.title,
          groups: amendment.signerGroups.map((id) => groupLabel(id)!).sort((a, b) => a.localeCompare(b, "it")),
          signers: amendment.signers,
          outcome: amendment.outcome,
        })),
    },
    identical: {
      clusters: clusterRows.length,
      amendments: clusterRows.reduce((sum, cluster) => sum + cluster.copies, 0),
      crossGroup: clusterRows.filter((cluster) => cluster.crossGroup).length,
      acrossCoalitions: clusterRows.filter((cluster) => cluster.acrossCoalitions).length,
      largest: [...clusterRows]
        .sort((a, b) => b.copies - a.copies || b.groups.length - a.groups.length || a.position - b.position)
        .slice(0, 8)
        .map(({ id, url, title, copies, groups, ids }) => ({ id, url, title, copies, groups, ids })),
    },
    coverage: [
      { key: "fispe", label: "Fondo per interventi strutturali di politica economica (FISPE)", amendments: coverageCounts.fispe },
      { key: "esigenze_indifferibili", label: "Fondo per le esigenze indifferibili", amendments: coverageCounts.esigenze_indifferibili },
      { key: "both", label: "Entrambi i fondi", amendments: coverageCounts.both },
      { key: "other", label: "Altra copertura indicata", amendments: coverageCounts.other },
      { key: "none", label: "Nessuna clausola di copertura nel testo", amendments: coverageCounts.none },
    ],
    totals: {
      ...snapshot.totals,
      admissible: snapshot.totals.amendments - snapshot.totals.inadmissible - snapshot.totals.partiallyInadmissible,
      withoutGroup,
    },
    groups: [...groupRows.values()].filter((group) => group.amendments > 0).sort(byCount),
    sections: [...sectionRows.values()].sort(byCount).slice(0, 10),
    proponents: [...proponentRows.values()].sort((a, b) => byCount(a, b) || a.name.localeCompare(b.name, "it")).slice(0, 10),
    municipalities: {
      rows: municipalityRows,
      amendmentsNamingAny,
      distinctMunicipalities: new Set(municipalityRows.map((row) => row.municipality.istatCode)).size,
      withAmbiguousOnly,
      sameRegion,
      regions: [...regionRows.values()]
        .map((region) => ({ code: region.code, name: region.name, amendments: region.amendments, municipalities: region.codes.size }))
        .sort((a, b) => byCount(a, b) || a.name.localeCompare(b.name, "it")),
      repeated: [...named.values()]
        .filter((entry) => entry.amendments > 1)
        .sort((a, b) => byCount(a, b) || a.municipality.name.localeCompare(b.municipality.name, "it"))
        .slice(0, 10)
        .map((entry) => ({ ...entry, regionName: REGION_NAME_BY_ISTAT_CODE[entry.municipality.regionCode as keyof typeof REGION_NAME_BY_ISTAT_CODE] })),
    },
    spending: {
      declared: withSpending.length,
      withTriennium: withTriennium.length,
      withoutYears: withSpending.length - withTriennium.length,
      permanent: withSpending.filter((amendment) => amendment.spending!.permanent).length,
      classes,
      largest: [...withTriennium]
        .sort((a, b) => b.spending!.trienniumCents! - a.spending!.trienniumCents! || a.position - b.position)
        .slice(0, 10)
        .map((amendment) => {
          const proponent = proponentByKey.get(amendment.proponent)!;
          return {
            id: amendment.id,
            url: amendmentUrl(snapshot, amendment.id),
            title: amendment.title,
            proponentName: proponent.name,
            groupLabel: groupLabel(proponent.groupId),
            outcome: amendment.outcome,
            spending: amendment.spending!,
          };
        }),
    },
  };
}

/** Riga compatta per l'elenco consultabile: solo ciò che la tabella mostra o cerca. */
export type ExplorerRow = {
  id: string;
  url: string;
  section: string;
  title: string | null;
  proponentName: string;
  groupId: string | null;
  groupLabel: string | null;
  signers: number;
  outcome: AmendmentOutcome;
  reason: InadmissibilityReason | null;
  partialNote: string | null;
  spending: Pick<AmendmentSpending, "trienniumCents" | "permanent"> | null;
  municipalities: string[];
  search: string;
};

export const EXPLORER_PAGE_SIZE = 25;
export const EXPLORER_QUERY_MAX = 80;
export const EXPLORER_OUTCOMES = {
  ammissibile: "Ammesse all'esame",
  inammissibile: "Inammissibili (tutti i motivi)",
  copertura: "Inammissibili per copertura",
  materia: "Inammissibili per estraneità di materia",
  parzialmente_inammissibile: "In parte inammissibili",
} as const;
export type ExplorerOutcome = keyof typeof EXPLORER_OUTCOMES;

export function foldSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
}

export function buildExplorerRows(snapshot: EmendamentiSnapshot): ExplorerRow[] {
  const proponentByKey = new Map(snapshot.proponents.map((proponent) => [proponent.key, proponent]));
  const groupById = new Map(snapshot.groups.map((group) => [group.id, group]));
  return snapshot.amendments.map((amendment) => {
    const proponent = proponentByKey.get(amendment.proponent)!;
    const municipalities = amendment.territory?.municipalities.map((municipality) => municipality.name) ?? [];
    return {
      id: amendment.id,
      url: amendmentUrl(snapshot, amendment.id),
      section: amendment.section,
      title: amendment.title,
      proponentName: proponent.name,
      groupId: proponent.groupId,
      groupLabel: proponent.groupId === null ? null : shortGroupLabel(groupById.get(proponent.groupId)!.label),
      signers: amendment.signers,
      outcome: amendment.outcome,
      reason: amendment.reason,
      partialNote: amendment.partialNote,
      spending: amendment.spending && { trienniumCents: amendment.spending.trienniumCents, permanent: amendment.spending.permanent },
      municipalities,
      search: foldSearch([amendment.id, amendment.section, proponent.name, amendment.title ?? "", ...municipalities].join(" ")),
    };
  });
}

export type ExplorerQuery = { q: string; group: string; outcome: ExplorerOutcome | ""; municipality: boolean; page: number };

/** Legge i parametri dell'URL: valori sconosciuti o fuori misura tornano al default, mai un errore. */
export function parseExplorerQuery(
  params: Record<string, string | string[] | undefined>,
  groupIds: ReadonlySet<string>,
): ExplorerQuery {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const outcome = one("esito");
  const page = Number(one("pagina"));
  return {
    q: one("q").slice(0, EXPLORER_QUERY_MAX).trim(),
    group: groupIds.has(one("gruppo")) ? one("gruppo") : "",
    outcome: outcome in EXPLORER_OUTCOMES ? (outcome as ExplorerOutcome) : "",
    municipality: one("comune") === "1",
    page: Number.isSafeInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function isExplorerQueryActive(query: ExplorerQuery): boolean {
  return query.q !== "" || query.group !== "" || query.outcome !== "" || query.municipality || query.page > 1;
}

export function queryAmendments(rows: readonly ExplorerRow[], query: ExplorerQuery) {
  const tokens = foldSearch(query.q).split(" ").filter(Boolean).slice(0, 6);
  const matches = rows.filter((row) => {
    if (query.group !== "" && row.groupId !== query.group) return false;
    if (query.municipality && row.municipalities.length === 0) return false;
    if (query.outcome === "copertura" && !(row.outcome === "inammissibile" && row.reason !== "estraneita_materia")) return false;
    if (query.outcome === "materia" && row.reason !== "estraneita_materia") return false;
    if (query.outcome !== "" && query.outcome !== "copertura" && query.outcome !== "materia" && row.outcome !== query.outcome) return false;
    return tokens.every((token) => row.search.includes(token));
  });
  const pages = Math.max(1, Math.ceil(matches.length / EXPLORER_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  return { total: matches.length, page, pages, rows: matches.slice((page - 1) * EXPLORER_PAGE_SIZE, page * EXPLORER_PAGE_SIZE) };
}
