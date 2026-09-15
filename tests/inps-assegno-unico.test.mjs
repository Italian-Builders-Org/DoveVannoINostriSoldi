import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const {
  inpsAssegnoUnicoData: data,
  inpsAssegnoUnicoMetadata: metadata,
  queryInpsAssegnoUnico: query,
} = await import("../src/lib/inps-assegno-unico-snapshot.ts");
const { validateInpsAssegnoUnicoBundle: validate } = await import(
  "../src/lib/data/inps-assegno-unico-contract.ts"
);
const { GET } = await import("../src/app/api/famiglia/assegno-unico/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") =>
  GET(new NextRequest(`http://localhost/api/famiglia/assegno-unico${params}`));

test("Assegno Unico preserves millesimi, RdC perimeter and table split", () => {
  assert.equal(data.coverage.observedRows, 4452);
  assert.equal(data.units.money, "euro-millesimi");
  assert.equal(data.coverage.perimeter, "AUU a domanda — esclusi beneficiari RdC");
  assert.equal(metadata.source.licenseId, "CC-BY");
  assert.match(data.caveats.join(" "), /esclusi beneficiari RdC/i);
  assert.match(data.caveats.join(" "), /millesimi/i);
  const nuclei = data.observations.filter((row) => row.table === "nuclei");
  const figli = data.observations.filter((row) => row.table === "figli_disabilita");
  assert.equal(nuclei.length, 636);
  assert.equal(figli.length, 3816);
  assert.ok(nuclei.every((row) => row.childrenCountNote === "unita-non-documentata-dalla-fonte"));
});

test("HTTP and MCP agree on year, table and province filters", async () => {
  const filtered = query({ year: 2023, table: "nuclei", province: "Milano" });
  assert.ok(filtered.observations.length > 0);
  assert.ok(filtered.observations.every((row) => row.year === 2023 && row.province === "Milano"));

  const response = await get("?anno=2023&tabella=nuclei&provincia=Milano");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), filtered);

  const mcp = await queryPublicDataset({
    dataset: "inps_assegno_unico",
    year: 2023,
    table: "nuclei",
    province: "Milano",
  });
  assert.equal(mcp.dataset, "inps_assegno_unico");
  assert.deepEqual(mcp.observations, filtered.observations);
  assert.ok(datasetCatalog.some((entry) => entry.id === "inps_assegno_unico"));
});

test("runtime rejects unknown years and tables", async () => {
  assert.throws(() => query({ year: 2021 }), /2022-2024/);
  assert.throws(() => query({ table: "rdc" }), /nuclei oppure figli_disabilita/);
  const bad = await get("?anno=2021");
  assert.equal(bad.status, 400);
  const repeated = await get("?anno=2023&anno=2022");
  assert.equal(repeated.status, 400);
});

test("contract validation rejects money or provenance tampering", () => {
  validate(data, metadata);
  const broken = structuredClone(data);
  broken.observations[0].amountMilli += 1;
  // uniqueness still holds; force coverage mismatch instead
  broken.coverage = { ...broken.coverage, observedRows: 4451 };
  assert.throws(() => validate(broken, metadata), /observedRows|Expected|Invalid|Literal/i);

  for (const mutate of [
    (copy) => {
      copy.source.landingUrl = "https://opendata.inps.it.example.org/opendata";
    },
    (copy) => {
      copy.source.assets.nuclei.sha256 = "0".repeat(64);
    },
    (copy) => {
      copy.integrity.dataArtifact.sha256 = "0".repeat(64);
    },
  ]) {
    const copy = structuredClone(metadata);
    mutate(copy);
    assert.throws(() => validate(data, copy), /fonte|hash|landing|incoerente|ufficiale/i);
  }
});
