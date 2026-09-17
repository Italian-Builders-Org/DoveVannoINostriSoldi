import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { getMunicipalitySchoolServices } = await import("../src/lib/municipality-school-services.ts");
const { selectIntegratedDataset } = await import("../src/lib/integrated-public-view.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { GET } = await import("../src/app/api/dati/[dataset]/route.ts");

const datasetId = "mim-scuole-statali-comuni";
function identity(code, cadastralCode, regionCode) {
  return { level: "municipality", code, cadastralCode, regionCode };
}

test("MIM school codes reconcile to the same municipal count through profile, API and MCP", async () => {
  for (const [code, cadastral, region, sites, other] of [
    ["062008", "A783", "15", 49, 23], ["058091", "H501", "12", 944, 327],
  ]) {
    const services = await getMunicipalitySchoolServices(identity(code, cadastral, region));
    assert.equal(services.status, "available");
    assert.equal(services.data.schoolSites, sites);
    assert.equal(services.data.otherRegistryCodes, other);
    const selected = await selectIntegratedDataset({ datasetId, q: code, limit: 5 });
    assert.equal(selected.rows.length, 1);
    assert.equal(selected.rows[0].id, services.data.rowId);
    assert.equal(selected.rows[0].cells["Sedi scolastiche statali"], String(sites));
    assert.equal(selected.dataset.publicRows, 6648);
    assert.equal(selected.dataset.licenseStatus, "verified-open-iodl-2.0");
    assert.equal(selected.dataset.sourceMetadata.publicationDate, null);
    assert.match(selected.dataset.caveats.join(" "), /CC BY 3.0/);
    const response = await GET(new Request(`http://localhost/api/dati/${datasetId}?q=${code}&limit=5`), {
      params: Promise.resolve({ dataset: datasetId }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).rows, selected.rows);
    const mcp = await queryPublicDataset({ dataset: "spesa_pa_dettaglio", code: datasetId, query: code, limit: 5 });
    assert.deepEqual(mcp.rows, selected.rows);
    assert.deepEqual(mcp.dataset.sourceMetadata, selected.dataset.sourceMetadata);
  }
});

test("observed zero, no record and excluded territories remain distinct", async () => {
  const zero = await getMunicipalitySchoolServices(identity("076019", "B743", "17"));
  assert.equal(zero.status, "available");
  assert.equal(zero.data.schoolSites, 0);
  assert.ok(zero.data.otherRegistryCodes > 0);
  const missing = await getMunicipalitySchoolServices(identity("001019", "A599", "01"));
  assert.equal(missing.status, "not_found");
  assert.match(missing.message, /Non significa.*non esistano scuole/);
  assert.equal("data" in missing, false);
  for (const town of [identity("007003", "A326", "02"), identity("022205", "L378", "04")]) {
    const excluded = await getMunicipalitySchoolServices(town);
    assert.equal(excluded.status, "out_of_scope");
    assert.equal("data" in excluded, false);
  }
});

test("unreconciled and mismatched identifiers cannot silently select another municipality", async () => {
  for (const town of [null, identity("62008", "A783", "15"), identity("062008", "H501", "15")]) {
    assert.equal((await getMunicipalitySchoolServices(town)).status, "not_found");
  }
});
