import assert from "node:assert/strict";
import { successfulMcpToolResult } from "./mcp_test_helpers.mjs";

const baseUrl = new URL(process.env.DVNS_BASE_URL ?? "http://127.0.0.1:3000");
const tables = [];
let posts = 0;
async function queryMcp(arguments_) {
  const response = await fetch(new URL("/api/mcp", baseUrl), {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: `iva-${++posts}`, method: "tools/call", params: { name: "query_dataset", arguments: arguments_ } }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text.slice(0, 500));
  assert.ok(Buffer.byteLength(text) < 750_000, "Risposta IVA MCP non limitata");
  return text;
}

for (const year of [2024, 2025]) for (const breakdown of ["regione", "attivita"]) {
  const response = await fetch(new URL(`/api/tributi/iva?anno=${year}&taglio=${breakdown}&limit=100`, baseUrl), { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200);
  const api = await response.json();
  assert.equal(api.datasetId, "mef-iva");
  assert.equal(api.table.declarationYear, year);
  assert.equal(api.table.taxYear, year - 1);
  assert.equal(api.table.breakdown, breakdown);
  assert.equal(api.rows.length, breakdown === "attivita" && year === 2025 ? 24 : 23);
  assert.equal(api.pagination.nextOffset, null);
  assert.equal(api.rows.filter((row) => row.kind === "total").length, 1);
  assert.ok(api.table.measures.every((measure) => measure.sourceUnit === "thousand-euros" && measure.amountUnit === "euro-cents"));
  if (breakdown === "regione") {
    const provinces = api.rows.filter((row) => row.sourceCode === "04");
    assert.equal(provinces.length, 2, "Trento e Bolzano conservano il codice sorgente condiviso");
    assert.equal(new Set(provinces.map((row) => row.id)).size, 2, "Gli identificativi delle due PA restano distinti");
  }
  const mcp = successfulMcpToolResult(await queryMcp({ dataset: "mef_iva", year, breakdown, limit: 100 }), "mef_iva").data;
  assert.deepEqual(mcp.rows, api.rows, "API e MCP devono esporre gli stessi dati IVA");
  assert.deepEqual(mcp.table, api.table);
  assert.deepEqual(mcp.source, api.source);
  tables.push(api);
}

const activity = tables.filter((table) => table.table.breakdown === "attivita").map((table) => table.rows.find((row) => row.sourceCode === "11"));
assert.notEqual(activity[0].id, activity[1].id, "I codici attività sono identificati per edizione");
assert.notEqual(activity[0].label, activity[1].label, "Il significato del codice 11 cambia tra le edizioni");

const page = await fetch(new URL("/api/tributi/iva?anno=2024&taglio=regione&limit=5&offset=21", baseUrl));
assert.equal(page.status, 200);
const paginated = await page.json();
assert.deepEqual(paginated.rows, tables[0].rows.slice(21));
assert.equal(paginated.pagination.nextOffset, null);
for (const query of ["", "anno=2023&taglio=regione", "anno=2024&taglio=regione&regione=04", "anno=2024&anno=2025&taglio=regione", "anno=2024&taglio=regione&limit=101"]) {
  const response = await fetch(new URL(`/api/tributi/iva?${query}`, baseUrl), { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 400, query);
  assert.equal(response.headers.get("cache-control"), "no-store");
}
assert.match(await queryMcp({ dataset: "mef_iva", year: 2024, breakdown: "regione", region: "Lazio" }), /"isError":true/);
assert.equal(posts, 5, "Mantenere esplicito il budget POST IVA nel runner di produzione");
console.log("PASS IVA HTTP: quattro tabelle, API/MCP concordi, PA distinte, codici di edizione, paginazione e richieste non valide");
