/**
 * Spesa della PA in licenze software (#886): contratto di confine e vista.
 *
 * Tre misure ufficiali che rispondono a domande diverse e non si sommano mai:
 * ordinato sulle convenzioni e sul MePA Consip (per anno), importi aggiudicati
 * delle procedure ANAC con CPV 48 (coorte 2025, comprende anche ordini Consip)
 * e pagamenti di cassa SIOPE delle ASL sul codice 5205. La vista non calcola
 * risparmi: nessuna fonte pubblica il costo di un'alternativa equivalente.
 *
 * Validazione scritta a mano, come per gli emendamenti: niente Zod nel
 * percorso del typecheck.
 */

export type Amount = { cents: number; orders: number | null };
export type VendorRow = { vendor: string; cents: number; orders: number; openSource: boolean };
export type ConventionYear = {
  year: number;
  cents: number;
  orders: number;
  allConventionsCents: number;
  byVendor: VendorRow[];
  byConvention: { convention: string; cents: number; orders: number }[];
  byAdministrationType: { type: string; cents: number; orders: number }[];
};
export type MepaYear = {
  year: number;
  cents: number;
  /** Null: la fonte non pubblica il numero di ordini sulle righe delle licenze. */
  orders: number | null;
  allMepaCents: number;
  byAdministrationType: { type: string; cents: number; orders: number | null }[];
};
export type AnacAward = {
  cig: string;
  codiceIpa: string;
  entity: string | null;
  vendor: string | null;
  cpv: string;
  cents: number;
  awardedAt: string | null;
};
export type LicenzeSnapshot = {
  partialYear: number;
  /** Last-Modified of the Consip file of the partial year: orders are counted up to that update. */
  partialYearUpdatedAt: string;
  sources: {
    consip: { owner: string; landingUrl: string; license: string; licenseUrl: string; acquiredAt: string };
    anac: { owner: string; landingUrl: string; license: string; licenseUrl: string; cohort: string };
    siope: { owner: string; landingUrl: string; license: string };
    ipa: { url: string; acquiredAt: string; license: string };
  };
  consip: {
    families: { id: string; label: string }[];
    conventions: ConventionYear[];
    mepa: MepaYear[];
    mepaCategories: string[];
  };
  anac: {
    cohort: string;
    cpvDivision: string;
    cents: number;
    awards: number;
    attributedCents: number;
    byCpv: { code: string; label: string; cents: number; awards: number }[];
    topVendors: { vendor: string; cents: number; awards: number }[];
    topEntities: { codiceIpa: string; entity: string | null; cents: number; awards: number }[];
    largestAwards: AnacAward[];
  };
  siope: {
    code: string;
    label: string;
    entityType: string;
    byYear: { year: number; cents: number; entities: number; monthsObserved: number }[];
  };
};

function fail(message: string): never {
  throw new Error(`Snapshot licenze software non valido: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} non è un oggetto`);
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} non è un elenco`);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${path} vuoto`);
  return value;
}

function optionalText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

/** Integer cents; reversals can make a single row negative, never a published total. */
function cents(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`${path} non è un importo in centesimi`);
  return value as number;
}

function count(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`${path} non è un conteggio`);
  return value as number;
}

function yearValue(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 2000 || (value as number) > 2100) fail(`${path} anno non valido`);
  return value as number;
}

function httpsUrl(value: unknown, path: string): string {
  const url = text(value, path);
  if (!url.startsWith("https://")) fail(`${path} non è un URL https`);
  return url;
}

function sumEquals(total: number, parts: number[], path: string): void {
  if (parts.reduce((sum, part) => sum + part, 0) !== total) fail(`${path}: il totale non è la somma delle righe`);
}

export function assertLicenzeSnapshot(value: unknown): LicenzeSnapshot {
  const root = record(value, "snapshot");
  if (root.schemaVersion !== 1) fail("schemaVersion 1 atteso");
  if (root.datasetId !== "pa-licenze-software") fail("datasetId inatteso");
  const sources = record(root.sources, "sources");
  const consipSource = record(sources.consip, "sources.consip");
  const anacSource = record(sources.anac, "sources.anac");
  const siopeSource = record(sources.siope, "sources.siope");
  const ipaSource = record(sources.ipa, "sources.ipa");
  const consip = record(root.consip, "consip");
  const conventions = list(consip.conventions, "consip.conventions").map((item, index): ConventionYear => {
    const path = `consip.conventions[${index}]`;
    const row = record(item, path);
    const byVendor = list(row.byVendor, `${path}.byVendor`).map((entry, position) => {
      const vendor = record(entry, `${path}.byVendor[${position}]`);
      if (typeof vendor.openSource !== "boolean") fail(`${path}.byVendor[${position}].openSource`);
      return {
        vendor: text(vendor.vendor, `${path}.byVendor[${position}].vendor`),
        cents: cents(vendor.cents, `${path}.byVendor[${position}].cents`),
        orders: count(vendor.orders, `${path}.byVendor[${position}].orders`),
        openSource: vendor.openSource,
      };
    });
    const total = cents(row.cents, `${path}.cents`);
    sumEquals(total, byVendor.map((entry) => entry.cents), `${path}.byVendor (somma)`);
    const all = cents(row.allConventionsCents, `${path}.allConventionsCents`);
    if (all < total) fail(`${path}: il perimetro software supera il totale delle convenzioni`);
    const grouped = (key: "byConvention" | "byAdministrationType", label: "convention" | "type") =>
      list(row[key], `${path}.${key}`).map((entry, position) => {
        const item2 = record(entry, `${path}.${key}[${position}]`);
        return {
          [label]: text(item2[label], `${path}.${key}[${position}].${label}`),
          cents: cents(item2.cents, `${path}.${key}[${position}].cents`),
          orders: count(item2.orders, `${path}.${key}[${position}].orders`),
        };
      });
    const byConvention = grouped("byConvention", "convention") as ConventionYear["byConvention"];
    const byAdministrationType = grouped("byAdministrationType", "type") as ConventionYear["byAdministrationType"];
    sumEquals(total, byConvention.map((entry) => entry.cents), `${path}.byConvention (somma)`);
    sumEquals(total, byAdministrationType.map((entry) => entry.cents), `${path}.byAdministrationType (somma)`);
    return { year: yearValue(row.year, `${path}.year`), cents: total, orders: count(row.orders, `${path}.orders`), allConventionsCents: all, byVendor, byConvention, byAdministrationType };
  });
  const mepa = list(consip.mepa, "consip.mepa").map((item, index): MepaYear => {
    const path = `consip.mepa[${index}]`;
    const row = record(item, path);
    const byAdministrationType = list(row.byAdministrationType, `${path}.byAdministrationType`).map((entry, position) => {
      const type = record(entry, `${path}.byAdministrationType[${position}]`);
      return {
        type: text(type.type, `${path}.byAdministrationType[${position}].type`),
        cents: cents(type.cents, `${path}.byAdministrationType[${position}].cents`),
        orders: type.orders === null ? null : count(type.orders, `${path}.byAdministrationType[${position}].orders`),
      };
    });
    const total = cents(row.cents, `${path}.cents`);
    sumEquals(total, byAdministrationType.map((entry) => entry.cents), `${path}.byAdministrationType (somma)`);
    return {
      year: yearValue(row.year, `${path}.year`),
      cents: total,
      orders: row.orders === null ? null : count(row.orders, `${path}.orders`),
      allMepaCents: cents(row.allMepaCents, `${path}.allMepaCents`),
      byAdministrationType,
    };
  });
  const anac = record(root.anac, "anac");
  const division = text(anac.cpvDivision, "anac.cpvDivision");
  if (!/^\d{2}$/u.test(division)) fail("anac.cpvDivision");
  const anacCents = cents(anac.cents, "anac.cents");
  const attributedCents = cents(anac.attributedCents, "anac.attributedCents");
  if (attributedCents > anacCents) fail("anac: importo attribuito superiore al totale");
  const cpvCode = (value: unknown, path: string) => {
    const code = text(value, path);
    if (!/^\d{8}-\d$/u.test(code) || !code.startsWith(division)) fail(`${path}: codice fuori dalla divisione CPV ${division}`);
    return code;
  };
  const byCpv = list(anac.byCpv, "anac.byCpv").map((entry, index) => {
    const row = record(entry, `anac.byCpv[${index}]`);
    return {
      code: cpvCode(row.code, `anac.byCpv[${index}].code`),
      label: text(row.label, `anac.byCpv[${index}].label`),
      cents: cents(row.cents, `anac.byCpv[${index}].cents`),
      awards: count(row.awards, `anac.byCpv[${index}].awards`),
    };
  });
  const topVendors = list(anac.topVendors, "anac.topVendors").map((entry, index) => {
    const row = record(entry, `anac.topVendors[${index}]`);
    return {
      vendor: text(row.vendor, `anac.topVendors[${index}].vendor`),
      cents: cents(row.cents, `anac.topVendors[${index}].cents`),
      awards: count(row.awards, `anac.topVendors[${index}].awards`),
    };
  });
  const topEntities = list(anac.topEntities, "anac.topEntities").map((entry, index) => {
    const row = record(entry, `anac.topEntities[${index}]`);
    return {
      codiceIpa: text(row.codiceIpa, `anac.topEntities[${index}].codiceIpa`),
      entity: optionalText(row.entity, `anac.topEntities[${index}].entity`),
      cents: cents(row.cents, `anac.topEntities[${index}].cents`),
      awards: count(row.awards, `anac.topEntities[${index}].awards`),
    };
  });
  const largestAwards = list(anac.largestAwards, "anac.largestAwards").map((entry, index): AnacAward => {
    const path = `anac.largestAwards[${index}]`;
    const row = record(entry, path);
    const cig = text(row.cig, `${path}.cig`);
    // Il CIG finisce in un link di verifica: solo il formato ANAC a 10 caratteri.
    if (!/^[A-Z0-9]{10}$/u.test(cig)) fail(`${path}: CIG non valido`);
    const awardedAt = optionalText(row.awardedAt, `${path}.awardedAt`);
    if (awardedAt !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(awardedAt)) fail(`${path}.awardedAt`);
    return {
      cig,
      codiceIpa: text(row.codiceIpa, `${path}.codiceIpa`),
      entity: optionalText(row.entity, `${path}.entity`),
      vendor: optionalText(row.vendor, `${path}.vendor`),
      cpv: cpvCode(row.cpv, `${path}.cpv`),
      cents: cents(row.cents, `${path}.cents`),
      awardedAt,
    };
  });
  const siope = record(root.siope, "siope");
  const siopeYears = list(siope.byYear, "siope.byYear").map((entry, index) => {
    const row = record(entry, `siope.byYear[${index}]`);
    const months = count(row.monthsObserved, `siope.byYear[${index}].monthsObserved`);
    if (months < 1 || months > 12) fail(`siope.byYear[${index}].monthsObserved`);
    return {
      year: yearValue(row.year, `siope.byYear[${index}].year`),
      cents: cents(row.cents, `siope.byYear[${index}].cents`),
      entities: count(row.entities, `siope.byYear[${index}].entities`),
      monthsObserved: months,
    };
  });
  const partialYear = yearValue(root.partialYear, "partialYear");
  const assets = record(consipSource.assets, "sources.consip.assets");
  const partialAsset = record(assets[`convenzioni-${partialYear}`], `sources.consip.assets.convenzioni-${partialYear}`);
  const partialYearUpdatedAt = text(partialAsset.lastModified, "lastModified dell'anno parziale");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(partialYearUpdatedAt)) fail("lastModified dell'anno parziale");
  return {
    partialYear,
    partialYearUpdatedAt,
    sources: {
      consip: {
        owner: text(consipSource.owner, "sources.consip.owner"),
        landingUrl: httpsUrl(consipSource.landingUrl, "sources.consip.landingUrl"),
        license: text(consipSource.license, "sources.consip.license"),
        licenseUrl: httpsUrl(consipSource.licenseUrl, "sources.consip.licenseUrl"),
        acquiredAt: text(consipSource.acquiredAt, "sources.consip.acquiredAt"),
      },
      anac: {
        owner: text(anacSource.owner, "sources.anac.owner"),
        landingUrl: httpsUrl(anacSource.landingUrl, "sources.anac.landingUrl"),
        license: text(anacSource.license, "sources.anac.license"),
        licenseUrl: httpsUrl(anacSource.licenseUrl, "sources.anac.licenseUrl"),
        cohort: text(anacSource.cohort, "sources.anac.cohort"),
      },
      siope: {
        owner: text(siopeSource.owner, "sources.siope.owner"),
        landingUrl: httpsUrl(siopeSource.landingUrl, "sources.siope.landingUrl"),
        license: text(siopeSource.license, "sources.siope.license"),
      },
      ipa: {
        url: httpsUrl(ipaSource.url, "sources.ipa.url"),
        acquiredAt: text(ipaSource.acquiredAt, "sources.ipa.acquiredAt"),
        license: text(ipaSource.license, "sources.ipa.license"),
      },
    },
    consip: {
      families: list(consip.families, "consip.families").map((entry, index) => {
        const row = record(entry, `consip.families[${index}]`);
        return { id: text(row.id, `consip.families[${index}].id`), label: text(row.label, `consip.families[${index}].label`) };
      }),
      conventions,
      mepa,
      mepaCategories: list(consip.mepaCategories, "consip.mepaCategories").map((entry, index) => text(entry, `consip.mepaCategories[${index}]`)),
    },
    anac: {
      cohort: text(anac.cohort, "anac.cohort"),
      cpvDivision: division,
      cents: anacCents,
      awards: count(anac.awards, "anac.awards"),
      attributedCents,
      byCpv,
      topVendors,
      topEntities,
      largestAwards,
    },
    siope: {
      code: text(siope.code, "siope.code"),
      label: text(siope.label, "siope.label"),
      entityType: text(siope.entityType, "siope.entityType"),
      byYear: siopeYears,
    },
  };
}

export type VendorShare = VendorRow & { share: number };
export type ReferenceYear = ConventionYear & {
  vendors: VendorShare[];
  openSourceCents: number;
  proprietaryCents: number;
  microsoftCents: number;
};
export type LicenzeView = {
  referenceYear: ReferenceYear;
  partialYear: ConventionYear | null;
  conventionYears: ConventionYear[];
  mepaYears: MepaYear[];
  anacAttributedShare: number;
};

/**
 * L'anno di riferimento è l'ultimo anno completo: l'anno in corso è parziale
 * (ordini fino all'ultimo aggiornamento Consip) e non si confronta con gli altri.
 */
export function buildLicenzeView(snapshot: LicenzeSnapshot): LicenzeView {
  const complete = snapshot.consip.conventions.filter((year) => year.year < snapshot.partialYear).sort((a, b) => b.year - a.year);
  const latest = complete[0];
  if (!latest) throw new Error("Snapshot licenze software senza un anno completo.");
  const vendors = latest.byVendor.map((row) => ({ ...row, share: latest.cents > 0 ? row.cents / latest.cents : 0 }));
  const openSourceCents = latest.byVendor.filter((row) => row.openSource).reduce((sum, row) => sum + row.cents, 0);
  return {
    referenceYear: {
      ...latest,
      vendors,
      openSourceCents,
      proprietaryCents: latest.cents - openSourceCents,
      microsoftCents: latest.byVendor.find((row) => row.vendor === "Microsoft")?.cents ?? 0,
    },
    partialYear: snapshot.consip.conventions.find((year) => year.year === snapshot.partialYear) ?? null,
    conventionYears: [...snapshot.consip.conventions].sort((a, b) => a.year - b.year),
    mepaYears: [...snapshot.consip.mepa].sort((a, b) => a.year - b.year),
    anacAttributedShare: snapshot.anac.cents > 0 ? snapshot.anac.attributedCents / snapshot.anac.cents : 0,
  };
}

/** Verifica di un CIG sul portale ANAC: la pagina pubblica di dettaglio. */
export function anacCigUrl(cig: string): string {
  return `https://dati.anticorruzione.it/superset/dashboard/dettaglio_cig/?cig=${encodeURIComponent(cig)}`;
}
