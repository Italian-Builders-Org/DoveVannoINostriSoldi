import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { partialMonthOf } from "../src/lib/siope-calendar.ts";

const snapshots = [
  ["2024", new URL("../src/data/generated/siope-municipal-2024.json", import.meta.url)],
  ["2025", new URL("../src/data/generated/siope-municipal-2025.json", import.meta.url)],
  ["2026", new URL("../src/data/generated/siope-municipal.json", import.meta.url)],
];

test("a closed SIOPE year has no month still filling up", async () => {
  for (const [label, url] of snapshots) {
    const data = JSON.parse(await readFile(url, "utf8"));
    const observedYear = new Date(data.source.observedAt).getUTCFullYear();
    const partial = partialMonthOf(data.year, data.latestMonth, data.source.observedAt);

    if (observedYear > data.year) {
      assert.equal(partial, null, `${label} was downloaded after it ended, so it is closed`);
      assert.equal(
        data.latestMonth,
        12,
        `${label} is closed, so the source must publish all twelve months`,
      );
      assert.equal(data.monthly.length, 12, `${label} must carry twelve monthly points`);
    } else {
      assert.equal(
        partial,
        data.latestMonth,
        `${label} is the running year, so its newest month is still partial`,
      );
    }
  }
});

test("every month of a closed year counts towards the completed-month average", async () => {
  for (const [label, url] of snapshots) {
    const data = JSON.parse(await readFile(url, "utf8"));
    const partial = partialMonthOf(data.year, data.latestMonth, data.source.observedAt);
    const settled = data.monthly.filter((point) => point.month !== partial);

    assert.equal(
      settled.length,
      partial === null ? data.monthly.length : data.monthly.length - 1,
      `${label} must drop exactly the running month, and only when there is one`,
    );

    // The average the pages show has to be the mean of the settled months.
    const average = settled.reduce((total, point) => total + point.flow, 0) / settled.length;
    assert.ok(average > 0, `${label} must have a positive completed-month average`);
    assert.ok(
      average <= data.totalPaid,
      `${label} average cannot exceed the yearly total`,
    );
  }
});

test("an unreadable observation date leaves the newest month marked as partial", () => {
  assert.equal(partialMonthOf(2025, 12, "not-a-date"), 12);
  assert.equal(partialMonthOf(2026, 8, ""), 8);
});

test("the rule keys on the year we downloaded the file, not on the month", () => {
  assert.equal(partialMonthOf(2026, 8, "2026-08-20T04:06:40+00:00"), 8);
  assert.equal(partialMonthOf(2026, 12, "2026-12-31T23:59:59+00:00"), 12);
  assert.equal(partialMonthOf(2025, 12, "2026-01-01T00:00:00+00:00"), null);
  assert.equal(partialMonthOf(2024, 12, "2026-08-20T11:18:14+00:00"), null);
});
