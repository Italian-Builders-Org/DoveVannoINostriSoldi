import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { validateMefIvaBundle, mefIvaCellSchema } = await import("../src/lib/data/mef-iva-contract.ts");
const { mefIvaData, queryMefIva } = await import("../src/lib/mef-iva-snapshot.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const read = (suffix) => JSON.parse(readFileSync(new URL(`../src/data/generated/mef-iva-2024-2025.${suffix}.json`, import.meta.url), "utf8"));
const fixture = () => ({ data: read("data"), meta: read("meta") });

test("IVA preserves official dimensions, editions, periods and totals", () => {
  const { data, meta } = fixture();
  const result = validateMefIvaBundle(data, meta);
  assert.equal(result.data.tables.length, 4);
  assert.equal(result.metadata.coverage.rows, 93);
  assert.deepEqual(result.data.tables.map((table) => table.rows.length), [23, 23, 23, 24]);
  for (const table of result.data.tables) {
    assert.equal(table.declarationYear - table.taxYear, 1);
    assert.equal(new Set(table.rows.map((row) => row.id)).size, table.rows.length);
    assert.equal(table.rows.filter((row) => row.kind === "total").length, 1);
  }
  const region = queryMefIva({ year: 2025, breakdown: "regione" });
  const autonomous = region.rows.filter((row) => row.sourceCode === "04");
  assert.equal(autonomous.length, 2);
  assert.notEqual(autonomous[0].id, autonomous[1].id);
  const earlier = queryMefIva({ year: 2024, breakdown: "attivita" });
  const later = queryMefIva({ year: 2025, breakdown: "attivita" });
  assert.notEqual(earlier.table.classificationEdition, later.table.classificationEdition);
  assert.notEqual(earlier.rows.find((row) => row.sourceCode === "10").label, later.rows.find((row) => row.sourceCode === "10").label);
});

test("observed zero, missing and suppressed cells remain three distinct states", () => {
  for (const cell of [{ value: 0, status: "observed" }, { value: null, status: "missing" }, { value: null, status: "suppressed" }]) {
    assert.deepEqual(mefIvaCellSchema.parse(cell), cell);
  }
  for (const cell of [{ value: null, status: "observed" }, { value: 0, status: "missing" }, { value: 0, status: "suppressed" }, { value: 1.5, status: "observed" }]) {
    assert.throws(() => mefIvaCellSchema.parse(cell));
  }
  const cells = mefIvaData.tables.flatMap((table) => table.rows.flatMap((row) => [row.taxpayers, ...row.values.flatMap((value) => [value.frequency, value.amountCents, value.meanCents])]));
  assert.ok(cells.some((cell) => cell.status === "suppressed"));
  assert.ok(cells.some((cell) => cell.status === "observed" && cell.value === 0));
  assert.ok(cells.every((cell) => cell.status === "observed" || cell.value === null));
});

test("IVA contract rejects tampering even when the attacker rewrites the metadata digest", () => {
  const mutations = [
    (data) => { data.tables[0].rows[0].values[0].amountCents.value += 100000; },
    (data) => { data.tables[0].rows[1] = structuredClone(data.tables[0].rows[0]); },
    (data) => { data.tables[0].measures[0].amountUnit = "euros"; },
    (data) => { data.tables[0].rows[0].label = "Another territory"; },
    (data) => { data.tables[0].taxYear = 2024; },
    (data) => { data.tables[0].publicationDate = "2025-02-30"; },
    (data) => { data.tables[0].sourceUrl = "https://www1.finanze.gov.it.evil.example/file"; },
    (data) => { data.tables[0].rows[0].values[0].amountCents.value = Number.MAX_SAFE_INTEGER + 1; },
    (data) => { data.tables[0].rows[0].extra = "unexpected"; },
    (data) => { data.caveats = ["invented semantics"]; },
    (data) => {
      const cell = data.tables.flatMap((table) => table.rows.flatMap((row) => row.values.flatMap((value) => [value.frequency, value.amountCents, value.meanCents]))).find((cell) => cell.status === "suppressed");
      cell.status = "missing";
    },
  ];
  for (const mutate of mutations) {
    const { data, meta } = fixture();
    mutate(data);
    const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`);
    meta.integrity.dataSha256 = createHash("sha256").update(bytes).digest("hex");
    meta.integrity.dataBytes = bytes.length;
    assert.throws(() => validateMefIvaBundle(data, meta));
  }
});

test("IVA contract rejects metadata provenance, date, license, byte and source hash drift", () => {
  for (const mutate of [
    (meta) => { meta.source.licenseId = "CC0"; },
    (meta) => { meta.source.files["2024CIVATOT020201"].csv.sha256 = "0".repeat(64); },
    (meta) => { meta.source.files["2024CIVATOT020201"].csv.bytes += 1; },
    (meta) => { meta.integrity.sourceLockSha256 = "0".repeat(64); },
    (meta) => { meta.integrity.dataSha256 = "0".repeat(64); },
    (meta) => { meta.integrity.dataBytes += 1; },
    (meta) => { meta.observedAt = "2026-09-10"; },
    (meta) => { meta.semantics.provenance.publicationDates["2024CIVATOT020201"] = "2025-04-17"; },
    (meta) => { meta.source.checkedAt = "2026-09-10"; },
    (meta) => { meta.coverage.rows -= 1; },
  ]) {
    const { data, meta } = fixture();
    mutate(meta);
    assert.throws(() => validateMefIvaBundle(data, meta));
  }
});

test("IVA pagination covers each row once while requiring a single year and breakdown", () => {
  const base = { year: 2025, breakdown: "attivita" };
  const complete = queryMefIva(base);
  const rows = [];
  let offset = 0;
  do {
    const result = queryMefIva({ ...base, offset, limit: 5 });
    rows.push(...result.rows);
    offset = result.pagination.nextOffset;
  } while (offset !== null);
  assert.deepEqual(rows, complete.rows);
  for (const query of [{}, { year: 2025 }, { breakdown: "regione" }, { year: 2023, breakdown: "regione" },
    { ...base, breakdown: "REGIONE" }, { ...base, limit: 101 }, { ...base, limit: NaN },
    { ...base, offset: -1 }, { ...base, offset: 100001 }, { ...base, offset: 0.5 }]) {
    assert.throws(() => queryMefIva(query));
  }
});

test("IVA MCP matches the loader and rejects unsupported or ambiguous requests", async () => {
  const example = datasetCatalog.find((dataset) => dataset.id === "mef_iva");
  assert.ok(example);
  assert.ok(example.filters.includes("year") && example.filters.includes("breakdown"));
  for (const year of [2024, 2025]) for (const breakdown of ["regione", "attivita"]) {
    const query = { year, breakdown, limit: 3, offset: 2 };
    assert.deepEqual(await queryPublicDataset({ dataset: "mef_iva", ...query }), {
      dataset: "mef_iva", ...queryMefIva(query),
    });
  }
  for (const query of [{}, { year: 2025 }, { year: 2025, breakdown: "regione", region: "Lazio" },
    { year: 2025, breakdown: "regione", limit: 101 }, { year: 2025, breakdown: "regione", offset: 100001 }]) {
    await assert.rejects(queryPublicDataset({ dataset: "mef_iva", ...query }));
  }
});
