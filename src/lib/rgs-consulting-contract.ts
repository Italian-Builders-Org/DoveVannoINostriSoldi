import { z } from "zod";

const nonEmptyText = z.string().min(1);
const nonNegativeMoney = z.number().int().nonnegative().safe();

const consultingRowSchema = z.object({
  action: nonEmptyText,
  actionCode: nonEmptyText,
  administration: nonEmptyText,
  ce2Code: z.literal("2"),
  ce2Label: z.literal("Spese per acquisto di servizi"),
  ce3Code: z.union([z.literal("2"), z.literal("4")]),
  ce3Label: z.union([
    z.literal("Consulenze, analisi e studi"),
    z.literal("Prestazioni di lavoro parasubordinato"),
  ]),
  chapter: nonEmptyText,
  chapterNumber: nonEmptyText,
  forecastCode: nonEmptyText,
  id: nonEmptyText,
  managementPlan: nonEmptyText,
  managementPlanNumber: nonEmptyText,
  mission: nonEmptyText,
  missionCode: nonEmptyText,
  paidCashCents: nonNegativeMoney,
  paidCurrentCents: nonNegativeMoney,
  paidResidualCents: nonNegativeMoney,
  program: nonEmptyText,
  programCode: nonEmptyText,
  responsibilityCenter: nonEmptyText,
  responsibilityCenterCode: nonEmptyText,
  year: z.union([z.literal(2024), z.literal(2025)]),
}).strict();

const resourceSchema = z.object({
  catalogUrl: z.url(),
  csvUrl: z.url(),
  datasetId: nonEmptyText,
  landingUrl: z.url(),
  schemaUrl: z.url(),
  sourceBytes: z.number().int().positive().safe(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  year: z.union([z.literal(2024), z.literal(2025)]),
}).strict();

export const rgsConsultingSnapshotSchema = z.object({
  accountingGrain: z.literal(
    "Una riga per esercizio, stato di previsione, capitolo e piano di gestione (PG).",
  ),
  amountUnit: z.literal("euro_cents"),
  categories: z.tuple([
    z.object({ code: z.literal("2"), label: z.literal("Consulenze, analisi e studi") }).strict(),
    z.object({ code: z.literal("4"), label: z.literal("Prestazioni di lavoro parasubordinato") }).strict(),
  ]),
  caveats: z.tuple([
    z.literal("Le righe sono aggregati contabili per piano di gestione, non transazioni né contratti individuali."),
    z.literal("La fonte non identifica consulenti, beneficiari o singole prestazioni."),
    z.literal("Il confronto tra amministrazioni non è una classifica di efficienza o performance."),
    z.literal("Il Rendiconto 2026 non era disponibile alla data di osservazione; il 2026 non è stimato."),
  ]),
  coverage: z.object({
    annual: z.tuple([
      z.object({
        byCe3: z.object({ "2": z.literal(126), "4": z.literal(6) }).strict(),
        paidCashCents: z.literal(5_057_491_173),
        selectedRows: z.literal(132),
        sourceRows: z.literal(13_066),
        year: z.literal(2024),
        zeroPaidRows: z.literal(79),
      }).strict(),
      z.object({
        byCe3: z.object({ "2": z.literal(129), "4": z.literal(7) }).strict(),
        paidCashCents: z.literal(6_299_548_468),
        selectedRows: z.literal(136),
        sourceRows: z.literal(13_160),
        year: z.literal(2025),
        zeroPaidRows: z.literal(74),
      }).strict(),
    ]),
    paidCashCents: z.literal(11_357_039_641),
    selectedRows: z.literal(268),
    sourceRows: z.literal(26_226),
    zeroPaidRows: z.literal(153),
  }).strict(),
  datasetId: z.literal("rgs-consulting-payments-2024-2025"),
  generatedAt: z.literal("2026-08-22T00:00:00Z"),
  methodology: z.object({
    amount: z.literal(
      "Pagato CS in centesimi di euro, verificato riga per riga come Pagato RS + Pagato CP. Zero è un valore osservato e non un dato mancante.",
    ),
    period: z.literal("Rendiconti pubblicati per gli esercizi finanziari 2024 e 2025."),
    scope: z.literal(
      "Bilancio finanziario dello Stato, dettaglio per piano di gestione; non comprende automaticamente altri comparti della pubblica amministrazione.",
    ),
    selection: z.literal(
      "Nel CE2 2 — Spese per acquisto di servizi, sono incluse tutte e sole le righe con la coppia ufficiale codice/etichetta CE3 2 — Consulenze, analisi e studi oppure 4 — Prestazioni di lavoro parasubordinato. Non sono applicati filtri testuali.",
    ),
  }).strict(),
  rows: z.array(consultingRowSchema).length(268),
  schemaVersion: z.literal(1),
  source: z.object({
    catalogUrl: z.literal("https://bdap-opendata.rgs.mef.gov.it/"),
    license: z.literal("Creative Commons Attribution"),
    licenseEvidence: z.object({
      cssSelector: z.literal(".field-name-metadata-license a[href='http://creativecommons.org/licenses/by/3.0']"),
      kind: z.literal("record_landing_page_link"),
      landingUrls: z.tuple([
        z.literal("https://bdap-opendata.rgs.mef.gov.it/content/2024-rendiconto-pubblicato-elaborabile-spese-piano-di-gestione"),
        z.literal("https://bdap-opendata.rgs.mef.gov.it/content/2025-rendiconto-pubblicato-elaborabile-spese-piano-di-gestione"),
      ]),
      observedAt: z.literal("2026-08-22"),
      observedHref: z.literal("http://creativecommons.org/licenses/by/3.0"),
    }).strict(),
    licenseId: z.literal("cc-by"),
    licenseUrl: z.literal("https://creativecommons.org/licenses/by/3.0/"),
    licenseVersion: z.literal("3.0"),
    observedAt: z.literal("2026-08-22"),
    publisher: z.literal("Ragioneria Generale dello Stato — Data Warehouse RGS"),
    resources: z.array(resourceSchema).length(2),
  }).strict(),
  title: z.literal("Pagamenti per consulenze e lavoro parasubordinato nel Rendiconto dello Stato"),
  years: z.tuple([z.literal(2024), z.literal(2025)]),
}).strict();

export type RgsConsultingSnapshot = z.infer<typeof rgsConsultingSnapshotSchema>;
export type RgsConsultingRow = z.infer<typeof consultingRowSchema>;

const EXPECTED_RESOURCES = [
  {
    year: 2024,
    datasetId: "spd_rnd_spe_elb_pig_01_2024",
    sourceBytes: 12_478_207,
    sourceSha256: "ac2abef4cab81a33539dc2400e94f4256a8977363fc24f79c3af2da3019a9216",
    landingUrl: "https://bdap-opendata.rgs.mef.gov.it/content/2024-rendiconto-pubblicato-elaborabile-spese-piano-di-gestione",
    csvUrl: "https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/datastore/dump/d73a538b-5652-463f-8c97-b09b3ec818cd.csv",
  },
  {
    year: 2025,
    datasetId: "spd_rnd_spe_elb_pig_01_2025",
    sourceBytes: 12_056_691,
    sourceSha256: "d7a63020c52aecd6bfbc231ac59d0e66c819636277e2f4b7b0bb2009d6b3ac16",
    landingUrl: "https://bdap-opendata.rgs.mef.gov.it/content/2025-rendiconto-pubblicato-elaborabile-spese-piano-di-gestione",
    csvUrl: "https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/datastore/dump/f65dca45-815a-4e1c-899e-46ab75766047.csv",
  },
] as const;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Snapshot RGS consulenze non valido: ${message}`);
}

export function validateRgsConsultingSnapshot(value: unknown): RgsConsultingSnapshot {
  const snapshot = rgsConsultingSnapshotSchema.parse(value);
  const ids = new Set<string>();

  for (const row of snapshot.rows) {
    invariant(!ids.has(row.id), `id duplicato: ${row.id}`);
    ids.add(row.id);
    invariant(
      row.id === `${row.year}:${row.forecastCode}:${row.chapterNumber}:${row.managementPlanNumber}`,
      `id non riconciliato: ${row.id}`,
    );
    invariant(
      row.paidCashCents === row.paidCurrentCents + row.paidResidualCents,
      `Pagato CS non riconciliato: ${row.id}`,
    );
    invariant(
      (row.ce3Code === "2" && row.ce3Label === "Consulenze, analisi e studi") ||
        (row.ce3Code === "4" && row.ce3Label === "Prestazioni di lavoro parasubordinato"),
      `coppia CE3 non valida: ${row.id}`,
    );
  }

  for (const annual of snapshot.coverage.annual) {
    const rows = snapshot.rows.filter((row) => row.year === annual.year);
    invariant(rows.length === annual.selectedRows, `righe ${annual.year} non riconciliate`);
    invariant(
      rows.reduce((sum, row) => sum + row.paidCashCents, 0) === annual.paidCashCents,
      `Pagato CS ${annual.year} non riconciliato`,
    );
    invariant(
      rows.filter((row) => row.paidCashCents === 0).length === annual.zeroPaidRows,
      `zeri osservati ${annual.year} non riconciliati`,
    );
    invariant(
      rows.filter((row) => row.ce3Code === "2").length === annual.byCe3["2"] &&
        rows.filter((row) => row.ce3Code === "4").length === annual.byCe3["4"],
      `categorie CE3 ${annual.year} non riconciliate`,
    );
  }

  invariant(
    snapshot.rows.reduce((sum, row) => sum + row.paidCashCents, 0) === snapshot.coverage.paidCashCents,
    "totale Pagato CS non riconciliato",
  );
  invariant(
    snapshot.rows.filter((row) => row.paidCashCents === 0).length === snapshot.coverage.zeroPaidRows,
    "zeri osservati non riconciliati",
  );
  invariant(
    snapshot.source.resources.every((resource, index) => {
      const expected = EXPECTED_RESOURCES[index];
      return expected !== undefined &&
        resource.year === expected.year &&
        resource.datasetId === expected.datasetId &&
        resource.sourceBytes === expected.sourceBytes &&
        resource.sourceSha256 === expected.sourceSha256 &&
        resource.landingUrl === expected.landingUrl &&
        resource.csvUrl === expected.csvUrl;
    }),
    "identità o hash delle risorse ufficiali divergenti",
  );

  return snapshot;
}
