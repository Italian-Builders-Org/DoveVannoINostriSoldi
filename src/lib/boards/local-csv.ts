import type { BoardLocalTable } from "@/lib/data/boards-document";
import type { BoardSeriesMeta, BoardSeriesPoint, BoardTileSeriesPayload } from "@/lib/boards/tile-series";

export const LOCAL_CSV_MAX_ROWS = 500;
export const LOCAL_CSV_MAX_COLUMNS = 24;
export const LOCAL_CSV_MAX_CELL_CHARS = 80;
export const LOCAL_CSV_MAX_VALUE_COLUMNS = 3;
export const LOCAL_CSV_MAX_BYTES = 512_000;

const euro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
  useGrouping: "always",
});

function slugColumn(label: string, index: number): string {
  const base = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 40);
  return base || `col_${index + 1}`;
}

/** Parse CSV/TSV with quoted fields; delimiter auto , ; or tab. */
export function parseDelimitedTable(text: string): { headers: string[]; rows: string[][] } {
  const sample = text.slice(0, 4096);
  const comma = (sample.match(/,/g) ?? []).length;
  const semi = (sample.match(/;/g) ?? []).length;
  const tab = (sample.match(/\t/g) ?? []).length;
  let delimiter = ",";
  if (tab >= comma && tab >= semi && tab > 0) delimiter = "\t";
  else if (semi > comma) delimiter = ";";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }

  if (rows.length === 0) {
    throw new Error("Il file non contiene righe leggibili.");
  }
  const headers = rows[0]!.map((header, index) => {
    const trimmed = header.trim().slice(0, LOCAL_CSV_MAX_CELL_CHARS);
    return trimmed || `Colonna ${index + 1}`;
  });
  if (headers.length === 0 || headers.length > LOCAL_CSV_MAX_COLUMNS) {
    throw new Error(`Servono da 1 a ${LOCAL_CSV_MAX_COLUMNS} colonne.`);
  }
  const unique = new Set(headers.map((header, index) => slugColumn(header, index)));
  if (unique.size !== headers.length) {
    // Keep display headers; uniqueness is enforced via slug ids at projection time.
  }
  const body = rows.slice(1, 1 + LOCAL_CSV_MAX_ROWS).map((cells) => {
    const normalized = headers.map((_, index) =>
      String(cells[index] ?? "").trim().slice(0, LOCAL_CSV_MAX_CELL_CHARS),
    );
    return normalized;
  });
  if (body.length === 0) {
    throw new Error("Il file ha solo l’intestazione, senza righe di dati.");
  }
  return { headers, rows: body };
}

export function parseLocaleNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "—" || trimmed === "-") return null;
  let normalized = trimmed.replace(/\s/gu, "").replace(/€/gu, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/u.test(normalized) || /^-?\d+,\d+$/u.test(normalized)) {
    normalized = normalized.replace(/\./gu, "").replace(",", ".");
  } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/u.test(normalized)) {
    normalized = normalized.replace(/,/gu, "");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function inferColumns(headers: string[], rows: string[][]): {
  labelColumn: string;
  valueColumns: string[];
} {
  const numericScores = headers.map((header, index) => {
    let hits = 0;
    for (const row of rows.slice(0, 40)) {
      if (parseLocaleNumber(row[index] ?? "") !== null) hits += 1;
    }
    return { header, index, hits };
  });
  const valueColumns = numericScores
    .filter((item) => item.hits >= Math.max(1, Math.floor(Math.min(rows.length, 40) * 0.5)))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, LOCAL_CSV_MAX_VALUE_COLUMNS)
    .map((item) => item.header);
  const labelColumn =
    headers.find((header) => !valueColumns.includes(header))
    ?? headers[0]!;
  if (valueColumns.length === 0) {
    throw new Error("Nessuna colonna numerica riconosciuta nel CSV.");
  }
  return { labelColumn, valueColumns };
}

export function buildLocalTableFromCsv(
  text: string,
  filename: string,
  importedAt = new Date().toISOString(),
): BoardLocalTable {
  if (text.length > LOCAL_CSV_MAX_BYTES) {
    throw new Error(`File troppo grande (max ${Math.round(LOCAL_CSV_MAX_BYTES / 1024)} KB).`);
  }
  const { headers, rows } = parseDelimitedTable(text);
  const { labelColumn, valueColumns } = inferColumns(headers, rows);
  return {
    filename: filename.slice(0, 120) || "dati.csv",
    importedAt,
    headers,
    rows,
    labelColumn,
    valueColumns,
  };
}

export function projectLocalTable(
  table: BoardLocalTable,
  title = "Dati importati",
): BoardTileSeriesPayload {
  const labelIndex = table.headers.indexOf(table.labelColumn);
  if (labelIndex < 0) {
    throw new Error("Colonna etichetta non trovata nella tabella locale.");
  }
  const series: BoardSeriesMeta[] = [];
  const valueIndexes: Array<{ id: string; index: number }> = [];
  for (const [offset, header] of table.valueColumns.entries()) {
    const index = table.headers.indexOf(header);
    if (index < 0) continue;
    const id = slugColumn(header, offset);
    series.push({ id, label: header });
    valueIndexes.push({ id, index });
  }
  if (series.length === 0) {
    throw new Error("Nessuna colonna valore valida.");
  }

  const points: BoardSeriesPoint[] = [];
  for (const row of table.rows) {
    const label = (row[labelIndex] ?? "").trim() || "—";
    const values: Record<string, number> = {};
    for (const column of valueIndexes) {
      const parsed = parseLocaleNumber(row[column.index] ?? "");
      if (parsed !== null) values[column.id] = parsed;
    }
    if (Object.keys(values).length === 0) continue;
    points.push({ label, values });
  }
  if (points.length === 0) {
    throw new Error("Nessun punto numerico plotabile.");
  }

  const firstSeries = series[0]!.id;
  const last = points.at(-1)!.values[firstSeries] ?? Object.values(points.at(-1)!.values)[0]!;
  return {
    datasetId: "local_csv",
    title,
    periodLabel: `${table.filename} · ${points.length} righe`,
    unitLabel: "valore",
    caveat: "Dati caricati dall’utente: non sono una fonte ufficiale DVNS.",
    provenance: {
      readAt: table.importedAt,
      periodLabel: table.filename,
      caveat: "Import locale",
      sourceIds: [],
      datasetId: "local_csv",
    },
    series,
    points,
    kpi: {
      label: series[0]!.label,
      value: last,
      formatted: euro.format(last),
    },
  };
}
