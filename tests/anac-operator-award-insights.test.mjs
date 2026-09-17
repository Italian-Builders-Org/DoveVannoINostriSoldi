import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const {
  ANAC_CIG_DETAIL_URL,
  BELOW_THRESHOLD_REQUIRED_INPUTS,
  BELOW_THRESHOLD_STATUS,
  OPERATOR_AUTHORITY_LIST_CAP,
  OPERATOR_THRESHOLD_METHODOLOGY_URL,
  anacCigDetailUrl,
  describeDistinctContractingAuthorities,
  distinctContractingAuthorities,
  publishedProcedureFields,
} = await import("../src/lib/anac-operator-award-insights.ts");

function read(relative) {
  return readFileSync(resolve(root, relative), "utf8");
}

test("anacCigDetailUrl builds the official ANAC link only for well-formed CIGs", () => {
  assert.equal(
    anacCigDetailUrl("B51ABEC4F6"),
    `${ANAC_CIG_DETAIL_URL}B51ABEC4F6`,
  );
  assert.equal(ANAC_CIG_DETAIL_URL, "https://dati.anticorruzione.it/superset/dashboard/dettaglio_cig/?cig=");
});

test("anacCigDetailUrl never links a CIG that the source did not publish", () => {
  for (const value of [
    "",
    "b51abec4f6",
    "B51ABEC4F",
    "B51ABEC4F60",
    "B51ABEC4F-",
    "B51ABEC4F6 ",
    "../../etc/passwd",
    "AAAAAAAAAA<script>",
    null,
    undefined,
    42,
  ]) {
    assert.equal(anacCigDetailUrl(value), null, `atteso null per ${String(value)}`);
  }
});

test("distinctContractingAuthorities is exact under the published cap", () => {
  assert.deepEqual(distinctContractingAuthorities(undefined), { count: 0, capped: false });
  assert.deepEqual(distinctContractingAuthorities([]), { count: 0, capped: false });
  assert.deepEqual(
    distinctContractingAuthorities([{ label: "COMUNE DI TERNI" }, { label: "CONSORZIO TEVERE" }]),
    { count: 2, capped: false },
  );
});

test("distinctContractingAuthorities becomes a declared minimum at the cap", () => {
  const atCap = Array.from({ length: OPERATOR_AUTHORITY_LIST_CAP }, (_, index) => ({
    label: `ENTE ${index}`,
  }));
  assert.deepEqual(distinctContractingAuthorities(atCap), {
    count: OPERATOR_AUTHORITY_LIST_CAP,
    capped: true,
  });
  const beyondCap = [...atCap, { label: "ENTE EXTRA" }];
  assert.deepEqual(distinctContractingAuthorities(beyondCap), {
    count: OPERATOR_AUTHORITY_LIST_CAP,
    capped: true,
  });
});

test("distinctContractingAuthorities deduplicates and drops blank labels", () => {
  assert.deepEqual(
    distinctContractingAuthorities([
      { label: " COMUNE DI TERNI " },
      { label: "COMUNE DI TERNI" },
      { label: "   " },
    ]),
    { count: 1, capped: false },
  );
});

test("describeDistinctContractingAuthorities never states an exact figure when capped", () => {
  assert.equal(describeDistinctContractingAuthorities({ count: 0, capped: false }), "nessuna stazione appaltante abbinata");
  assert.equal(describeDistinctContractingAuthorities({ count: 1, capped: false }), "1 stazione appaltante distinta");
  assert.equal(
    describeDistinctContractingAuthorities({ count: 3, capped: false }),
    "3 stazioni appaltanti distinte",
  );
  assert.equal(
    describeDistinctContractingAuthorities({ count: 5, capped: true }),
    "5 o più stazioni appaltanti distinte",
  );
});

test("publishedProcedureFields hides procedure detail that is not matched in source", () => {
  const matched = {
    oggetto: "LAVORI",
    cpvCode: "45454100-5",
    cpvLabel: "LAVORI DI RESTAURO",
    contractingAuthority: "COMUNE DI TERNI",
    cigYear: 2022,
    matched: true,
  };
  assert.equal(publishedProcedureFields(matched), matched);
  assert.equal(publishedProcedureFields({ ...matched, matched: false }), null);
  assert.equal(publishedProcedureFields(undefined), null);
});

test("below-threshold classification stays declared as not available", () => {
  assert.equal(BELOW_THRESHOLD_STATUS, "non disponibile");
  const required = BELOW_THRESHOLD_REQUIRED_INPUTS.join(" | ").toLowerCase();
  for (const token of ["valore stimato", "lavori", "settore", "procedura", "soglia"]) {
    assert.match(required, new RegExp(token));
  }
});

test("the published authority cap stays aligned with the ETL index", () => {
  const enrich = read("scripts/etl/anac_operator_cig_enrich.py");
  const block = /top_authorities = \[[\s\S]*?\n {4}\]/.exec(enrich);
  assert.ok(block, "blocco top_authorities non trovato nell'ETL");
  const cap = /\[:(\d+)\]/.exec(block[0]);
  assert.ok(cap, "tetto dell'elenco stazioni non trovato nell'ETL");
  assert.equal(Number(cap[1]), OPERATOR_AUTHORITY_LIST_CAP);
});

test("the methodology document exists and matches the published contract", () => {
  const doc = read("docs/ANAC_OPERATOR_THRESHOLD.md");
  assert.match(doc, /sotto soglia/i);
  assert.match(doc, /BELOW_THRESHOLD_STATUS/);
  assert.match(doc, /tipo_scelta_contraente/);
  assert.match(doc, /importo_lotto/);
  assert.ok(OPERATOR_THRESHOLD_METHODOLOGY_URL.endsWith("/docs/ANAC_OPERATOR_THRESHOLD.md"));
});
