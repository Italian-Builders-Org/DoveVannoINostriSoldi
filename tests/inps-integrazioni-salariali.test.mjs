import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const {
  inpsIntegrazioniSalarialiData: data,
  inpsIntegrazioniSalarialiMetadata: metadata,
  queryInpsIntegrazioniSalariali: query,
} = await import("../src/lib/inps-integrazioni-salariali-snapshot.ts");
const { validateInpsIntegrazioniSalarialiBundle: validate } = await import(
  "../src/lib/data/inps-integrazioni-salariali-contract.ts"
);
const { GET } = await import("../src/app/api/lavoro/integrazioni-salariali/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const get = (params = "") =>
  GET(new NextRequest(`http://localhost/api/lavoro/integrazioni-salariali${params}`));

test("integrazioni salariali keep counts distinct and money absent", () => {
  assert.equal(data.coverage.observedRows, 2339);
  assert.equal(data.units.money, "nessuna — il dataset non contiene importi");
  assert.equal(metadata.source.licenseId, "CC-BY");
  assert.match(data.caveats.join(" "), /NON euro/i);
  assert.match(data.caveats.join(" "), /lavoratori.*domande.*mensilit/i);
  assert.equal(data.observations.filter((row) => row.table === "lavoratori").length, 790);
  assert.equal(data.observations.filter((row) => row.table === "domande").length, 759);
  assert.equal(data.observations.filter((row) => row.table === "mensilita").length, 790);
});

test("HTTP and MCP agree on table, region, period and intervention filters", async () => {
  const filtered = query({
    year: 2023,
    table: "lavoratori",
    region: "LOMBARDIA",
    month: "Gennaio",
    interventionType: "CIGO",
  });
  assert.ok(filtered.observations.length > 0);
  assert.ok(
    filtered.observations.every(
      (row) =>
        row.year === 2023 &&
        row.table === "lavoratori" &&
        row.region === "LOMBARDIA" &&
        row.month === "Gennaio" &&
        row.interventionType === "CIGO",
    ),
  );

  const response = await get(
    "?anno=2023&tabella=lavoratori&regione=LOMBARDIA&mese=Gennaio&tipo=CIGO",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), filtered);

  const mcp = await queryPublicDataset({
    dataset: "inps_integrazioni_salariali",
    year: 2023,
    table: "lavoratori",
    region: "LOMBARDIA",
    period: "Gennaio",
    code: "CIGO",
  });
  assert.equal(mcp.dataset, "inps_integrazioni_salariali");
  assert.deepEqual(mcp.observations, filtered.observations);
  assert.ok(datasetCatalog.some((entry) => entry.id === "inps_integrazioni_salariali"));
});

test("runtime rejects unknown years and tables", async () => {
  assert.throws(() => query({ year: 2022 }), /2023/);
  assert.throws(() => query({ table: "ore" }), /lavoratori, domande oppure mensilita/);
  const bad = await get("?anno=2022");
  assert.equal(bad.status, 400);
  const repeated = await get("?anno=2023&anno=2022");
  assert.equal(repeated.status, 400);
});

test("contract validation rejects provenance tampering", () => {
  validate(data, metadata);
  const broken = structuredClone(data);
  broken.coverage = { ...broken.coverage, observedRows: 2338 };
  assert.throws(() => validate(broken, metadata), /observedRows|Expected|Invalid|Literal/i);

  for (const mutate of [
    (copy) => {
      copy.source.landingUrl = "https://opendata.inps.it.example.org/opendata";
    },
    (copy) => {
      copy.source.assets.lavoratori.sha256 = "0".repeat(64);
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
