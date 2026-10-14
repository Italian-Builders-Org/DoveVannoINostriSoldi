import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { tableRowAxisLabel } from "../src/lib/boards/table-axis.ts";

test("table row axis: periodi temporali vs voci territoriali", () => {
  assert.equal(
    tableRowAxisLabel([{ label: "2020" }, { label: "2021" }, { label: "2022" }]),
    "Periodo",
  );
  assert.equal(
    tableRowAxisLabel([
      { label: "gen 24" },
      { label: "feb 24" },
      { label: "mar 24" },
    ]),
    "Periodo",
  );
  assert.equal(
    tableRowAxisLabel([
      { label: "Lombardia" },
      { label: "Lazio" },
      { label: "Campania" },
      { label: "Sicilia" },
    ]),
    "Voce",
  );
  assert.equal(tableRowAxisLabel([]), "Voce");
});

test("board table view renders all points, not a truncated slice", async () => {
  const source = await readFile(
    new URL("../src/app/dashboard/board-tile-chart.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /payload\.points\.map\(/);
  assert.doesNotMatch(source, /points\.slice\(-8\)/);
  assert.match(source, /tableRowAxisLabel\(payload\.points\)/);
});
