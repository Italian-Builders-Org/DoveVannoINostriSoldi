import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { euVatGapItalyData: data, euVatGapItalyMetadata: metadata, queryEuVatGapItaly: query } =
  await import("../src/lib/eu-vat-gap-italy-snapshot.ts");
const { validateEuVatGapItalyBundle: validate } = await import("../src/lib/data/eu-vat-gap-italy-contract.ts");
const { GET } = await import("../src/app/api/tributi/vat-gap/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") => GET(new NextRequest(`http://localhost/api/tributi/vat-gap${params}`));

test("VAT gap Italy preserves six years, units and rapid-estimate 2024", () => {
  assert.equal(data.years.length, 6);
  assert.equal(data.geography.code, "IT");
  assert.equal(data.period.from, 2019);
  assert.equal(data.period.to, 2024);
  assert.equal(data.units.money, "euro-cents");
  const year2019 = data.years.find((row) => row.year === 2019);
  const year2024 = data.years.find((row) => row.year === 2024);
  assert.equal(year2019.vttlCents.value, 14_083_200_000_000);
  assert.equal(year2019.complianceGapShareMillionths.value, 193_000);
  assert.equal(year2024.estimateKind, "rapid-estimate");
  assert.ok(year2024.vttlComposition.every((row) => row.amountCents.status === "unavailable"));
  assert.equal(metadata.source.licenseId, "not-declared");
  assert.equal(metadata.source.publicationDate, "2025-12-08");
  assert.equal(metadata.source.acquiredAt, "2026-09-13");
  assert.match(data.caveats.join(" "), /non evasione accertata/i);
});

test("HTTP and MCP agree on year filter and full series", async () => {
  const full = query();
  assert.equal(full.years.length, 6);
  const filtered = query({ year: 2023 });
  assert.equal(filtered.years.length, 1);
  assert.equal(filtered.years[0].year, 2023);

  const response = await get("?anno=2023");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), filtered);

  const mcp = await queryPublicDataset({ dataset: "eu_vat_gap_italy", year: 2023 });
  assert.equal(mcp.dataset, "eu_vat_gap_italy");
  assert.deepEqual(mcp.years, filtered.years);
  assert.ok(datasetCatalog.some((entry) => entry.id === "eu_vat_gap_italy"));
});

test("runtime rejects unknown years and unsupported params", async () => {
  assert.throws(() => query({ year: 2018 }), /2019 e 2024/);
  const bad = await get("?anno=2018");
  assert.equal(bad.status, 400);
  const repeated = await get("?anno=2023&anno=2024");
  assert.equal(repeated.status, 400);
  await assert.rejects(
    queryPublicDataset({ dataset: "eu_vat_gap_italy", territory: "IT" }),
    /Filtri non supportati|non supportat/i,
  );
});

test("contract validation rejects provenance or money tampering", () => {
  validate(data, metadata);
  const broken = structuredClone(data);
  broken.years[0].complianceGapCents.value += 1;
  assert.throws(() => validate(broken, metadata));
});
