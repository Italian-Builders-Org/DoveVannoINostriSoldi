import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  MedicalDeviceQueryError,
  aggregateMedicalDeviceSpending,
  listMedicalDeviceAggregateFacts,
  listMedicalDeviceFacts,
  searchMedicalDevices,
} = await import("../src/lib/medical-device-spending.ts");

test("medical-device search keeps the composite key and supports combined territorial filters", async () => {
  const ambiguous = await searchMedicalDevices({ q: "122392", limit: 10 });
  assert.equal(ambiguous.requiresType, true);
  assert.deepEqual(new Set(ambiguous.hits.filter(hit => hit.number === "122392").map(hit => hit.type)), new Set(["1", "2"]));

  const byCatalog = await searchMedicalDevices({ q: "PRPR0005", type: "1", limit: 5 });
  assert.equal(byCatalog.hits[0].number, "1175175");
  assert.equal(byCatalog.hits[0].catalog, "PRPR0005");
  assert.equal("facts" in byCatalog.hits[0], false);
  const byManufacturer = await searchMedicalDevices({ q: "MICROPORT ORTHOPEDICS", type: "1" });
  assert.ok(byManufacturer.matched > 0);
  assert.ok(byManufacturer.hits.every(hit => hit.manufacturer === "MICROPORT ORTHOPEDICS INC"));
  const byClassification = await searchMedicalDevices({ q: "P090804010204", type: "1" });
  assert.ok(byClassification.matched > 0);
  assert.ok(byClassification.hits.every(hit => hit.classification === "P090804010204"));

  const detail = await listMedicalDeviceFacts({ type: "1", number: "1175175", limit: 1 });
  assert.equal(detail.rows.length, 1);
  assert.equal("facts" in detail.device, false);
  assert.match(detail.rows[0].catalog.href, /^\/dati\/salute-spesa-dispositivi-/);
  assert.ok(detail.rows[0].catalog.sourceRow > 0);
  const fact = detail.rows[0];
  const filtered = await searchMedicalDevices({
    q: "PROFEMUR PRESERVE",
    type: "1",
    year: String(fact.year),
    region: fact.region,
    company: fact.company,
  });
  assert.ok(filtered.hits.some(hit => hit.number === "1175175"));
});

test("medical-device aggregates reconcile coverage and paginate without gaps", async () => {
  const first = await aggregateMedicalDeviceSpending({ year: "2020", dimension: "classification", limit: 1 });
  assert.deepEqual(first.coverage, {
    rows: 787845,
    spending: "5054732845.13",
    negativeRows: 887,
    zeroRows: 28173,
    matchedRows: 787842,
    matchedSpending: "5054725570.50",
    unresolvedRows: 3,
    unresolvedSpending: "7274.63",
  });
  assert.equal(first.rows.length, 1);
  assert.ok(first.pagination.nextCursor);
  const underlying = await listMedicalDeviceAggregateFacts({
    year: "2020",
    dimension: first.rows[0].drilldown.dimension,
    value: first.rows[0].drilldown.value,
    role: first.rows[0].drilldown.role,
    limit: 1,
  });
  assert.equal(underlying.matched, first.rows[0].rows);
  assert.equal(underlying.rows.length, 1);
  assert.match(underlying.rows[0].catalog.href, /^\/dati\/salute-spesa-dispositivi-2020$/);
  assert.ok(underlying.pagination.nextCursor);
  const nextUnderlying = await listMedicalDeviceAggregateFacts({
    year: "2020",
    dimension: first.rows[0].drilldown.dimension,
    value: first.rows[0].drilldown.value,
    role: first.rows[0].drilldown.role,
    limit: 1,
    cursor: underlying.pagination.nextCursor,
  });
  assert.notDeepEqual(nextUnderlying.rows[0].catalog, underlying.rows[0].catalog);
  const second = await aggregateMedicalDeviceSpending({
    year: "2020",
    dimension: "classification",
    limit: 1,
    cursor: first.pagination.nextCursor,
  });
  assert.notDeepEqual(second.rows[0], first.rows[0]);
  await assert.rejects(
    aggregateMedicalDeviceSpending({ year: "2020", region: "10", company: "10203", dimension: "other" }),
    MedicalDeviceQueryError,
  );
});

test("medical-device facts use source-bound cursors and honor cancellation", async () => {
  const first = await listMedicalDeviceFacts({ type: "1", number: "1175175", limit: 1 });
  if (first.pagination.nextCursor) {
    const second = await listMedicalDeviceFacts({
      type: "1",
      number: "1175175",
      limit: 1,
      cursor: first.pagination.nextCursor,
    });
    assert.notEqual(second.rows[0].sourceRow, first.rows[0].sourceRow);
    await assert.rejects(
      listMedicalDeviceFacts({ type: "1", number: "1175175", year: "2020", cursor: first.pagination.nextCursor }),
      MedicalDeviceQueryError,
    );
  }
  const controller = new AbortController();
  controller.abort(new DOMException("annullato", "AbortError"));
  await assert.rejects(searchMedicalDevices({ q: "protesi", signal: controller.signal }), { name: "AbortError" });
  const duringSearch = new AbortController();
  const pending = searchMedicalDevices({ q: "protesi", signal: duringSearch.signal });
  setImmediate(() => duringSearch.abort(new DOMException("annullato", "AbortError")));
  await assert.rejects(pending, { name: "AbortError" });
});

test("manufacturer drilldown accepts the full labels emitted by aggregation", async () => {
  let cursor;
  let longest;
  do {
    const page = await aggregateMedicalDeviceSpending({ year: "2020", dimension: "manufacturer", limit: 100, cursor });
    for (const row of page.rows) {
      if ((row.label?.length ?? 0) > (longest?.label?.length ?? 0)) longest = row;
    }
    cursor = page.pagination.nextCursor;
  } while (cursor);
  assert.ok(longest.label.length > 0);
  const page = await listMedicalDeviceAggregateFacts({
    year: "2020", dimension: "manufacturer", value: longest.label, role: longest.role, limit: 1,
  });
  assert.equal(page.matched, longest.rows);
});
