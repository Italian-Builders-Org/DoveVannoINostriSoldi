import { z } from "zod";

/**
 * Contratto fail-closed per lo snapshot Eurostat `gov_10a_main`: entrate, uscite e
 * saldo delle Amministrazioni pubbliche italiane (S13), 1995-2025.
 *
 * Proprietà pretese qui, non lasciate alla pagina:
 *
 * - copertura piena: 24 voci per 31 anni, nessuna cella assente;
 * - i totali TR, TE e B9 sono quelli pubblicati da Eurostat. Le identità SEC con le
 *   componenti tornano entro la sola tolleranza di arrotondamento dichiarata:
 *   oltre quella non è più arrotondamento ed è un guasto;
 * - D41PAY è una voce «di cui» di D4PAY e non può superarla;
 * - il segno negativo è ammesso solo dove il SEC lo prevede (B9, NP, P5).
 *
 * L'uguaglianza al centesimo di D41PAY e TE con `public-debt.json` è verificata
 * dall'ETL (`--check`) e dai test, perché lega due artefatti diversi.
 */

const OFFICIAL_PREFIX = "https://ec.europa.eu/eurostat/";
const officialUrl = (message: string) =>
  z.string().refine((url) => url.startsWith(OFFICIAL_PREFIX), message);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const nonNegativeInt = z.number().int().min(0);
const signedInt = z.number().int();

export const EUROSTAT_GOV_MAIN_TOTALS = ["TR", "TE", "B9"] as const;
export const EUROSTAT_GOV_MAIN_REVENUE_COMPONENTS = [
  "P11_P12_P131", "D2REC", "D39REC", "D4REC", "D5REC", "D61REC", "D7REC", "D9REC",
] as const;
export const EUROSTAT_GOV_MAIN_EXPENDITURE_COMPONENTS = [
  "P2", "P5", "NP", "D1PAY", "D29PAY", "D3PAY", "D4PAY", "D5PAY", "D62PAY", "D632PAY", "D7PAY", "D9PAY",
] as const;
export const EUROSTAT_GOV_MAIN_MEMO_ITEMS = { D41PAY: "D4PAY" } as const;
export const EUROSTAT_GOV_MAIN_ITEMS = [
  ...EUROSTAT_GOV_MAIN_TOTALS,
  ...EUROSTAT_GOV_MAIN_REVENUE_COMPONENTS,
  ...EUROSTAT_GOV_MAIN_EXPENDITURE_COMPONENTS,
  ...(Object.keys(EUROSTAT_GOV_MAIN_MEMO_ITEMS) as ["D41PAY"]),
] as const;
export type EurostatGovMainItemCode = (typeof EUROSTAT_GOV_MAIN_ITEMS)[number];

const SIGNED_ITEMS = new Set<string>(["B9", "NP", "P5"]);
const FROM = 1995;
const TO = 2025;
const YEARS = TO - FROM + 1;
const CELLS = EUROSTAT_GOV_MAIN_ITEMS.length * YEARS;
// 0,5 milioni di euro concordati in #485; 13 cifre arrotondate a 0,05 punti per le quote.
const TOLERANCE_CENTS = 50_000_000;
const TOLERANCE_SHARE_HUNDREDTHS = 65;

const itemCode = z.enum(EUROSTAT_GOV_MAIN_ITEMS as unknown as [EurostatGovMainItemCode, ...EurostatGovMainItemCode[]]);
const flagCode = z.enum(["p", "b"]);

const observationSchema = z
  .object({
    year: z.number().int().min(FROM).max(TO),
    naItem: itemCode,
    // Centesimi di euro e centesimi di punto: la fonte pubblica un decimale, quindi
    // la conversione resta esatta e nessun float entra nell'artefatto.
    amountCents: signedInt,
    shareOfGdpHundredths: signedInt,
    flag: flagCode.optional(),
  })
  .strict();

const itemSchema = z
  .object({
    code: itemCode,
    label: z.string().min(1),
    role: z.enum(["total-revenue", "total-expenditure", "balance", "revenue-component", "expenditure-component", "memo-of-D4PAY"]),
  })
  .strict();

const identityGapSchema = z
  .object({ maxGapCents: nonNegativeInt, maxGapShareHundredths: nonNegativeInt, maxGapAt: z.string().min(4).nullable() })
  .strict();

const reconciliationSchema = z
  .object({
    note: z.string().min(1),
    toleranceCents: z.literal(TOLERANCE_CENTS),
    toleranceShareHundredths: z.literal(TOLERANCE_SHARE_HUNDREDTHS),
    revenue: identityGapSchema,
    expenditure: identityGapSchema,
    balance: identityGapSchema,
  })
  .strict();

export const eurostatGovMainDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("eurostat-gov-main"),
    period: z.object({ from: z.literal(FROM), to: z.literal(TO) }).strict(),
    caveats: z.array(z.string().min(1)).min(1),
    units: z.object({ amountCents: z.string().min(1), shareOfGdpHundredths: z.string().min(1) }).strict(),
    flags: z.object({ p: z.string().min(1), b: z.string().min(1) }).strict(),
    items: z.array(itemSchema).length(EUROSTAT_GOV_MAIN_ITEMS.length),
    memoItems: z.object({ D41PAY: z.literal("D4PAY") }).strict(),
    observations: z.array(observationSchema).length(CELLS),
    coverage: z
      .object({ expectedCells: z.literal(CELLS), observedCells: z.literal(CELLS), flagged: nonNegativeInt })
      .strict(),
    reconciliation: reconciliationSchema,
  })
  .strict();

const assetSchema = z
  .object({
    unit: z.enum(["MIO_EUR", "PC_GDP"]),
    unitLabel: z.string().min(1),
    url: officialUrl("URL asset Eurostat non ufficiale"),
    bytes: z.number().int().positive(),
    sha256,
    sourceUpdated: z.string().min(1),
  })
  .strict();

export const eurostatGovMainMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("eurostat-gov-main"),
    period: z.object({ from: z.literal(FROM), to: z.literal(TO) }).strict(),
    observedAt: isoDate,
    source: z
      .object({
        owner: z.string().min(1),
        landingUrl: officialUrl("Landing URL Eurostat non ufficiale"),
        datasetCode: z.literal("gov_10a_main"),
        datasetLabel: z.string().min(1),
        structure: z
          .object({ id: z.literal("GOV_10A_MAIN"), agencyId: z.literal("ESTAT"), version: z.string().min(1) })
          .strict(),
        licenseId: z.literal("CC-BY-4.0"),
        licenseNote: z.string().min(1),
        termsUrl: officialUrl("Terms URL Eurostat non ufficiale"),
        acquisition: z.object({ acquiredAt: isoDate, checkedAt: isoDate, note: z.string().min(1) }).strict(),
        assets: z.object({ "mio-eur": assetSchema, "pc-gdp": assetSchema }).strict(),
      })
      .strict(),
    coverage: z
      .object({ observedAt: isoDate, note: z.string().min(1), publishedItemsNote: z.string().min(1) })
      .strict(),
    reconciliation: reconciliationSchema,
    semantics: z
      .object({
        soldi: z.object({ unit: z.literal("centesimi di euro"), nature: z.string().min(1), note: z.string().min(1) }).strict(),
        periodo: z.object({ referencePeriod: z.literal(`${FROM}-${TO}`), note: z.string().min(1) }).strict(),
        provenance: z
          .object({
            holder: z.string().min(1),
            canonicalUrls: z.array(officialUrl("URL non ufficiale")).min(1),
            // Eurostat pubblica un istante, non una data: resta com'è dichiarato.
            publicationDate: z.string().min(1),
            acquisitionDate: isoDate,
            checkedAt: isoDate,
            license: z.literal("CC-BY-4.0"),
            hashes: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    publicDebtInvariant: z
      .object({
        items: z.tuple([z.literal("D41PAY"), z.literal("TE")]),
        artifact: z.literal("src/data/generated/public-debt.json"),
        rule: z.string().min(1),
      })
      .strict(),
    integrity: z
      .object({
        algorithm: z.literal("sha256"),
        canonicalization: z.string().min(1),
        dataArtifact: z
          .object({
            path: z.literal("src/data/generated/eurostat-gov-main-1995-2025.data.json"),
            bytes: z.number().int().positive(),
            sha256,
          })
          .strict(),
        sourceLockSha256: sha256,
      })
      .strict(),
  })
  .strict();

export type EurostatGovMainData = z.infer<typeof eurostatGovMainDataSchema>;
export type EurostatGovMainMetadata = z.infer<typeof eurostatGovMainMetadataSchema>;
export type EurostatGovMainObservation = z.infer<typeof observationSchema>;
export type EurostatGovMainItem = z.infer<typeof itemSchema>;

type Field = "amountCents" | "shareOfGdpHundredths";

function reconcile(data: EurostatGovMainData): void {
  if (data.items.map((item) => item.code).join(",") !== EUROSTAT_GOV_MAIN_ITEMS.join(",")) {
    throw new Error("Snapshot Eurostat conti PA: voci pubblicate inattese.");
  }
  const byCell = new Map<string, EurostatGovMainObservation>();
  let flagged = 0;
  for (const observation of data.observations) {
    const key = `${observation.year}/${observation.naItem}`;
    if (byCell.has(key)) {
      throw new Error(`Snapshot Eurostat conti PA: osservazione duplicata ${key}.`);
    }
    if (!SIGNED_ITEMS.has(observation.naItem) && (observation.amountCents < 0 || observation.shareOfGdpHundredths < 0)) {
      throw new Error(`Snapshot Eurostat conti PA: valore negativo su ${key}, voce che il SEC non ammette negativa.`);
    }
    byCell.set(key, observation);
    if (observation.flag) flagged += 1;
  }
  if (flagged !== data.coverage.flagged) {
    throw new Error("Snapshot Eurostat conti PA: conteggio dei flag divergente dalla copertura dichiarata.");
  }

  const get = (year: number, code: string): EurostatGovMainObservation => {
    const row = byCell.get(`${year}/${code}`);
    if (!row) throw new Error(`Snapshot Eurostat conti PA: manca ${year}/${code}.`);
    return row;
  };
  const sum = (year: number, codes: readonly string[], field: Field) =>
    codes.reduce((total, code) => total + get(year, code)[field], 0);

  const worst = {
    revenue: { cents: 0, share: 0, at: null as string | null },
    expenditure: { cents: 0, share: 0, at: null as string | null },
    balance: { cents: 0, share: 0, at: null as string | null },
  };
  for (let year = data.period.from; year <= data.period.to; year += 1) {
    const gaps = {
      revenue: (field: Field) => Math.abs(get(year, "TR")[field] - sum(year, EUROSTAT_GOV_MAIN_REVENUE_COMPONENTS, field)),
      expenditure: (field: Field) => Math.abs(get(year, "TE")[field] - sum(year, EUROSTAT_GOV_MAIN_EXPENDITURE_COMPONENTS, field)),
      balance: (field: Field) => Math.abs(get(year, "TR")[field] - get(year, "TE")[field] - get(year, "B9")[field]),
    };
    for (const identity of ["revenue", "expenditure", "balance"] as const) {
      const cents = gaps[identity]("amountCents");
      const share = gaps[identity]("shareOfGdpHundredths");
      if (cents > data.reconciliation.toleranceCents || share > data.reconciliation.toleranceShareHundredths) {
        throw new Error(`Snapshot Eurostat conti PA: ${year}, identità ${identity} oltre l'arrotondamento.`);
      }
      if (cents > worst[identity].cents) {
        worst[identity].cents = cents;
        worst[identity].at = String(year);
      }
      worst[identity].share = Math.max(worst[identity].share, share);
    }
    for (const [memo, parent] of Object.entries(EUROSTAT_GOV_MAIN_MEMO_ITEMS)) {
      if (get(year, memo).amountCents > get(year, parent).amountCents) {
        throw new Error(`Snapshot Eurostat conti PA: ${year}, la voce «di cui» ${memo} supera ${parent}.`);
      }
    }
  }
  for (const identity of ["revenue", "expenditure", "balance"] as const) {
    const declared = data.reconciliation[identity];
    if (
      declared.maxGapCents !== worst[identity].cents
      || declared.maxGapShareHundredths !== worst[identity].share
      || declared.maxGapAt !== worst[identity].at
    ) {
      throw new Error(`Snapshot Eurostat conti PA: riconciliazione ${identity} dichiarata diversa dai dati.`);
    }
  }
}

export function validateEurostatGovMainBundle(
  data: unknown,
  metadata: unknown,
): { data: EurostatGovMainData; metadata: EurostatGovMainMetadata } {
  const parsedData = eurostatGovMainDataSchema.parse(data);
  const parsedMetadata = eurostatGovMainMetadataSchema.parse(metadata);
  reconcile(parsedData);
  if (JSON.stringify(parsedMetadata.reconciliation) !== JSON.stringify(parsedData.reconciliation)) {
    throw new Error("Snapshot Eurostat conti PA: riconciliazione del metadata diversa da quella dei dati.");
  }
  return { data: parsedData, metadata: parsedMetadata };
}
