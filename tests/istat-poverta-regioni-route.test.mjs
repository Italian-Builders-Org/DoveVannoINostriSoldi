import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";
const { GET } = await import("../src/app/api/territori/poverta-regioni/route.ts");
const { queryIstatPovertaRegioni } = await import("../src/lib/istat-poverta-regioni-snapshot.ts");
const base = "http://localhost/api/territori/poverta-regioni";

test("l'API rifiuta richieste ambigue, illimitate o fuori dizionario senza mettere in cache l'errore", () => {
  const query = [
    "",                                  // nessun filtro: la risposta sarebbe l'intera serie
    "territorio=",
    "territorio=%20",
    "territorio=ITZ9",                   // territorio inesistente
    "misura=poveri",                     // misura fuori dizionario
    "territorio=ITC4&anno=2013",         // prima del periodo coperto
    "territorio=ITC4&anno=2025",         // dopo il periodo coperto
    "territorio=ITC4&anno=24",
    "territorio=ITC4&foo=1",
    "territorio=ITC4&territorio=ITC4",
    "territorio=ITC4&limit=0",
    "territorio=ITC4&limit=101",
    "territorio=ITC4&offset=100001",
    "territorio=ITC4&offset=-1",
  ];
  for (const search of query) {
    const response = GET(new NextRequest(`${base}?${search}`));
    assert.equal(response.status, 400, search);
    assert.equal(response.headers.get("cache-control"), "no-store", search);
  }
});

test("API e MCP condividono selezione, paginazione e provenienza", async () => {
  const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
  const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
  const { datasetQuerySchema } = await import("../src/lib/mcp/query-schema.ts");
  const descriptor = datasetCatalog.find((item) => item.id === "istat_poverta_regioni");
  assert.ok(descriptor, "il dataset deve essere nel catalogo MCP");
  assert.equal(datasetQuerySchema.parse(descriptor.exampleQuery).dataset, descriptor.id);

  const response = GET(new NextRequest(`${base}?territorio=ITC4&misura=households&limit=5`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /public/);
  const body = await response.json();
  assert.deepEqual(body, queryIstatPovertaRegioni({ territory: "ITC4", measure: "households", limit: 5 }));
  // La risposta MCP è la stessa più l'eco del dataset richiesto: il resto deve coincidere riga per riga.
  const { dataset, ...selezioneMcp } = await queryPublicDataset({
    dataset: "istat_poverta_regioni", territory: "ITC4", measure: "households", limit: 5,
  });
  assert.equal(dataset, "istat_poverta_regioni");
  assert.deepEqual(body, selezioneMcp);

  // La Lombardia ha il valore familiare in tutti e undici gli anni.
  assert.equal(body.pagination.total, 11);
  assert.equal(body.pagination.returned, 5);
  assert.equal(body.pagination.hasMore, true);
  // La pagina da cinque righe copre i primi cinque anni della serie, in ordine.
  assert.deepEqual(body.observations.map((row) => row.year), [2014, 2015, 2016, 2017, 2018]);
  const ultima = await (await GET(new NextRequest(`${base}?territorio=ITC4&misura=households&anno=2024`))).json();
  assert.equal(ultima.observations.length, 1);
  assert.equal(ultima.observations[0].valueHundredths, 670);
  assert.equal(body.scale.factor, 100);
  assert.equal(body.source.licenseId, "not-declared");
  assert.equal(body.semantics.soldi.present, false);
});

test("la selezione porta con sé ciò che la fonte non pubblica, invece di tacerlo", async () => {
  // Bolzano non ha alcun valore familiare: la risposta deve dirlo, non restituire una lista vuota muta.
  const response = GET(new NextRequest(`${base}?territorio=ITD1&misura=households`));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pagination.total, 0);
  assert.equal(body.undiffused.length, 10);
  assert.ok(body.undiffused.every((row) => row.flag === "0"));
  assert.deepEqual(body.missingRows, [{ territory: "ITD1", measure: "households", year: 2016 }]);
  // I dieci anni non diffusi più l'anno assente coprono l'intera serie: nessun buco silenzioso.
  assert.equal(body.undiffused.length + body.missingRows.length, 11);

  // Sugli individui lo stesso territorio ha invece valori, e l'assenza resta su tre anni.
  const individui = await (await GET(new NextRequest(`${base}?territorio=ITD1&misura=individuals`))).json();
  assert.equal(individui.pagination.total, 7);
  assert.equal(individui.undiffused.length, 3);
  assert.equal(individui.missingRows.length, 1);
  assert.equal(individui.pagination.total + individui.undiffused.length + individui.missingRows.length, 11);
});

test("i caveat serviti vengono dal payload e dichiarano i limiti d'uso", async () => {
  const body = await (await GET(new NextRequest(`${base}?territorio=IT&anno=2024`))).json();
  assert.deepEqual(body.caveats, queryIstatPovertaRegioni({ territory: "IT", year: 2024 }).caveats);
  assert.ok(body.caveats.some((voce) => /non è pubblicata per regione/.test(voce)));
  assert.ok(body.caveats.some((voce) => /Sommare le regioni non ricostruisce l'Italia/.test(voce)));
  assert.ok(body.caveats.some((voce) => /mai imputate a zero|nessuna imputazione a zero/.test(voce)));
  assert.deepEqual(body.ratioBounds, { pairs: 310, min: 9030, max: 19189 });
});
