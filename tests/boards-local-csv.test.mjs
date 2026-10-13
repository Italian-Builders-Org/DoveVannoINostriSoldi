import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  buildLocalTableFromCsv,
  parseLocaleNumber,
  projectLocalTable,
} = await import("../src/lib/boards/local-csv.ts");
const { assertBoardDocument } = await import("../src/lib/data/boards-document.ts");
const { createLocalTile } = await import("../src/lib/boards/local-board.ts");

test("parseLocaleNumber accepts Italian and plain decimals", () => {
  assert.equal(parseLocaleNumber("1.234,56"), 1234.56);
  assert.equal(parseLocaleNumber("1234.5"), 1234.5);
  assert.equal(parseLocaleNumber("—"), null);
});

test("CSV with semicolon builds a plottable local table", () => {
  const csv = [
    "Anno;Spesa;Entrate",
    "2022;1000000;900000",
    "2023;1.100.000;950000",
    "2024;1200000;1.000.000",
  ].join("\n");
  const table = buildLocalTableFromCsv(csv, "bilancio.csv");
  assert.equal(table.labelColumn, "Anno");
  assert.ok(table.valueColumns.includes("Spesa"));
  const payload = projectLocalTable(table, "Bilancio");
  assert.equal(payload.points.length, 3);
  assert.ok(payload.kpi);
  assert.match(payload.caveat ?? "", /utente/i);
});

test("assertBoardDocument accepts local CSV tiles in free layout", () => {
  const table = buildLocalTableFromCsv(
    "mese,valore\nGen,10\nFeb,20\nMar,15\n",
    "serie.csv",
  );
  const tile = createLocalTile(table, [], "line");
  const doc = assertBoardDocument({
    schemaVersion: 1,
    title: "Con CSV",
    layout: "free",
    tiles: [tile],
  });
  assert.equal(doc.tiles[0].kind, "local");
  assert.equal(doc.tiles[0].localTable?.rows.length, 3);
});
