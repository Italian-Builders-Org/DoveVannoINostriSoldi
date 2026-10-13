import { NextResponse } from "next/server";
import { type BoardTileFilters } from "@/lib/data/boards-document";
import { getSharedBoard, isCloudBoardsEnabled } from "@/lib/boards/cloud-store";
import { readBoardsApiSession } from "@/lib/boards/api-session";
import { buildBoardTileCatalog } from "@/lib/boards/build-tile-catalog";
import { normalizeBoardRegionFilter } from "@/lib/boards/board-region";
import { projectBoardTileSeries } from "@/lib/boards/tile-series";
import { queryPublicDataset } from "@/lib/mcp/datasets";
import type { DatasetQuery } from "@/lib/mcp/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_QUERY: Record<string, Omit<DatasetQuery, "dataset">> = {
  debito_pubblico_italiano: {},
  siope_comuni: { year: 2025 },
  siope_entrate_comuni: { year: 2025 },
  openbdap_spesa_stato: { year: 2026, month: 6 },
  openbdap_ssn_storico_nazionale: {},
  openbdap_ssn_conto_economico: {},
  opencivitas_fabbisogni: { region: "CALABRIA", limit: 20 },
  eurostat_cofog: { country: "IT", year: 2024 },
  istat_cofog: { territory: "IT", year: 2023 },
  consulenti_incarichi: {},
  inps_pensioni_vigenti: {},
  inps_invalidita_civile: {},
  cpt_finanza_regionale: {},
  eurostat_conti_pa: { code: "TE" },
  eurostat_arope: { year: 2024 },
  eurostat_sha_health: {},
  eu_vat_gap_italy: {},
  consip_ordini: {},
  aifa_farmaci_spesa: { year: 2024 },
  company_workforce: { limit: 40 },
  education_students_by_pathway: { limit: 40 },
  mef_iva: { year: 2024, breakdown: "regione", limit: 25 },
  mef_irpef_dettaglio: { family: "tipo_reddito", breakdown: "regione", year: 2025 },
  mef_tax_gap_nazionale: { year: 2022 },
  istat_epea: { year: 2022 },
  istat_poverta_assoluta: { territory: "IT" },
  istat_poverta_relativa: { territory: "IT" },
  istat_poverta_regioni: { territory: "IT" },
  istat_poverta_soglia_assoluta: { year: 2024 },
  istat_poverta_soglia_relativa: { year: 2024 },
  istat_permessi_costruire: { year: 2025, table: "a1" },
  istat_pensionati_persone: { year: 2022 },
  istat_pensioni_prestazioni: { year: 2022 },
  inps_naspi: {},
  inps_assegno_unico: {},
  inps_integrazioni_salariali: {},
  inps_cig_fondi_solidarieta: {},
  inl_vigilanza: { year: 2025, territory: "ITALIA" },
  salute_posti_letto: { limit: 50 },
  ipa_enti: { query: "Comune", limit: 20 },
  anac_operatori: { limit: 10 },
  mef_irpef_comunale: { year: 2024, level: "municipality", query: "Roma", limit: 20 },
  pnrr_asili: {},
  opencoesione_progetti: {},
  controlli_segnali: {},
  anac_cig_snapshot: {},
  mef_partecipazioni: {},
  openbdap_legge_bilancio_storico: {},
  pnrr_progetti: { limit: 40 },
  registro_fonti: {},
  // Lookup-only: demo defaults so the tile paints something in studio
  openbdap_amministrazione: { code: "04", year: 2024 },
  spesa_pa_dettaglio: { code: "fuori-consip", limit: 40 },
  salute_dispositivi_medici: { query: "stent", limit: 20 },
  ipa_struttura: { code: "c_h501" },
  siope_asl: { year: 2025, limit: 100 },
  siope_regioni: { year: 2025, limit: 100 },
  siope_province: { year: 2025, limit: 100 },
  siope_citta_metropolitane: { year: 2025, limit: 100 },
  istat_bes_ambiente: { territory: "IT" },
  istat_bes_innovazione: { territory: "IT" },
  istat_bes_istruzione: { territory: "IT" },
  istat_bes_lavoro: { territory: "IT" },
  istat_bes_paesaggio: { territory: "IT" },
  istat_bes_politica: { territory: "IT" },
  istat_bes_servizi: { territory: "IT" },
  istat_bes_relazioni: { territory: "IT" },
  istat_bes_salute: { territory: "IT" },
  istat_bes_sicurezza: { territory: "IT" },
  istat_bes_economico: { territory: "IT" },
};

const OPENCIVITAS_DEFAULT: Omit<DatasetQuery, "dataset"> = {
  region: "CALABRIA",
  limit: 20,
};

function defaultQueryFor(datasetId: string): Omit<DatasetQuery, "dataset"> {
  if (DEFAULT_QUERY[datasetId]) return { ...DEFAULT_QUERY[datasetId] };
  if (datasetId.startsWith("opencivitas_")) return { ...OPENCIVITAS_DEFAULT };
  if (datasetId.startsWith("istat_bes_")) return { territory: "IT" };
  if (datasetId.startsWith("siope_") && datasetId !== "siope_comuni" && datasetId !== "siope_entrate_comuni") {
    return { year: 2025, limit: 100 };
  }
  return {};
}

const ALLOWED_FILTER_KEYS = new Set([
  "year",
  "month",
  "years",
  "limit",
  "offset",
  "region",
  "code",
  "query",
  "view",
  "dimension",
  "deviceType",
  "country",
  "territory",
  "breakdown",
  "family",
  "level",
  "table",
  "cursor",
]);

const NUMERIC_FILTER_KEYS = new Set(["year", "month", "limit", "offset", "years"]);

function mergeFilters(datasetId: string, filters: BoardTileFilters): DatasetQuery {
  const base = defaultQueryFor(datasetId);
  const query: DatasetQuery = { dataset: datasetId as DatasetQuery["dataset"], ...base };
  for (const [key, value] of Object.entries(filters)) {
    if (!ALLOWED_FILTER_KEYS.has(key)) continue;
    if (value === null || value === undefined || value === "") continue;
    if (NUMERIC_FILTER_KEYS.has(key)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        if (key === "year") query.year = value;
        else if (key === "month") query.month = value;
        else if (key === "limit") query.limit = value;
        else if (key === "offset") query.offset = value;
        else if (key === "years") query.years = value;
      } else if (typeof value === "string" && /^\d+$/u.test(value)) {
        const numeric = Number(value);
        if (key === "year") query.year = numeric;
        else if (key === "month") query.month = numeric;
        else if (key === "limit") query.limit = numeric;
        else if (key === "offset") query.offset = numeric;
        else if (key === "years") query.years = numeric;
      }
      continue;
    }
    if (key === "region" && typeof value === "string") {
      const normalized = normalizeBoardRegionFilter(datasetId, value);
      if (normalized) query.region = normalized;
      continue;
    }
    if (typeof value !== "string") continue;
    if (key === "code") query.code = value;
    else if (key === "query") query.query = value;
    else if (key === "view" && (value === "search" || value === "aggregate" || value === "device" || value === "facts" || value === "filters")) {
      query.view = value;
    } else if (key === "dimension" && (value === "territory" || value === "classification" || value === "manufacturer")) {
      query.dimension = value;
    } else if (key === "deviceType" && (value === "1" || value === "2")) {
      query.deviceType = value;
    } else if (key === "country") query.country = value;
    else if (key === "territory") query.territory = value;
    else if (key === "breakdown") query.breakdown = value;
    else if (key === "family") query.family = value;
    else if (key === "level" && (value === "region" || value === "province" || value === "municipality")) {
      query.level = value;
    } else if (key === "table") query.table = value;
    else if (key === "cursor") query.cursor = value;
  }
  return query;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido." }, { status: 400 });
  }
  const record = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
  const shareToken = typeof record.shareToken === "string" ? record.shareToken : "";
  const { session, revoked } = await readBoardsApiSession();
  if (revoked) return revoked;

  if (!session) {
    if (!shareToken || !isCloudBoardsEnabled()) {
      return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
    }
    if (!/^[a-zA-Z0-9_-]{24,64}$/u.test(shareToken)) {
      return NextResponse.json({ error: "Token share non valido." }, { status: 400 });
    }
    const shared = await getSharedBoard(shareToken);
    if (!shared) {
      return NextResponse.json({ error: "Link non valido o revocato." }, { status: 404 });
    }
  }

  const datasetId = typeof record.datasetId === "string" ? record.datasetId : "";
  const catalog = buildBoardTileCatalog();
  if (!catalog.some((entry) => entry.id === datasetId)) {
    return NextResponse.json({ error: "Dataset non ammissibile nella board." }, { status: 400 });
  }
  const filters =
    typeof record.filters === "object" && record.filters && !Array.isArray(record.filters)
      ? (record.filters as BoardTileFilters)
      : {};

  try {
    const query = mergeFilters(datasetId, filters);
    const raw = await queryPublicDataset(query);
    const payload = projectBoardTileSeries(datasetId, raw, filters);
    return NextResponse.json(
      { ok: true, payload },
      {
        headers: {
          "Cache-Control": shareToken ? "public, max-age=60" : "private, max-age=60",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lettura dati non riuscita.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
