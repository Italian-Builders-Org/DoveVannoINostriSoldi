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

test("gli intervalli monetari ordinano esattamente segni, zero con scala e cifre oltre Number", () => {
  const history = historySummarySchema.parse(fixture);
  const largest = `${"9".repeat(50)}.${"9".repeat(49)}`;
  const largestBefore = `${"9".repeat(50)}.${"9".repeat(48)}8`;
  const amounts = [
    "-10", "-0.0001", "-0.00", "0", "0.0000", "0.0001",
    "1.01", "1.1", "9.999", "10", "9007199254740992.01",
    "9007199254740992.02", largestBefore, largest, null,
  ];
  history.detail.filterRows = amounts.map((amount) => [2025, null, null, amount]);
  const positions = (input) => selectOperatorHistoryPage(history, input).positions;
  assert.deepEqual(positions({ minAmount: "0", maxAmount: "0.00000" }), [2, 3, 4]);
  assert.deepEqual(positions({ maxAmount: "0" }), [0, 1, 2, 3, 4]);
  assert.deepEqual(positions({ minAmount: "0.00010", maxAmount: "1.1000" }), [5, 6, 7]);
  assert.deepEqual(positions({ minAmount: "9.9990", maxAmount: "10.000" }), [8, 9]);
  assert.deepEqual(positions({ minAmount: "9007199254740992.010", maxAmount: "9007199254740992.0100" }), [10]);
  assert.deepEqual(positions({ minAmount: largestBefore, maxAmount: largestBefore }), [12]);
  assert.deepEqual(positions({ minAmount: largest, maxAmount: largest }), [13]);
  for (const value of ["-1", "-0", "01", "1e2", "Infinity", "NaN"]) {
    assert.throws(() => selectOperatorHistoryPage(history, { minAmount: value }));
    assert.throws(() => selectOperatorHistoryPage(history, { maxAmount: value }));
  }
});

test("la query monetaria conta tutte le pagine e osserva righe sostituite senza stato condiviso", () => {
  const history = historySummarySchema.parse(fixture);
  history.detail.filterRows = Array.from({ length: 110 }, (_, index) => [
    index % 2 ? 2024 : 2025,
    index % 2 ? "authority-00000002" : "authority-00000001",
    "PROCEDURA PUBBLICATA",
    index === 0 ? null : "1.00000",
  ]);
  const query = {
    year: 2025,
    authority: "authority-00000001",
    procedure: "PROCEDURA PUBBLICATA",
    minAmount: "1",
    maxAmount: "1.00",
    page: 3,
  };
  const expected = { total: 54, page: 3, pageCount: 3, positions: [102, 104, 106, 108] };
  const before = structuredClone(history.detail.filterRows);
  assert.deepEqual(selectOperatorHistoryPage(history, query), expected);
  assert.deepEqual(history.detail.filterRows, before);
  assert.deepEqual(selectOperatorHistoryPage(history, { ...query, page: 4 }), {
    total: 54, page: 4, pageCount: 3, positions: [],
  });
  history.detail.filterRows[0] = [2025, "authority-00000001", "PROCEDURA PUBBLICATA", "1"];
  assert.deepEqual(selectOperatorHistoryPage(history, query), {
    total: 55, page: 3, pageCount: 3, positions: [100, 102, 104, 106, 108],
  });
});
