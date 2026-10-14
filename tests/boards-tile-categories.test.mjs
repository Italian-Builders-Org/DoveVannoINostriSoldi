import assert from "node:assert/strict";
import test from "node:test";
import {
  boardDatasetCategory,
  BOARD_DATASET_CATEGORIES,
} from "../src/lib/boards/tile-categories.ts";

test("boardDatasetCategory maps common dataset families", () => {
  assert.equal(boardDatasetCategory("siope_comuni"), "comuni");
  assert.equal(boardDatasetCategory("opencivitas_fabbisogni"), "comuni");
  assert.equal(boardDatasetCategory("openbdap_spesa_stato"), "stato");
  assert.equal(boardDatasetCategory("debito_pubblico_italiano"), "stato");
  assert.equal(boardDatasetCategory("openbdap_ssn_storico_nazionale"), "sanita");
  assert.equal(boardDatasetCategory("inps_pensioni_vigenti"), "lavoro");
  assert.equal(boardDatasetCategory("mef_irpef_dettaglio"), "fisco");
  assert.equal(boardDatasetCategory("anac_cig_snapshot"), "appalti");
  assert.equal(boardDatasetCategory("istat_bes_salute"), "sociale");
  assert.equal(boardDatasetCategory("eurostat_cofog"), "europa");
});

test("every category id is unique and labeled", () => {
  const ids = new Set(BOARD_DATASET_CATEGORIES.map((item) => item.id));
  assert.equal(ids.size, BOARD_DATASET_CATEGORIES.length);
  for (const item of BOARD_DATASET_CATEGORIES) {
    assert.ok(item.label.length > 2);
  }
});
