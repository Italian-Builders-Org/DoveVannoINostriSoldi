import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const {
  istatPermessiCostruireData: data,
  istatPermessiCostruireMetadata: metadata,
  queryIstatPermessiCostruire: query,
} = await import("../src/lib/istat-permessi-costruire-snapshot.ts");
const { validateIstatPermessiCostruireBundle: validate } =
  await import("../src/lib/data/istat-permessi-costruire-contract.ts");
const { GET } = await import("../src/app/api/edilizia/permessi-costruire/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") => GET(new NextRequest(`http://localhost/api/edilizia/permessi-costruire${params}`));

test("ISTAT permessi preserve eleven years, four tables and 2025 pins", () => {
  assert.equal(data.period.from, 2015);
  assert.equal(data.period.to, 2025);
  assert.equal(data.soldi.present, false);
  assert.equal(data.tables.a1.years.length, 11);
  assert.equal(data.tables.a2.years.length, 11);
  assert.equal(data.tables.a3.years.length, 11);
  assert.equal(data.tables.a4.years.length, 11);
  const a1_2025 = data.tables.a1.years.find((row) => row.year === 2025);
  assert.equal(a1_2025.fabbricati.numero.value, 16070);
  assert.equal(a1_2025.abitazioni.numero.value, 51908);
  assert.equal(metadata.source.licenseId, "not-declared");
  assert.equal(metadata.source.publicationDate, "2026-06-17");
  assert.equal(metadata.source.bytes, 968604);
  assert.match(data.caveats.join(" "), /non confondere con le opere pubbliche/i);
});

test("HTTP and MCP agree on year and table filters", async () => {
  const filtered = query({ year: 2025, table: "a1" });
  assert.equal(Object.keys(filtered.tables).length, 1);
  assert.equal(filtered.tables.a1.years.length, 1);
  assert.equal(filtered.tables.a1.years[0].year, 2025);

  const response = await get("?anno=2025&tavola=a1");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), filtered);

  const mcp = await queryPublicDataset({
    dataset: "istat_permessi_costruire",
    year: 2025,
    table: "a1",
  });
  assert.equal(mcp.dataset, "istat_permessi_costruire");
  assert.deepEqual(mcp.tables, filtered.tables);
  assert.ok(datasetCatalog.some((entry) => entry.id === "istat_permessi_costruire"));
});

test("runtime rejects unknown years, tables and unsupported params", async () => {
  assert.throws(() => query({ year: 2014 }), /2015 e 2025/);
  assert.throws(() => query({ table: "a5" }), /Tavola non canonica/);
  const badYear = await get("?anno=2014");
  assert.equal(badYear.status, 400);
  const badTable = await get("?tavola=a5");
  assert.equal(badTable.status, 400);
  await assert.rejects(
    queryPublicDataset({ dataset: "istat_permessi_costruire", territory: "IT" }),
    /Filtri non supportati|non supportat/i,
  );
});

test("contract validation rejects cell or provenance tampering", () => {
  validate(data, metadata);
  const broken = structuredClone(data);
  broken.tables.a1.years.find((row) => row.year === 2025).fabbricati.numero.value += 1;
  assert.throws(() => validate(broken, metadata));
  const metaBroken = structuredClone(metadata);
  metaBroken.semantics.provenance.publicationDate = "2025-01-01";
  assert.throws(() => validate(data, metaBroken), /fonte|provenance|incoerente/i);
});
