import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/tributi/iva/route.ts");
const url = "http://localhost/api/tributi/iva";

test("IVA HTTP returns one declared-year table and its provenance", async () => {
  for (const anno of [2024, 2025]) for (const taglio of ["regione", "attivita"]) {
    const response = GET(new NextRequest(`${url}?anno=${anno}&taglio=${taglio}&limit=2&offset=1`));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /max-age=3600/);
    const result = await response.json();
    assert.equal(result.datasetId, "mef-iva");
    assert.equal(result.table.declarationYear, anno);
    assert.equal(result.table.taxYear, anno - 1);
    assert.equal(result.table.breakdown, taglio);
    assert.equal(result.rows.length, 2);
    assert.equal(result.pagination.nextOffset, 3);
    assert.match(result.source.files[result.table.id].csv.sha256, /^[a-f0-9]{64}$/);
    assert.ok(result.caveats.length);
  }
});

test("IVA HTTP rejects missing, repeated, unknown and noncanonical filters uncached", () => {
  for (const query of ["", "anno=2025", "taglio=regione", "anno=2023&taglio=regione",
    "anno=2025&taglio=provincia", "anno=02025&taglio=regione", "anno=2025x&taglio=regione",
    ...["foo=x", "anno=2024", "taglio=attivita", "limit=0", "limit=101", "limit=01",
      "offset=-1", "offset=100001", "offset=1.5", "limit=Infinity", "region=Lazio", "limit="].map((extra) => `anno=2025&taglio=regione&${extra}`)]) {
    const response = GET(new NextRequest(`${url}?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store", query);
  }
});

test("IVA HTTP out-of-range page returns an empty bounded page, never national zero", async () => {
  const response = GET(new NextRequest(`${url}?anno=2025&taglio=attivita&offset=100000&limit=100`));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.rows, []);
  assert.equal(result.pagination.nextOffset, null);
  assert.ok(result.pagination.totalRows > 0);
});
