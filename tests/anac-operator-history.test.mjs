import assert from "node:assert/strict";
import { operatorHistoryFixture } from "./helpers/operator-history-fixture.mjs";
import test from "node:test";
import { historySummarySchema } from "../src/lib/data/anac-operator-history-contract.ts";

const { summary: fixture } = operatorHistoryFixture();

test("il contratto runtime legge la proiezione ETL completa, con zero osservato e CIG non abbinati", () => {
  const parsed = historySummarySchema.parse(fixture);
  assert.equal(parsed.awardCount, 205);
  assert.equal(parsed.yearly[0].attributedValue, "0");
  assert.equal(parsed.awardsWithoutCigMatch, 205);
  assert.equal(parsed.distinctContractingAuthorityCount, 0);
  assert.equal(parsed.detail.blocks.length, 3);
});

test("blocca pagine mancanti, hash malformati, denominatori falsi e campi privati", () => {
  for (const mutate of [
    (value) => value.detail.blocks.pop(),
    (value) => value.detail.blocks[1].offset++,
    (value) => (value.detail.blocks[0].sha256 = "unverified"),
    (value) => (value.screening2025.below140000 = 1),
    (value) => (value.yearly[0].attributedValue = null),
    (value) => (value.attributedValue = "0.01"),
    (value) => (value.codice_fiscale = "not-public"),
  ]) {
    const value = structuredClone(fixture);
    mutate(value);
    assert.equal(historySummarySchema.safeParse(value).success, false);
  }
});

const {
  selectOperatorHistoryPage,
  parseOperatorHistorySearch,
  operatorHistoryHref,
} = await import("../src/lib/anac-operator-history-query.ts");

test("i link conservano i filtri e il parser rifiuta parametri ripetuti o numeri ambigui", () => {
  const query = parseOperatorHistorySearch({
    year: "missing",
    procedure: "PROCEDURA A & B",
    minAmount: "0",
    page: "2",
  });
  const url = new URL(
    operatorHistoryHref("op-00000001", query),
    "https://example.test",
  );
  assert.deepEqual(
    parseOperatorHistorySearch(Object.fromEntries(url.searchParams)),
    query,
  );
  assert.throws(() => parseOperatorHistorySearch({ page: ["1", "2"] }));
  assert.throws(() => parseOperatorHistorySearch({ year: "2e3" }));
  assert.throws(() => parseOperatorHistorySearch({ page: "1.5" }));
  assert.deepEqual(parseOperatorHistorySearch({ year: "", minAmount: "" }), {
    page: 1,
  });
});

test("pagina tutto lo storico e combina filtri senza confondere mancante e zero o arrotondare gli importi", () => {
  const history = historySummarySchema.parse(fixture);
  assert.equal(
    selectOperatorHistoryPage(history, { page: 9 }).positions.length,
    5,
  );
  assert.equal(
    selectOperatorHistoryPage(history, { page: 10 }).positions.length,
    0,
  );
  const rows = history.detail.filterRows;
  rows[0] = [
    2025,
    "authority-00000001",
    "AFFIDAMENTO DIRETTO",
    "9007199254740992.01",
  ];
  rows[1] = [
    2025,
    "authority-00000001",
    "AFFIDAMENTO DIRETTO",
    "9007199254740992.02",
  ];
  rows[2] = [null, null, null, null];
  assert.deepEqual(
    selectOperatorHistoryPage(history, {
      year: 2025,
      authority: "authority-00000001",
      procedure: "AFFIDAMENTO DIRETTO",
      minAmount: "9007199254740992.02",
      maxAmount: "9007199254740992.02",
    }).positions,
    [1],
  );
  assert.deepEqual(
    selectOperatorHistoryPage(history, { year: "missing" }).positions,
    [2],
  );
  assert.equal(
    selectOperatorHistoryPage(history, { minAmount: "0", maxAmount: "0" })
      .total,
    202,
  );
  assert.throws(() =>
    selectOperatorHistoryPage(history, { minAmount: "20", maxAmount: "10" }),
  );
  assert.throws(() => selectOperatorHistoryPage(history, { page: 0 }));
});

test("la paginazione conserva il totale filtrato anche oltre la pagina richiesta", () => {
  const history = historySummarySchema.parse(fixture);
  history.detail.filterRows = Array.from({ length: 105 }, (_, index) => [
    index % 2 ? 2024 : 2025, null, null, "0",
  ]);
  assert.deepEqual(selectOperatorHistoryPage(history, { year: 2025, page: 3 }), {
    total: 53, page: 3, pageCount: 3, positions: [100, 102, 104],
  });
  assert.deepEqual(selectOperatorHistoryPage(history, { year: 2025, page: 4 }), {
    total: 53, page: 4, pageCount: 3, positions: [],
  });
  assert.deepEqual(selectOperatorHistoryPage(history, { page: 5 }), {
    total: 105, page: 5, pageCount: 5, positions: [100, 101, 102, 103, 104],
  });
  history.detail.filterRows = [];
  assert.deepEqual(selectOperatorHistoryPage(history, {}), {
    total: 0, page: 1, pageCount: 0, positions: [],
  });
});

test("invalid amount intervals fail before loading operator history", () => {
  assert.throws(() => parseOperatorHistorySearch({ minAmount: "10.01", maxAmount: "10" }));
});
