import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const {
  inpsCigFondiSolidarietaData: data,
  inpsCigFondiSolidarietaMetadata: metadata,
  queryInpsCigFondiSolidarieta: query,
} = await import("../src/lib/inps-cig-fondi-solidarieta-snapshot.ts");
const { validateInpsCigFondiSolidarietaBundle: validate } = await import(
  "../src/lib/data/inps-cig-fondi-solidarieta-contract.ts"
);
const { GET } = await import("../src/app/api/lavoro/cig-fondi-solidarieta/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") =>
  GET(new NextRequest(`http://localhost/api/lavoro/cig-fondi-solidarieta${params}`));

test("CIG fondi solidarietà keep hours distinct and money absent", () => {
  assert.equal(data.coverage.observedRows, 628);
  assert.equal(data.units.money, "nessuna — il dataset non contiene importi");
  assert.equal(data.units.hours, "ore");
  assert.equal(metadata.source.licenseId, "CC-BY");
  assert.match(data.caveats.join(" "), /NON euro/i);
  assert.match(data.caveats.join(" "), /ore autorizzate/i);
  assert.equal(new Set(data.observations.map((row) => row.fundManagement)).size, 2);
  assert.equal(new Set(data.observations.map((row) => row.sector)).size, 4);
});

test("HTTP and MCP agree on year, region, period, fund and sector filters", async () => {
  const filtered = query({
    year: 2023,
    region: "Lombardia",
    month: "Gennaio",
    fundManagement: "FIS",
    sector: "Industria",
  });
  assert.ok(filtered.observations.length > 0);
  assert.ok(
    filtered.observations.every(
      (row) =>
        row.year === 2023 &&
        row.region === "Lombardia" &&
        row.month === "Gennaio" &&
        row.fundManagement === "FIS" &&
        row.sector === "Industria",
    ),
  );

  const response = await get(
    "?anno=2023&regione=Lombardia&mese=Gennaio&gestione=FIS&ramo=Industria",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), filtered);

  const mcp = await queryPublicDataset({
    dataset: "inps_cig_fondi_solidarieta",
    year: 2023,
    region: "Lombardia",
    period: "Gennaio",
    code: "FIS",
    sector: "Industria",
  });
  assert.equal(mcp.dataset, "inps_cig_fondi_solidarieta");
  assert.deepEqual(mcp.observations, filtered.observations);
  assert.ok(datasetCatalog.some((entry) => entry.id === "inps_cig_fondi_solidarieta"));
});

test("runtime rejects unknown years and parameters", async () => {
  assert.throws(() => query({ year: 2022 }), /2023-2024/);
  assert.throws(() => query({ fundManagement: "CIGO" }), /Gestione fondi/);
  const bad = await get("?anno=2022");
  assert.equal(bad.status, 400);
  const repeated = await get("?anno=2023&anno=2024");
  assert.equal(repeated.status, 400);
});

test("contract validation rejects provenance tampering", () => {
  validate(data, metadata);
  const broken = structuredClone(data);
  broken.coverage = { ...broken.coverage, observedRows: 627 };
  assert.throws(() => validate(broken, metadata), /observedRows|Expected|Invalid|Literal/i);

  for (const mutate of [
    (copy) => {
      copy.source.landingUrl = "https://opendata.inps.it.example.org/opendata";
    },
    (copy) => {
      copy.source.assets.hours.sha256 = "0".repeat(64);
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
