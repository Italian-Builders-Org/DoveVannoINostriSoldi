export type PnrrChildcareLocation = {
  regionCode: string | null;
  region: string;
  provinceCode: string | null;
  province: string | null;
  municipalityCode: string | null;
  municipality: string | null;
  address: string | null;
  postalCode: string | null;
  shareBasisPoints: number | null;
};

export type PnrrChildcareTender = {
  cig: string | null;
  frameworkCig: string | null;
  userProcedureCode: string | null;
  internalProcedureCode: string | null;
  procedure: string | null;
  deliveryMode: string | null;
  contractType: string | null;
  subject: string | null;
  publishedAt: string | null;
  absenceReason: string | null;
  amountCents: number | null;
  awardAmountCents: number | null;
  awardedAt: string | null;
};

export type PnrrChildcareAwardee = {
  cig: string | null;
  userProcedureCode: string | null;
  internalProcedureCode: string | null;
  taxId: string | null;
  name: string | null;
  role: string | null;
  legalForm: string | null;
  atecoCode: string | null;
};

export type PnrrChildcareProject = {
  cup: string;
  localProjectCode: string | null;
  title: string;
  summary: string | null;
  classification: {
    nature: string | null;
    type: string | null;
    sector: string | null;
    subsector: string | null;
    category: string | null;
  };
  status: {
    cup: string | null;
    progress: string | null;
    phaseCode: string | null;
    phase: string | null;
    phaseStatus: string | null;
    validationOutcome: string | null;
    validatedAt: string | null;
  };
  funding: {
    pnrrCents: number | null;
    totalCents: number | null;
    netPublicCents: number | null;
    stateCents: number | null;
    municipalityCents: number | null;
    regionCents: number | null;
    privateCents: number | null;
    toBeFoundCents: number | null;
  };
  implementer: { name: string | null; taxCode: string | null };
  timeline: {
    plannedStart: string | null;
    actualStart: string | null;
    plannedEnd: string | null;
    actualEnd: string | null;
  };
  existingProject: string | null;
  locations: PnrrChildcareLocation[];
  tenders: PnrrChildcareTender[];
  awardees: PnrrChildcareAwardee[];
};

export type PnrrChildcareData = {
  schemaVersion: 1;
  dataset: "pnrr_asili";
  submeasure: { code: "M4C1I1.01.00"; label: string };
  referenceDate: string;
  projects: PnrrChildcareProject[];
};

export type PnrrChildcareMeta = {
  schemaVersion: 1;
  dataset: "pnrr_asili";
  generatedAt: string;
  observedAt: string;
  referenceDate: string;
  submeasure: { code: "M4C1I1.01.00"; label: string };
  coverage: {
    projectRows: number;
    uniqueProjects: number;
    locationRows: number;
    tenderRows: number;
    awardeeRows: number;
    projectsWithLocations: number;
    projectsWithTenders: number;
    projectsWithAwardees: number;
    municipalities: number;
    unmatchedAwardeeRows: number;
  };
  totals: {
    pnrrFundingCents: number;
    totalFundingCents: number;
    tenderAmountCents: number;
    awardAmountCents: number;
  };
  source: {
    owner: string;
    landingUrl: string;
    license: string;
    licenseUrl: string;
    attribution: string;
    assets: Record<string, { fileName: string; url: string; bytes: number; sha256: string }>;
  };
  methodology: {
    join: string;
    fundingWarning: string;
    territorialWarning: string;
    validationWarning: string;
  };
  integrity: {
    algorithm: "sha256";
    sourceLockSha256: string;
    dataArtifact: { bytes: number; sha256: string };
  };
};

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field}: oggetto atteso`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], field: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`${field}: chiavi non conformi`);
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field}: testo atteso`);
  return value;
}

function safeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${field}: intero sicuro non negativo atteso`);
  }
  return value as number;
}

function positiveInteger(value: unknown, field: string): number {
  const result = safeInteger(value, field);
  if (result === 0) throw new Error(`${field}: intero positivo atteso`);
  return result;
}

function officialUrl(value: unknown, field: string): string {
  const result = text(value, field);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    throw new Error(`${field}: URL non valido`);
  }
  if (url.protocol !== "https:" || url.hostname !== "www.italiadomani.gov.it") {
    throw new Error(`${field}: URL ufficiale ItaliaDomani atteso`);
  }
  return result;
}

function isoDate(value: unknown, field: string): string {
  const result = text(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error(`${field}: data ISO attesa`);
  const parsed = new Date(`${result}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new Error(`${field}: data ISO non valida`);
  }
  return result;
}

function utcTimestamp(value: unknown, field: string): string {
  const result = text(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(result)) {
    throw new Error(`${field}: timestamp UTC atteso`);
  }
  const parsed = new Date(result);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().replace(".000Z", "Z") !== result) {
    throw new Error(`${field}: timestamp UTC non valido`);
  }
  return result;
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  return text(value, field);
}

function nullableMoney(value: unknown, field: string): number | null {
  if (value === null) return null;
  return safeInteger(value, field);
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field}: elenco atteso`);
  return value;
}

function assertProject(value: unknown, index: number): PnrrChildcareProject {
  const field = `snapshot.projects[${index}]`;
  const record = object(value, field);
  exactKeys(record, [
    "cup", "localProjectCode", "title", "summary", "classification", "status", "funding",
    "implementer", "timeline", "existingProject", "locations", "tenders", "awardees",
  ], field);
  const cup = text(record.cup, `${field}.cup`);
  if (!/^[A-Z0-9]{15}$/.test(cup)) throw new Error(`${field}.cup non valido`);
  const funding = object(record.funding, `${field}.funding`);
  exactKeys(funding, [
    "pnrrCents", "totalCents", "netPublicCents", "stateCents", "municipalityCents", "regionCents",
    "privateCents", "toBeFoundCents",
  ], `${field}.funding`);
  for (const key of ["pnrrCents", "totalCents", "netPublicCents", "stateCents", "municipalityCents", "regionCents", "privateCents", "toBeFoundCents"]) {
    nullableMoney(funding[key], `${field}.funding.${key}`);
  }
  const locations = array(record.locations, `${field}.locations`);
  const tenders = array(record.tenders, `${field}.tenders`);
  const awardees = array(record.awardees, `${field}.awardees`);
  for (const [locationIndex, value] of locations.entries()) {
    const location = object(value, `${field}.locations[${locationIndex}]`);
    const locationField = `${field}.locations[${locationIndex}]`;
    exactKeys(location, [
      "regionCode", "region", "provinceCode", "province", "municipalityCode", "municipality",
      "address", "postalCode", "shareBasisPoints",
    ], locationField);
    nullableText(location.regionCode, `${locationField}.regionCode`);
    text(location.region, `${locationField}.region`);
    nullableText(location.provinceCode, `${locationField}.provinceCode`);
    nullableText(location.province, `${locationField}.province`);
    nullableText(location.municipalityCode, `${locationField}.municipalityCode`);
    nullableText(location.municipality, `${locationField}.municipality`);
    nullableText(location.address, `${locationField}.address`);
    nullableText(location.postalCode, `${locationField}.postalCode`);
    if (location.shareBasisPoints !== null) {
      const share = safeInteger(location.shareBasisPoints, `${locationField}.shareBasisPoints`);
      if (share > 10_000) throw new Error(`${locationField}.shareBasisPoints fuori intervallo`);
    }
  }
  for (const [tenderIndex, value] of tenders.entries()) {
    const tender = object(value, `${field}.tenders[${tenderIndex}]`);
    const tenderField = `${field}.tenders[${tenderIndex}]`;
    exactKeys(tender, [
      "cig", "frameworkCig", "userProcedureCode", "internalProcedureCode", "procedure", "deliveryMode",
      "contractType", "subject", "publishedAt", "absenceReason", "amountCents", "awardAmountCents", "awardedAt",
    ], tenderField);
    const cig = nullableText(tender.cig, `${tenderField}.cig`);
    if (cig !== null && !/^[A-Z0-9]{10}$/.test(cig)) {
      throw new Error(`${tenderField}.cig non valido`);
    }
    const frameworkCig = nullableText(tender.frameworkCig, `${tenderField}.frameworkCig`);
    if (frameworkCig !== null && !/^[A-Z0-9]{10}$/.test(frameworkCig)) {
      throw new Error(`${tenderField}.frameworkCig non valido`);
    }
    nullableText(tender.userProcedureCode, `${tenderField}.userProcedureCode`);
    nullableText(tender.internalProcedureCode, `${tenderField}.internalProcedureCode`);
    nullableText(tender.procedure, `${tenderField}.procedure`);
    nullableText(tender.deliveryMode, `${tenderField}.deliveryMode`);
    nullableText(tender.contractType, `${tenderField}.contractType`);
    nullableText(tender.subject, `${tenderField}.subject`);
    nullableText(tender.absenceReason, `${tenderField}.absenceReason`);
    nullableMoney(tender.amountCents, `${tenderField}.amountCents`);
    nullableMoney(tender.awardAmountCents, `${tenderField}.awardAmountCents`);
    if (tender.publishedAt !== null) isoDate(tender.publishedAt, `${tenderField}.publishedAt`);
    if (tender.awardedAt !== null) isoDate(tender.awardedAt, `${tenderField}.awardedAt`);
  }
  for (const [awardeeIndex, value] of awardees.entries()) {
    const awardee = object(value, `${field}.awardees[${awardeeIndex}]`);
    const awardeeField = `${field}.awardees[${awardeeIndex}]`;
    exactKeys(awardee, [
      "cig", "userProcedureCode", "internalProcedureCode", "taxId", "name", "role", "legalForm", "atecoCode",
    ], awardeeField);
    const cig = nullableText(awardee.cig, `${awardeeField}.cig`);
    if (cig !== null && !/^[A-Z0-9]{10}$/.test(cig)) {
      throw new Error(`${awardeeField}.cig non valido`);
    }
    nullableText(awardee.userProcedureCode, `${awardeeField}.userProcedureCode`);
    nullableText(awardee.internalProcedureCode, `${awardeeField}.internalProcedureCode`);
    nullableText(awardee.taxId, `${awardeeField}.taxId`);
    nullableText(awardee.name, `${awardeeField}.name`);
    nullableText(awardee.role, `${awardeeField}.role`);
    nullableText(awardee.legalForm, `${awardeeField}.legalForm`);
    nullableText(awardee.atecoCode, `${awardeeField}.atecoCode`);
  }
  text(record.title, `${field}.title`);
  const classification = object(record.classification, `${field}.classification`);
  exactKeys(classification, ["nature", "type", "sector", "subsector", "category"], `${field}.classification`);
  for (const key of ["nature", "type", "sector", "subsector", "category"]) {
    nullableText(classification[key], `${field}.classification.${key}`);
  }
  const status = object(record.status, `${field}.status`);
  exactKeys(status, ["cup", "progress", "phaseCode", "phase", "phaseStatus", "validationOutcome", "validatedAt"], `${field}.status`);
  for (const key of ["cup", "progress", "phaseCode", "phase", "phaseStatus", "validationOutcome"]) {
    nullableText(status[key], `${field}.status.${key}`);
  }
  if (status.validatedAt !== null) isoDate(status.validatedAt, `${field}.status.validatedAt`);
  const implementer = object(record.implementer, `${field}.implementer`);
  exactKeys(implementer, ["name", "taxCode"], `${field}.implementer`);
  nullableText(implementer.name, `${field}.implementer.name`);
  nullableText(implementer.taxCode, `${field}.implementer.taxCode`);
  const timeline = object(record.timeline, `${field}.timeline`);
  exactKeys(timeline, ["plannedStart", "actualStart", "plannedEnd", "actualEnd"], `${field}.timeline`);
  for (const key of ["plannedStart", "actualStart", "plannedEnd", "actualEnd"]) {
    if (timeline[key] !== null) isoDate(timeline[key], `${field}.timeline.${key}`);
  }
  nullableText(record.summary, `${field}.summary`);
  nullableText(record.localProjectCode, `${field}.localProjectCode`);
  nullableText(record.existingProject, `${field}.existingProject`);
  return value as PnrrChildcareProject;
}

export function assertPnrrChildcareData(value: unknown): PnrrChildcareData {
  const record = object(value, "snapshot");
  exactKeys(record, ["schemaVersion", "dataset", "submeasure", "referenceDate", "projects"], "snapshot");
  if (record.schemaVersion !== 1 || record.dataset !== "pnrr_asili") {
    throw new Error("snapshot PNRR asili: schema o dataset inatteso");
  }
  const submeasure = object(record.submeasure, "snapshot.submeasure");
  exactKeys(submeasure, ["code", "label"], "snapshot.submeasure");
  if (submeasure.code !== "M4C1I1.01.00") throw new Error("snapshot.submeasure.code inatteso");
  const projects = array(record.projects, "snapshot.projects").map(assertProject);
  const cups = new Set(projects.map((project) => project.cup));
  if (cups.size !== projects.length) throw new Error("snapshot.projects: CUP duplicati");
  isoDate(record.referenceDate, "snapshot.referenceDate");
  return {
    schemaVersion: 1,
    dataset: "pnrr_asili",
    submeasure: { code: "M4C1I1.01.00", label: text(submeasure.label, "snapshot.submeasure.label") },
    referenceDate: text(record.referenceDate, "snapshot.referenceDate"),
    projects,
  };
}

export function assertPnrrChildcareMeta(value: unknown): PnrrChildcareMeta {
  const record = object(value, "meta");
  exactKeys(record, [
    "schemaVersion", "dataset", "generatedAt", "observedAt", "referenceDate", "submeasure", "coverage", "totals",
    "source", "methodology", "integrity",
  ], "meta");
  if (record.schemaVersion !== 1 || record.dataset !== "pnrr_asili") {
    throw new Error("meta PNRR asili: schema o dataset inatteso");
  }
  const submeasure = object(record.submeasure, "meta.submeasure");
  exactKeys(submeasure, ["code", "label"], "meta.submeasure");
  if (submeasure.code !== "M4C1I1.01.00") throw new Error("meta.submeasure.code inatteso");
  text(submeasure.label, "meta.submeasure.label");
  utcTimestamp(record.generatedAt, "meta.generatedAt");
  utcTimestamp(record.observedAt, "meta.observedAt");
  isoDate(record.referenceDate, "meta.referenceDate");
  if (record.generatedAt !== record.observedAt) throw new Error("meta: observedAt e generatedAt diversi");
  const coverage = object(record.coverage, "meta.coverage");
  const totals = object(record.totals, "meta.totals");
  exactKeys(coverage, [
    "projectRows", "uniqueProjects", "locationRows", "tenderRows", "awardeeRows", "projectsWithLocations",
    "projectsWithTenders", "projectsWithAwardees", "municipalities", "unmatchedAwardeeRows",
  ], "meta.coverage");
  exactKeys(totals, ["pnrrFundingCents", "totalFundingCents", "tenderAmountCents", "awardAmountCents"], "meta.totals");
  for (const key of ["projectRows", "uniqueProjects", "locationRows", "tenderRows", "awardeeRows", "projectsWithLocations", "projectsWithTenders", "projectsWithAwardees", "municipalities", "unmatchedAwardeeRows"]) safeInteger(coverage[key], `meta.coverage.${key}`);
  for (const key of ["pnrrFundingCents", "totalFundingCents", "tenderAmountCents", "awardAmountCents"]) safeInteger(totals[key], `meta.totals.${key}`);
  const uniqueProjects = safeInteger(coverage.uniqueProjects, "meta.coverage.uniqueProjects");
  const projectsWithLocations = safeInteger(coverage.projectsWithLocations, "meta.coverage.projectsWithLocations");
  const projectsWithTenders = safeInteger(coverage.projectsWithTenders, "meta.coverage.projectsWithTenders");
  const projectsWithAwardees = safeInteger(coverage.projectsWithAwardees, "meta.coverage.projectsWithAwardees");
  if (projectsWithLocations > uniqueProjects || projectsWithTenders > uniqueProjects || projectsWithAwardees > uniqueProjects) {
    throw new Error("meta.coverage: progetti con record oltre i progetti unici");
  }
  const source = object(record.source, "meta.source");
  exactKeys(source, ["owner", "landingUrl", "license", "licenseUrl", "attribution", "assets"], "meta.source");
  text(source.owner, "meta.source.owner");
  if (source.license !== "CC BY 4.0") throw new Error("meta.source.license inattesa");
  officialUrl(source.landingUrl, "meta.source.landingUrl");
  if (source.licenseUrl !== "https://creativecommons.org/licenses/by/4.0/") throw new Error("meta.source.licenseUrl inatteso");
  text(source.attribution, "meta.source.attribution");
  const assets = object(source.assets, "meta.source.assets");
  const expectedAssets = new Set(["projects", "locations", "tenders", "awardees"]);
  const expectedFileNames: Record<string, string> = {
    projects: "PNRR_Progetti.csv",
    locations: "PNRR_Localizzazione.csv",
    tenders: "PNRR_Gare.csv",
    awardees: "PNRR_Aggiudicatari_Gare.csv",
  };
  if (Object.keys(assets).length !== expectedAssets.size || Object.keys(assets).some((key) => !expectedAssets.has(key))) {
    throw new Error("meta.source.assets: elenco inatteso");
  }
  for (const [key, value] of Object.entries(assets)) {
    const asset = object(value, `meta.source.assets.${key}`);
    exactKeys(asset, ["fileName", "url", "bytes", "sha256"], `meta.source.assets.${key}`);
    if (text(asset.fileName, `meta.source.assets.${key}.fileName`) !== expectedFileNames[key]) {
      throw new Error(`meta.source.assets.${key}.fileName inatteso`);
    }
    officialUrl(asset.url, `meta.source.assets.${key}.url`);
    positiveInteger(asset.bytes, `meta.source.assets.${key}.bytes`);
    if (!/^[a-f0-9]{64}$/.test(text(asset.sha256, `meta.source.assets.${key}.sha256`))) throw new Error(`meta.source.assets.${key}.sha256 non valido`);
  }
  const methodology = object(record.methodology, "meta.methodology");
  exactKeys(methodology, ["join", "fundingWarning", "territorialWarning", "validationWarning"], "meta.methodology");
  for (const key of ["join", "fundingWarning", "territorialWarning", "validationWarning"]) text(methodology[key], `meta.methodology.${key}`);
  const integrity = object(record.integrity, "meta.integrity");
  exactKeys(integrity, ["algorithm", "sourceLockSha256", "dataArtifact"], "meta.integrity");
  if (integrity.algorithm !== "sha256") throw new Error("meta.integrity.algorithm inatteso");
  if (!/^[a-f0-9]{64}$/.test(text(integrity.sourceLockSha256, "meta.integrity.sourceLockSha256"))) throw new Error("meta.integrity.sourceLockSha256 non valido");
  const artifact = object(integrity.dataArtifact, "meta.integrity.dataArtifact");
  exactKeys(artifact, ["bytes", "sha256"], "meta.integrity.dataArtifact");
  positiveInteger(artifact.bytes, "meta.integrity.dataArtifact.bytes");
  if (!/^[a-f0-9]{64}$/.test(text(artifact.sha256, "meta.integrity.dataArtifact.sha256"))) throw new Error("meta.integrity.dataArtifact.sha256 non valido");
  return value as PnrrChildcareMeta;
}

function joinKey(value: PnrrChildcareTender | PnrrChildcareAwardee): string {
  return JSON.stringify([value.cig, value.internalProcedureCode, value.userProcedureCode]);
}

function hasJoinIdentity(value: PnrrChildcareTender | PnrrChildcareAwardee): boolean {
  return value.cig !== null || value.internalProcedureCode !== null || value.userProcedureCode !== null;
}

export function assertPnrrChildcareReconciliation(
  data: PnrrChildcareData,
  meta: PnrrChildcareMeta,
): void {
  if (
    data.referenceDate !== meta.referenceDate ||
    data.submeasure.code !== meta.submeasure.code ||
    data.submeasure.label !== meta.submeasure.label
  ) {
    throw new Error("Snapshot PNRR asili: periodo o submisura non riconciliati");
  }
  const projectsWithLocations = data.projects.filter((project) => project.locations.length > 0).length;
  const projectsWithTenders = data.projects.filter((project) => project.tenders.length > 0).length;
  const projectsWithAwardees = data.projects.filter((project) => project.awardees.length > 0).length;
  const municipalities = new Set(
    data.projects.flatMap((project) => project.locations.map((location) => JSON.stringify([
      location.regionCode,
      location.provinceCode,
      location.municipalityCode,
    ]))),
  ).size;
  const unmatchedAwardeeRows = data.projects.reduce((total, project) => {
    const tenderKeys = new Set(project.tenders.map(joinKey));
    return total + project.awardees.filter((awardee) => !hasJoinIdentity(awardee) || !tenderKeys.has(joinKey(awardee))).length;
  }, 0);
  const coverage = {
    projectRows: data.projects.length,
    uniqueProjects: new Set(data.projects.map((project) => project.cup)).size,
    locationRows: data.projects.reduce((total, project) => total + project.locations.length, 0),
    tenderRows: data.projects.reduce((total, project) => total + project.tenders.length, 0),
    awardeeRows: data.projects.reduce((total, project) => total + project.awardees.length, 0),
    projectsWithLocations,
    projectsWithTenders,
    projectsWithAwardees,
    municipalities,
    unmatchedAwardeeRows,
  };
  for (const [key, value] of Object.entries(coverage)) {
    if (meta.coverage[key as keyof typeof meta.coverage] !== value) {
      throw new Error(`Snapshot PNRR asili: coverage.${key} non riconciliata`);
    }
  }
  const totals = {
    pnrrFundingCents: data.projects.reduce((total, project) => total + (project.funding.pnrrCents ?? 0), 0),
    totalFundingCents: data.projects.reduce((total, project) => total + (project.funding.totalCents ?? 0), 0),
    tenderAmountCents: data.projects.reduce((total, project) => total + project.tenders.reduce((sum, tender) => sum + (tender.amountCents ?? 0), 0), 0),
    awardAmountCents: data.projects.reduce((total, project) => total + project.tenders.reduce((sum, tender) => sum + (tender.awardAmountCents ?? 0), 0), 0),
  };
  for (const [key, value] of Object.entries(totals)) {
    if (meta.totals[key as keyof typeof meta.totals] !== value) {
      throw new Error(`Snapshot PNRR asili: totals.${key} non riconciliato`);
    }
  }
}
