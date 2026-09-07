import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";
const { selectPnrrProjects, selectIntegratedDataset } = await import("../src/lib/integrated-public-view.ts");
const { pnrrProjectMetadata, pnrrMatchingRows } = await import("../src/lib/pnrr-projects-index.ts");
const { pnrrFunding, pnrrLocations } = await import("../src/lib/pnrr-projects-view.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { GET } = await import("../src/app/api/pnrr/progetti/route.ts");

const request = (query = "") => new NextRequest(`http://localhost/api/pnrr/progetti${query ? `?${query}` : ""}`);
const exec = promisify(execFile);

test("national PNRR index counts registrations separately from valid CUPs", async () => {
  assert.equal(pnrrProjectMetadata.coverage.projectRows, 291_398);
  assert.equal(pnrrProjectMetadata.coverage.uniqueCups, 285_992);
  assert.equal(pnrrProjectMetadata.coverage.missingCups, 2);
  assert.equal(pnrrProjectMetadata.options.mission.length, 7);
  assert.equal(pnrrProjectMetadata.options.mission.reduce((sum, row) => sum + row.rows, 0), 291_398);
  const first = await selectPnrrProjects({ limit: 2 });
  assert.equal(first.matchedRows, 291_398);
  assert.equal(first.rows.length, 2);
  assert.equal(first.dataset.id, "pnrr-progetti");
  assert.equal(first.dataset.licenseStatus, "verified-open-cc-by-4.0");
  assert.deepEqual(first.rows, (await selectIntegratedDataset({ datasetId: "pnrr-progetti", limit: 2 })).rows);
});

test("an exact CUP keeps every distinct CLP through cursor pagination", async () => {
  let cursor;
  const records = [];
  do {
    const page = await selectPnrrProjects({ cup: "E59J21011940003", limit: 100, cursor });
    assert.equal(page.matchedRows, 1_163);
    assert.ok(page.pagination.loadedChunks <= 8);
    records.push(...page.rows);
    cursor = page.pagination.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(records.length, 1_163);
  assert.equal(new Set(records.map((row) => row.id)).size, 1_163);
  assert.equal(new Set(records.map((row) => JSON.stringify([row.cells.CUP, row.cells["Codice Locale Progetto"], row.cells["Codice Univoco Submisura"]]))).size, 1_163);
});

test("combined territorial filters refer to the same source localization", async () => {
  assert.deepEqual(await pnrrMatchingRows({ region: "012", province: "015" }), []);
  assert.deepEqual(await pnrrMatchingRows({ territory: "058091", province: "015" }), []);
  const result = await selectPnrrProjects({ region: "012", province: "058", territory: "058091", limit: 10 });
  assert.ok(result.matchedRows > 0);
  for (const row of result.rows) {
    assert.ok(pnrrLocations(row.cells.Localizzazioni).some((location) => location[0] === "012" && location[2] === "058" && location[4] === "091"));
  }
  assert.equal(new Set(result.rows.map((row) => row.id)).size, result.rows.length);
});

test("CUP, mission, component, measure and attuator share identical API/MCP/corpus rows", async () => {
  const filters = { cup: "F81C23001370006", mission: "M1", component: "M1C1", measure: "M1C1I1.01", submeasure: "M1C1I1.01.00", code: "97832870584" };
  const result = await selectPnrrProjects(filters);
  assert.equal(result.matchedRows, 1);
  assert.equal(result.rows[0].cells["Finanziamento PNRR"], "2299193,71");
  const response = await GET(request(new URLSearchParams(filters)));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  assert.deepEqual(await queryPublicDataset({ dataset: "pnrr_progetti", ...filters }), result);
  assert.deepEqual((await selectIntegratedDataset({ datasetId: "pnrr-progetti", offset: result.rows[0].sourceRow - 1, limit: 1 })).rows, result.rows);
  assert.equal((await selectPnrrProjects({ ...filters, mission: "M7" })).matchedRows, 0);
});

test("cursor cannot silently change filters or release and handles malformed requests", async () => {
  const first = await selectPnrrProjects({ mission: "M1", limit: 2 });
  const cursor = first.pagination.nextCursor;
  await assert.rejects(selectPnrrProjects({ mission: "M2", cursor }), /Cursor/);
  const payload = JSON.parse(Buffer.from(cursor, "base64url").toString());
  payload.release = "0".repeat(64);
  await assert.rejects(selectPnrrProjects({ mission: "M1", cursor: Buffer.from(JSON.stringify(payload)).toString("base64url") }), /Cursor/);
  for (const query of ["cup=N%2FA", "cup=A12B34567890001&cup=A12B34567890001", "limit=0", "limit=101", "offset=1", "query=Roma", "cursor=invalid", "code=****************", "region=Lazio"]) {
    const response = await GET(request(query));
    assert.equal(response.status, 400, query);
  }
  const none = await selectPnrrProjects({ cup: "Z99Z99999999999" });
  assert.equal(none.matchedRows, 0);
  assert.deepEqual(none.rows, []);
  assert.equal(none.pagination.nextCursor, null);
  await assert.rejects(queryPublicDataset({ dataset: "pnrr_asili", component: "M1C1" }), /non supportati/);
});

test("funding preserves exact cents and missing values without floating point rounding", () => {
  assert.equal(pnrrFunding("0"), "0,00 €");
  assert.equal(pnrrFunding("1,5"), "1,50 €");
  assert.equal(pnrrFunding("12345678901234,01"), "12.345.678.901.234,01 €");
  assert.equal(pnrrFunding(""), "Non disponibile");
  assert.equal(pnrrFunding(null), "Non disponibile");
  assert.throws(() => pnrrFunding("1,005"), /invalido/);
  assert.throws(() => pnrrLocations('[ ["012"] ]'), /invalide/);
});

test("index bytes are hash-checked before serving any row references", async () => {
  const root = await mkdtemp(join(tmpdir(), "pnrr-index-check-"));
  try {
    const target = join(root, "src/data/generated/pnrr-projects-index");
    await mkdir(target, { recursive: true });
    const bytes = await readFile(new URL("../src/data/generated/pnrr-projects-index/cup.json.gz", import.meta.url));
    bytes[bytes.length - 1] ^= 1;
    await writeFile(join(target, "cup.json.gz"), bytes);
    const code = `import ${JSON.stringify(new URL("./helpers/register-ts-alias.mjs", import.meta.url).href)}; const {pnrrMatchingRows}=await import(${JSON.stringify(new URL("../src/lib/pnrr-projects-index.ts", import.meta.url).href)}); await pnrrMatchingRows({cup:"F81C23001370006"});`;
    await assert.rejects(exec(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code], { cwd: root }), (error) => /Hash indice PNRR divergente/.test(error.stderr));
  } finally { await rm(root, { recursive: true, force: true }); }
});
