import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeBoardRegionFilter,
  boardRegionOptionsForDataset,
} from "../src/lib/boards/board-region.ts";

test("normalizeBoardRegionFilter maps names to AIFA ISTAT codes", () => {
  assert.equal(normalizeBoardRegionFilter("aifa_farmaci_spesa", "Lombardia"), "030");
  assert.equal(normalizeBoardRegionFilter("aifa_farmaci_spesa", "030"), "030");
  assert.equal(normalizeBoardRegionFilter("aifa_farmaci_spesa", "30"), "030");
  assert.equal(normalizeBoardRegionFilter("aifa_farmaci_spesa", "Valle d'Aosta"), "020");
  assert.equal(normalizeBoardRegionFilter("aifa_farmaci_spesa", "xyz"), undefined);
});

test("normalizeBoardRegionFilter uppercases OpenCivitas names", () => {
  assert.equal(normalizeBoardRegionFilter("opencivitas_fabbisogni", "Calabria"), "CALABRIA");
  assert.equal(normalizeBoardRegionFilter("opencivitas_fabbisogni", "EMILIA-ROMAGNA"), "EMILIA-ROMAGNA");
});

test("boardRegionOptionsForDataset switches AIFA to ISTAT codes", () => {
  const aifa = boardRegionOptionsForDataset("aifa_farmaci_spesa");
  assert.ok(aifa.some((item) => item.value === "030"));
  const generic = boardRegionOptionsForDataset("siope_comuni");
  assert.ok(generic.some((item) => item.value === "LOMBARDIA"));
});
