import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const root = await mkdtemp(join(tmpdir(), "opencup-selector-"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalValue = (value) => Array.isArray(value)
  ? value.map(canonicalValue)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalValue(child)]))
    : value;
const canonical = (value) => JSON.stringify(canonicalValue(value));
const headers = [
  "CUP", "DESCRIZIONE_SINTETICA_CUP", "ANNO_DECISIONE", "DATA_GENERAZIONE_CUP",
  "STATO_PROGETTO", "COSTO_PROGETTO", "FINANZIAMENTO_PROGETTO", "SOGGETTO_TITOLARE",
  "PIVA_CODFISCALE_SOG_TITOLARE", "PIVA_CF_BENEFICIARIO",
  "CODICE_NATURA_INTERVENTO", "NATURA_INTERVENTO", "CODICE_TIPO_INTERVENTO",
  "TIPOLOGIA_INTERVENTO", "CODICE_REGIONE", "REGIONE", "CODICE_COMUNE", "COMUNE",
];

async function object(value, format = "json-v1") {
  const raw = Buffer.from(`${canonical(value)}\n`);
  const payload = format === "jsonl-gzip-v1" ? gzipSync(raw, { mtime: 0 }) : raw;
  const digest = sha256(payload);
  await mkdir(join(root, "sha256"), { recursive: true });
  await writeFile(join(root, "sha256", digest), payload);
  return { sha256: digest, bytes: payload.length, rawBytes: raw.length, format, key: `sha256/${digest}` };
}

function row(sourceRow, cup, description) {
  const cells = {
    CUP: cup,
    DESCRIZIONE_SINTETICA_CUP: description,
    ANNO_DECISIONE: "2024",
    DATA_GENERAZIONE_CUP: "15/03/2024",
    STATO_PROGETTO: "Attivo",
    COSTO_PROGETTO: sourceRow === 1 ? "0" : "10,50",
    FINANZIAMENTO_PROGETTO: "9,25",
    SOGGETTO_TITOLARE: "Comune sintetico",
    PIVA_CODFISCALE_SOG_TITOLARE: null,
    PIVA_CF_BENEFICIARIO: null,
    CODICE_NATURA_INTERVENTO: "03",
    NATURA_INTERVENTO: "Realizzazione di lavori pubblici",
    CODICE_TIPO_INTERVENTO: "01",
    TIPOLOGIA_INTERVENTO: "Nuova realizzazione",
    CODICE_REGIONE: "05",
    REGIONE: "VENETO",
    CODICE_COMUNE: "023091",
    COMUNE: "VERONA",
  };
  const digest = sha256(Buffer.from(`${canonical(cells)}\n`));
  return {
    id: `row-${sha256(`opencup-progetti-bulk:${sourceRow}:${digest}`).slice(0, 24)}`,
    cells,
    evidenceLabel: "synthetic-fixture",
    redactions: [
      { field: "PIVA_CODFISCALE_SOG_TITOLARE", reason: "personal-identifier" },
      { field: "PIVA_CF_BENEFICIARIO", reason: "personal-identifier" },
    ],
    sourceRow,
    sourceRowSha256: digest,
    sourceUrls: [],
  };
}

async function buildFixture() {
  const rows = [
    row(1, "A12B34567890001", "Prima registrazione"),
    row(2, "B12B34567890002", "Altro progetto"),
    row(3, "A12B34567890001", "Seconda registrazione"),
  ];
  const chunkRaw = Buffer.from(`${rows.map((value) => canonical(value)).join("\n")}\n`);
  const chunkPayload = gzipSync(chunkRaw, { mtime: 0 });
  const chunkDigest = sha256(chunkPayload);
  await mkdir(join(root, "sha256"), { recursive: true });
  await writeFile(join(root, "sha256", chunkDigest), chunkPayload);
  const chunkDescriptor = { sha256: chunkDigest, bytes: chunkPayload.length, rawBytes: chunkRaw.length, format: "jsonl-gzip-v1", key: `sha256/${chunkDigest}` };
  const postingsA = await object({ cup: "A12B34567890001", kind: "postings", next: null, refs: [{ chunkOrdinal: 0, sourceRow: 1 }, { chunkOrdinal: 0, sourceRow: 3 }], schemaVersion: 1 });
  const postingsB = await object({ cup: "B12B34567890002", kind: "postings", next: null, refs: [{ chunkOrdinal: 0, sourceRow: 2 }], schemaVersion: 1 });
  const leaf = await object({ entries: [{ cup: "A12B34567890001", firstPage: postingsA, matchedRows: 2 }, { cup: "B12B34567890002", firstPage: postingsB, matchedRows: 1 }], kind: "leaf", schemaVersion: 1 });
  const directory = await object({ children: [{ minCup: "A12B34567890001", maxCup: "B12B34567890002", node: leaf }], kind: "directory", schemaVersion: 1 });
  const manifest = {
    canary: { cup: "A12B34567890001", sourceRow: 1 },
    chunks: [{ ...chunkDescriptor, firstSourceRow: 1, ordinal: 0, rowCount: 3 }],
    datasetId: "opencup-progetti-bulk",
    distinctCups: 2,
    evidenceLabel: "synthetic-fixture",
    fixtureOnly: true,
    headers,
    indexedRows: 3,
    licenseStatus: "unverified",
    observedAt: null,
    projectionVersion: 1,
    publishedAt: null,
    publicRows: 3,
    receiptSha256: "1".repeat(64),
    rootIndex: directory,
    schemaVersion: 1,
    sourceRows: 3,
    sourceSha256: "2".repeat(64),
    sourceSpecSha256: "3".repeat(64),
    sourceUrl: "https://www.opencup.gov.it/portale/web/opencup/accesso-agli-open-data",
  };
  await writeFile(join(root, "manifest.json"), `${canonical(manifest)}\n`);
  return manifest;
}

const fixtureManifest = await buildFixture();
process.env.DVNS_OPENCUP_PROJECTS_MANIFEST = join(root, "manifest.json");
const { selectOpenCupProjects } = await import("../src/lib/integrated-public-view.ts");
const {
  getImmutableObjectStoreDiagnosticsForTests,
  resetImmutableObjectStoreForTests,
} = await import("../src/lib/integrated-object-store.ts");
const {
  enableOpenCupFixtureAccessForTests,
  probeOpenCupRelease,
} = await import("../src/lib/opencup-projects-index.ts");
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
assert.throws(enableOpenCupFixtureAccessForTests, /produzione/);
if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalNodeEnv;
enableOpenCupFixtureAccessForTests();
const { GET } = await import("../src/app/api/opencup/progetti/route.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");

test.after(async () => {
  delete process.env.DVNS_OPENCUP_PROJECTS_MANIFEST;
  await rm(root, { recursive: true, force: true });
});

test("exact OpenCUP selector normalizes CUP and preserves duplicate registrations across pages", async () => {
  const first = await selectOpenCupProjects({ cup: "  a12b34567890001  ", limit: 1 });
  assert.equal(first.filters.cup, "A12B34567890001");
  assert.equal(first.matchedRows, 2);
  assert.deepEqual(first.rows.map((value) => value.sourceRow), [1]);
  assert.equal(first.pagination.loadedChunks, 1);
  assert.ok(first.pagination.nextCursor);

  const second = await selectOpenCupProjects({
    cup: "A12B34567890001",
    limit: 1,
    cursor: first.pagination.nextCursor,
  });
  assert.deepEqual(second.rows.map((value) => value.sourceRow), [3]);
  assert.equal(second.pagination.start, 1);
  assert.equal(second.pagination.exhausted, true);
  assert.equal(second.pagination.nextCursor, null);
});

test("OpenCUP rejects a cursor from another release before reading immutable objects", async () => {
  const first = await selectOpenCupProjects({ cup: "A12B34567890001", limit: 1 });
  const decoded = JSON.parse(Buffer.from(first.pagination.nextCursor, "base64url").toString("utf8"));
  decoded.releaseId = "f".repeat(64);
  const cursor = Buffer.from(canonical(decoded), "utf8").toString("base64url");

  resetImmutableObjectStoreForTests();
  await assert.rejects(
    selectOpenCupProjects({ cup: "A12B34567890001", limit: 1, cursor }),
    /rilascio diverso/i,
  );
  assert.deepEqual(getImmutableObjectStoreDiagnosticsForTests().cacheKeys, []);
});

test("invalid OpenCUP input performs no immutable-object reads", async () => {
  resetImmutableObjectStoreForTests();
  await assert.rejects(selectOpenCupProjects({ cup: "short" }), /15 caratteri/);
  assert.deepEqual(getImmutableObjectStoreDiagnosticsForTests().cacheKeys, []);
});

test("OpenCUP HTTP route shares selector results and distinguishes absent from invalid CUP", async () => {
  const response = await GET(new NextRequest("http://localhost/api/opencup/progetti?cup=A12B34567890001&limit=1"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=300");
  assert.equal((await response.json()).rows[0].sourceRow, 1);

  const absent = await GET(new NextRequest("http://localhost/api/opencup/progetti?cup=Z99Z99999999999"));
  assert.equal(absent.status, 200);
  assert.equal((await absent.json()).matchedRows, 0);

  for (const query of ["cup=short", "cup=A12B34567890001&cup=A12B34567890001", "q=scuola", "limit=101"]) {
    const invalid = await GET(new NextRequest(`http://localhost/api/opencup/progetti?${query}`));
    assert.equal(invalid.status, 400, query);
    assert.equal(invalid.headers.get("cache-control"), "no-store");
  }
});

test("OpenCUP HTTP route maps an altered index object to a non-cacheable 503", async () => {
  const indexPath = join(root, fixtureManifest.rootIndex.key);
  const original = await readFile(indexPath);
  const altered = Buffer.from(original);
  altered[0] = altered[0] === 0x7b ? 0x5b : 0x7b;
  resetImmutableObjectStoreForTests();
  await writeFile(indexPath, altered);
  try {
    const response = await GET(new NextRequest("http://localhost/api/opencup/progetti?cup=A12B34567890001"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("retry-after"), "5");
  } finally {
    await writeFile(indexPath, original);
    resetImmutableObjectStoreForTests();
  }
});

test("OpenCUP rejects a canonically hashed index whose matchedRows is false", async () => {
  const manifestPath = join(root, "manifest.json");
  const originalManifest = await readFile(manifestPath);
  const directory = JSON.parse(await readFile(join(root, fixtureManifest.rootIndex.key), "utf8"));
  const leafDescriptor = directory.children[0].node;
  const leaf = JSON.parse(await readFile(join(root, leafDescriptor.key), "utf8"));
  const alteredLeaf = structuredClone(leaf);
  alteredLeaf.entries[0].matchedRows = 3;
  const newLeaf = await object(alteredLeaf);
  const alteredDirectory = structuredClone(directory);
  alteredDirectory.children[0].node = newLeaf;
  const newDirectory = await object(alteredDirectory);
  const alteredManifest = structuredClone(fixtureManifest);
  alteredManifest.rootIndex = newDirectory;
  resetImmutableObjectStoreForTests();
  await writeFile(manifestPath, `${canonical(alteredManifest)}\n`);
  try {
    await assert.rejects(
      selectOpenCupProjects({ cup: "A12B34567890001", limit: 1 }),
      /conteggio posting list/i,
    );
  } finally {
    await writeFile(manifestPath, originalManifest);
    resetImmutableObjectStoreForTests();
  }
});

test("OpenCUP rejects privately identifying cells even with valid object hashes", async () => {
  const manifestPath = join(root, "manifest.json");
  const originalManifest = await readFile(manifestPath);
  const rows = [
    row(1, "A12B34567890001", "Prima registrazione"),
    row(2, "B12B34567890002", "Altro progetto"),
    row(3, "A12B34567890001", "Seconda registrazione"),
  ];
  rows[0].cells.PIVA_CODFISCALE_SOG_TITOLARE = "00000000000";
  rows[0].sourceRowSha256 = sha256(Buffer.from(`${canonical(rows[0].cells)}\n`));
  rows[0].id = `row-${sha256(`opencup-progetti-bulk:1:${rows[0].sourceRowSha256}`).slice(0, 24)}`;
  const raw = Buffer.from(`${rows.map((value) => canonical(value)).join("\n")}\n`);
  const payload = gzipSync(raw, { mtime: 0 });
  const digest = sha256(payload);
  await writeFile(join(root, "sha256", digest), payload);
  const alteredManifest = structuredClone(fixtureManifest);
  alteredManifest.chunks[0] = {
    bytes: payload.length, firstSourceRow: 1, format: "jsonl-gzip-v1",
    key: `sha256/${digest}`, ordinal: 0, rawBytes: raw.length, rowCount: 3, sha256: digest,
  };
  resetImmutableObjectStoreForTests();
  await writeFile(manifestPath, `${canonical(alteredManifest)}\n`);
  try {
    await assert.rejects(
      selectOpenCupProjects({ cup: "A12B34567890001", limit: 1 }),
      /schema o ordine riga/i,
    );
  } finally {
    await writeFile(manifestPath, originalManifest);
    resetImmutableObjectStoreForTests();
  }
});

test("OpenCUP HTTP route fails closed when no manifest is configured", async () => {
  const manifestPath = process.env.DVNS_OPENCUP_PROJECTS_MANIFEST;
  delete process.env.DVNS_OPENCUP_PROJECTS_MANIFEST;
  try {
    const response = await GET(new NextRequest("http://localhost/api/opencup/progetti?cup=A12B34567890001"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    process.env.DVNS_OPENCUP_PROJECTS_MANIFEST = manifestPath;
  }
});

test("OpenCUP HTTP route rejects an oversized serialized response", async () => {
  const manifestPath = join(root, "manifest.json");
  const originalManifest = await readFile(manifestPath);
  const rows = [
    row(1, "A12B34567890001", "x".repeat(760_000)),
    row(2, "B12B34567890002", "Altro progetto"),
    row(3, "A12B34567890001", "Seconda registrazione"),
  ];
  const raw = Buffer.from(`${rows.map((value) => canonical(value)).join("\n")}\n`);
  const payload = gzipSync(raw, { mtime: 0 });
  const digest = sha256(payload);
  await writeFile(join(root, "sha256", digest), payload);
  const largeManifest = structuredClone(fixtureManifest);
  largeManifest.chunks[0] = {
    bytes: payload.length,
    firstSourceRow: 1,
    format: "jsonl-gzip-v1",
    key: `sha256/${digest}`,
    ordinal: 0,
    rawBytes: raw.length,
    rowCount: 3,
    sha256: digest,
  };
  resetImmutableObjectStoreForTests();
  await writeFile(manifestPath, `${canonical(largeManifest)}\n`);
  try {
    const response = await GET(new NextRequest("http://localhost/api/opencup/progetti?cup=A12B34567890001&limit=1"));
    assert.equal(response.status, 413);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    await writeFile(manifestPath, originalManifest);
    resetImmutableObjectStoreForTests();
  }
});

test("OpenCUP MCP dispatch reuses the selector and documents plural accounting semantics", async () => {
  const direct = await selectOpenCupProjects({ cup: "A12B34567890001", limit: 1 });
  const mcp = await queryPublicDataset({
    dataset: "opencup_progetto",
    cup: "  a12b34567890001  ",
    limit: 1,
  });
  assert.deepEqual(mcp, direct);
  const descriptor = datasetCatalog.find((dataset) => dataset.id === "opencup_progetto");
  assert.ok(descriptor);
  assert.deepEqual(descriptor.sourceIds, ["opencup"]);
  assert.equal(descriptor.sources[0].owner, "Dipartimento per la programmazione e il coordinamento della politica economica");
  assert.deepEqual(descriptor.filters, ["cup", "limit", "cursor"]);
  assert.match(descriptor.summary, /registrazioni/i);
  assert.match(descriptor.caveat, /costo.*finanziamento.*pagament/i);
});

test("OpenCUP source probe verifies the pinned root and public canary", async () => {
  const release = await probeOpenCupRelease();
  assert.equal(release.fixtureOnly, true);
  assert.equal(release.publicRows, 3);
  assert.equal(release.distinctCups, 2);
  assert.equal(release.publishedAt, null);
  assert.match(release.releaseId, /^[0-9a-f]{64}$/);
});
