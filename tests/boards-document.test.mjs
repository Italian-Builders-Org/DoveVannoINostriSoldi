import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  BOARD_TILE_V1_DATASET_IDS,
  assertBoardDocument,
} = await import("../src/lib/data/boards-document.ts");
const { buildBoardTileCatalog } = await import("../src/lib/boards/build-tile-catalog.ts");
const { ACTIVE_DATASET_IDS } = await import("../src/lib/mcp/catalog.ts");

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
  assert.equal(doc.tiles[0].kind, "data");
});

test("assertBoardDocument rejects unknown datasets and views", () => {
  assert.throws(
    () =>
      assertBoardDocument({
        schemaVersion: 1,
        title: "x",
        layout: "grid",
        tiles: [{ id: "a", datasetId: "NOT_VALID", view: "kpi", filters: {} }],
      }),
    /datasetId non valido/,
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

test("featured shortcuts stay twelve while composer sees full MCP catalog", () => {
  const catalog = buildBoardTileCatalog();
  assert.equal(BOARD_TILE_V1_DATASET_IDS.length, 12);
  assert.equal(catalog.length, ACTIVE_DATASET_IDS.length);
  assert.ok(catalog.length >= 90);
  assert.ok(catalog.some((entry) => entry.id === "pnrr_progetti"));
});

test("assertBoardDocument accepts free layout, notes, headings, links and colors", () => {
  const doc = assertBoardDocument({
    schemaVersion: 1,
    title: "Studio",
    layout: "free",
    tiles: [
      {
        id: "t1",
        datasetId: "siope_comuni",
        view: "kpi",
        filters: {},
        frame: { x: 40, y: 40, w: 280, h: 180 },
        color: "#3d9b74",
        subtitle: "Pagamenti di cassa",
      },
      {
        id: "n1",
        kind: "note",
        title: "Contesto",
        body: "Nota per la redazione.",
        frame: { x: 40, y: 240, w: 280, h: 160 },
      },
      {
        id: "h1",
        kind: "heading",
        title: "Dove vanno i pagamenti",
        body: '<p style="font-size: 1.6rem; font-weight: 650;">Dove vanno i pagamenti</p>',
        frame: { x: 40, y: 420, w: 400, h: 120 },
      },
      {
        id: "l1",
        kind: "link",
        title: "Fonte",
        href: "https://www.siope.it/",
        frame: { x: 340, y: 40, w: 240, h: 140 },
      },
    ],
  });
  assert.equal(doc.layout, "free");
  assert.equal(doc.tiles[0].color, "#3d9b74");
  assert.equal(doc.tiles[1].kind, "note");
  assert.equal(doc.tiles[2].kind, "heading");
  assert.equal(doc.tiles[3].kind, "link");
  assert.throws(
    () =>
      assertBoardDocument({
        schemaVersion: 1,
        title: "x",
        layout: "free",
        tiles: [{ id: "a", datasetId: "siope_comuni", view: "kpi", filters: {} }],
      }),
    /frame obbligatorio/,
  );
});
