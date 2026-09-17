import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/spese/invalidita/route.ts");

test("INPS API filters a supported year and region", async () => {
  const response = GET(
    new NextRequest("http://localhost/api/spese/invalidita?anno=2023&regione=Calabria"),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /stale-while-revalidate/);
  const payload = await response.json();
  assert.deepEqual(payload.regionalNewPensions.regions, [
    { region: "Calabria", values: [8789] },
  ]);
});

test("INPS API rejects malformed years and unsupported territorial combinations", async () => {
  const malformed = GET(
    new NextRequest("http://localhost/api/spese/invalidita?anno=2023x"),
  );
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /deve essere un intero/);

  const unavailable = GET(
    new NextRequest("http://localhost/api/spese/invalidita?anno=2025&regione=Calabria"),
  );
  assert.equal(unavailable.status, 400);
  assert.match((await unavailable.json()).error, /dettaglio regionale INPS non è disponibile/);
});
