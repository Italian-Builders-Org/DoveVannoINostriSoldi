import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_TILE_V1_DATASET_IDS,
  assertBoardDocument,
} from "../src/lib/data/boards-document.ts";

test("assertBoardDocument accepts a minimal v1 recipe", () => {
  const doc = assertBoardDocument({
    schemaVersion: 1,
    title: "Il mio comune",
    layout: "grid",
    tiles: [
      {
        id: "t1",
        datasetId: "siope_comuni",
        view: "kpi",
        filters: { year: 2025, region: "Lombardia" },
      },
      {
        id: "t2",
        datasetId: "debito_pubblico_italiano",
        view: "line",
        filters: {},
        title: "Debito Maastricht",
      },
    ],
  });
  assert.equal(doc.tiles.length, 2);
  assert.equal(doc.tiles[0].datasetId, "siope_comuni");
});

test("assertBoardDocument rejects unknown datasets and views", () => {
  assert.throws(
    () =>
      assertBoardDocument({
        schemaVersion: 1,
        title: "x",
        layout: "grid",
        tiles: [{ id: "a", datasetId: "not_a_dataset", view: "kpi", filters: {} }],
      }),
    /catalogo tile v1/,
  );
  assert.throws(
    () =>
      assertBoardDocument({
        schemaVersion: 1,
        title: "x",
        layout: "grid",
        tiles: [{ id: "a", datasetId: "siope_comuni", view: "pivot", filters: {} }],
      }),
    /vista non supportata/,
  );
});

test("assertBoardDocument rejects duplicate tile ids and bad schema", () => {
  assert.throws(
    () =>
      assertBoardDocument({
        schemaVersion: 2,
        title: "x",
        layout: "grid",
        tiles: [],
      }),
    /schemaVersion/,
  );
  assert.throws(
    () =>
      assertBoardDocument({
        schemaVersion: 1,
        title: "x",
        layout: "grid",
        tiles: [
          { id: "same", datasetId: "siope_comuni", view: "table", filters: {} },
          { id: "same", datasetId: "consulenti_incarichi", view: "kpi", filters: {} },
        ],
      }),
    /duplicato/,
  );
});

test("tile v1 catalog lists twelve public MCP dataset ids", () => {
  assert.equal(BOARD_TILE_V1_DATASET_IDS.length, 12);
  assert.ok(BOARD_TILE_V1_DATASET_IDS.includes("debito_pubblico_italiano"));
  assert.ok(BOARD_TILE_V1_DATASET_IDS.includes("eurostat_cofog"));
});
