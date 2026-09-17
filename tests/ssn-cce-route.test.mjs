import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/spese/sanita/route.ts");

test("SSN API serves bounded aggregate and entity data", async () => {
  const response = GET(
    new NextRequest("http://localhost/api/spese/sanita?anno=2024&regione=Calabria&limit=2"),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /stale-while-revalidate/);
  const payload = await response.json();
  assert.equal(payload.referenceYear, 2024);
  assert.equal(payload.pagination.total, 11);
  assert.equal(payload.entities.length, 2);
  assert.equal(payload.regions[0].code, "180");
  assert.equal(payload.selectedAggregate.level, "region");
  assert.equal(payload.selectedAggregate.code, "180");
});

test("SSN API keeps the largest paginated response below the public budget", async () => {
  const response = GET(
    new NextRequest("http://localhost/api/spese/sanita?anno=2024&limit=100&offset=100"),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.entities.length, 100);
  assert.ok(Buffer.byteLength(JSON.stringify(payload), "utf8") < 750 * 1024);
});

test("SSN metric API keeps metric values separate from the base response", async () => {
  const response = GET(
    new NextRequest("http://localhost/api/spese/sanita?metrica=healthcareWorkServices&limit=1"),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.metric, "healthcareWorkServices");
  assert.equal(payload.values.length, 1);
  assert.equal(payload.values[0].amountCents >= 0, true);
  assert.equal(payload.selectedAggregate.level, "national");
});

test("SSN API makes an entity code filter explicit even with a region context", async () => {
  const response = GET(
    new NextRequest("http://localhost/api/spese/sanita?anno=2024&regione=Calabria&code=000&limit=1"),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.selectedAggregate.level, "entity_match");
  assert.equal(payload.selectedAggregate.values, null);
  assert.equal(payload.selectedAggregate.contextRegion.code, "180");
  assert.equal(payload.pagination.returned, 1);
  assert.ok(JSON.stringify(payload).length < 750 * 1024);
});

test("SSN API rejects unknown parameters, unsupported years and invalid metrics", async () => {
  const unknown = GET(new NextRequest("http://localhost/api/spese/sanita?foo=bar"));
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /Parametro non supportato/);

  const year = GET(new NextRequest("http://localhost/api/spese/sanita?anno=2023"));
  assert.equal(year.status, 404);
  assert.match((await year.json()).error, /disponibile solo/);

  const metric = GET(new NextRequest("http://localhost/api/spese/sanita?metrica=gettonisti"));
  assert.equal(metric.status, 400);
  assert.match((await metric.json()).error, /Metrica SSN non supportata/);

  const limit = GET(new NextRequest("http://localhost/api/spese/sanita?limit=101"));
  assert.equal(limit.status, 400);

  for (const repeated of [
    "anno=2024&anno=2023",
    "regione=Calabria&regione=Lazio",
    "code=000&code=001",
    "metrica=personnelCost&metrica=productionCosts",
    "limit=1&limit=2",
    "offset=0&offset=1",
  ]) {
    const duplicate = GET(new NextRequest(`http://localhost/api/spese/sanita?${repeated}`));
    assert.equal(duplicate.status, 400);
    assert.match((await duplicate.json()).error, /non può essere ripetuto/);
  }
});
