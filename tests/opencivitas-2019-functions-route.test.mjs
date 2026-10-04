import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";
const { OPENCIVITAS_2019_FUNCTIONS } = await import("../src/lib/data/opencivitas-2019-functions.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const { datasetQuerySchema } = await import("../src/lib/mcp/query-schema.ts");

const ROUTES = {
  istruzione: await import("../src/app/api/spese/opencivitas-2019-istruzione/route.ts"),
  polizia: await import("../src/app/api/spese/opencivitas-2019-polizia/route.ts"),
  viabilita: await import("../src/app/api/spese/opencivitas-2019-viabilita/route.ts"),
  rifiuti: await import("../src/app/api/spese/opencivitas-2019-rifiuti/route.ts"),
  "sociale-asili": await import("../src/app/api/spese/opencivitas-2019-sociale-asili/route.ts"),
  amministrazione: await import("../src/app/api/spese/opencivitas-2019-amministrazione/route.ts"),
};

// First excluded Comune per function, when any: the API must not resurrect it as zero.
const EXCLUDED_CODE = { istruzione: "065040", "sociale-asili": "101016" };

for (const [key, route] of Object.entries(ROUTES)) {
  const descriptor = OPENCIVITAS_2019_FUNCTIONS[key];
  const base = `http://localhost${descriptor.apiPath}`;

  test(`${descriptor.family} HTTP rejects ambiguous, unbounded or cross-year requests without caching errors`, () => {
    for (const query of ["", "regione=", "regione=%20", "codice=1", "regione=Sicilia", "regione=Lazio&anno=2021", "regione=Lazio&foo=1", "regione=Lazio&regione=Lazio", "codice=058091&codice=058091", "regione=Lazio&limit=01", "regione=Lazio&limit=101", "regione=Lazio&offset=100001", "regione=Lazio&offset=-1"]) {
      const response = route.GET(new NextRequest(`${base}?${query}`));
      assert.equal(response.status, 400, query);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });

  test(`${descriptor.family} API and MCP share dataset id, pagination, provenance and region aliases`, async () => {
    const catalogEntry = datasetCatalog.find((item) => item.id === descriptor.datasetId);
    assert.ok(catalogEntry, `manca ${descriptor.datasetId} nel catalogo MCP`);
    assert.equal(catalogEntry.sources[0].period, "2019");
    assert.equal(catalogEntry.sources[0].publishedAt, "2023-05-30");
    assert.equal(datasetQuerySchema.parse(catalogEntry.exampleQuery).dataset, descriptor.datasetId);
    assert.equal((await queryPublicDataset(catalogEntry.exampleQuery)).referenceYear, 2019);

    const response = route.GET(new NextRequest(`${base}?regione=Lazio&limit=2&offset=2&anno=2019`));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /public/);
    const body = await response.json();
    assert.deepEqual(body, await queryPublicDataset({ dataset: descriptor.datasetId, year: 2019, region: "Lazio", limit: 2, offset: 2 }));
    assert.equal(body.datasetId, descriptor.datasetId);
    assert.equal(body.family, descriptor.family);
    assert.equal(body.function, descriptor.function);
    assert.equal(body.referenceYear, 2019);
    assert.equal(body.pagination.total, descriptor.source.regionCounts.LAZIO);
    assert.equal(body.pagination.returned, 2);
    assert.equal(body.provenance.sha256.data, descriptor.source.files.data.sha256);
    assert.equal(catalogEntry.sources[0].sha256, body.provenance.sha256.data);
    assert.ok(body.caveats.includes(descriptor.exclusionNote));

    await assert.rejects(queryPublicDataset({ dataset: descriptor.datasetId, year: 2021, region: "Lazio" }), /solo il 2019/);
    const rome = await (route.GET(new NextRequest(`${base}?codice=058091`))).json();
    assert.equal(rome.pagination.total, 1);
    assert.equal((await (route.GET(new NextRequest(`${base}?codice=999999`))).json()).pagination.total, 0);
    if (EXCLUDED_CODE[key]) {
      assert.equal((await (route.GET(new NextRequest(`${base}?codice=${EXCLUDED_CODE[key]}`))).json()).pagination.total, 0);
    }
  });
}
