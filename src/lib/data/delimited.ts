export type DelimitedRecord = Record<string, string>;

export function decodePublicDataText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buffer).replace(/^\uFEFF/, "");
  }
}

export function parseDelimitedRows(input: string, delimiter = ";"): string[][] {
  if (delimiter.length !== 1) throw new Error("Il delimitatore deve essere un singolo carattere");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
      continue;
    }

    if (character === delimiter) {
      row.push(field.trim());
      field = "";
      continue;
    }

    if (character === "\n") {
      row.push(field.trim().replace(/\r$/, ""));
      field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    field += character;
  }

  if (quoted) throw new Error("CSV non valido: campo quoted non terminato");

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim().replace(/\r$/, ""));
    if (row.some((value) => value.length > 0)) rows.push(row);
  }

  return rows;
}

export function parseDelimitedRecords(input: string, delimiter = ";"): DelimitedRecord[] {
  const rows = parseDelimitedRows(input, delimiter);
  const rawHeaders = rows[0] ?? [];
  const headers = rawHeaders.map((header) => header.trim());

  if (headers.every((header) => header.length === 0)) return [];

  return rows.slice(1).map((values) => {
    const record: DelimitedRecord = {};

    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = values[index] ?? "";
    });

    return record;
  });
}

export function parsePublicNumber(value: string | undefined): number {
  if (!value) return 0;
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
