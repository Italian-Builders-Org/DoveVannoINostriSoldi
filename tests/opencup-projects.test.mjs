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
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([key, child]) => [key, canonicalValue(child)]))
    : value;
const canonical = (value) => JSON.stringify(canonicalValue(value));
const headers = [
  "CUP", "DESCRIZIONE_SINTETICA_CUP", "ANNO_DECISIONE",
  "STATO_PROGETTO", "COSTO_PROGETTO", "FINANZIAMENTO_PROGETTO", "SOGGETTO_TITOLARE",
  "PIVA_CODFISCALE_SOG_TITOLARE", "PIVA_CF_BENEFICIARIO",
  "CODICE_NATURA_INTERVENTO", "NATURA_INTERVENTO", "COD_NATURA_DIPE", "NATURA_DIPE",
  "CODICE_TIPO_INTERVENTO", "TIPOLOGIA_INTERVENTO", "CODICE_AREA_INTERVENTO", "AREA_INTERVENTO",
  "CODICE_SETTORE_INTERVENTO", "SETTORE_INTERVENTO", "CODICE_SOTTOSETTORE_INTERVENTO",
  "SOTTOSETTORE_INTERVENTO", "CODICE_CATEGORIA_INTERVENTO", "CATEGORIA_INTERVENTO",
  "DATA_GENERAZIONE_CUP",
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
    SOGGETTO_TITOLARE: "Ente sintetico",
    PIVA_CODFISCALE_SOG_TITOLARE: null,
    PIVA_CF_BENEFICIARIO: null,
    CODICE_NATURA_INTERVENTO: "03",
    NATURA_INTERVENTO: "Realizzazione di lavori pubblici",
    COD_NATURA_DIPE: "03",
    NATURA_DIPE: "Realizzazione di lavori pubblici",
    CODICE_TIPO_INTERVENTO: "01",
    TIPOLOGIA_INTERVENTO: "Nuova realizzazione",
    CODICE_AREA_INTERVENTO: "01",
    AREA_INTERVENTO: "Area sintetica",
    CODICE_SETTORE_INTERVENTO: "01",
    SETTORE_INTERVENTO: "Settore sintetico",
    CODICE_SOTTOSETTORE_INTERVENTO: "01",
    SOTTOSETTORE_INTERVENTO: "Sottosettore sintetico",
    CODICE_CATEGORIA_INTERVENTO: "01",
    CATEGORIA_INTERVENTO: "Categoria sintetica",
    DATA_GENERAZIONE_CUP: "15/03/2024",
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
  const chunkGroup = await object({ chunks: [{ ...chunkDescriptor, firstSourceRow: 1, ordinal: 0, rowCount: 3 }], kind: "chunk-group", schemaVersion: 2 });
  const leaf = await object({ entries: [
    { cup: "A12B34567890001", matchedRows: 2, refs: [{ chunkOrdinal: 0, sourceRow: 1 }, { chunkOrdinal: 0, sourceRow: 3 }] },
    { cup: "B12B34567890002", matchedRows: 1, refs: [{ chunkOrdinal: 0, sourceRow: 2 }] },
  ], kind: "leaf", schemaVersion: 2 });
  const directory = await object({ children: [{ minCup: "A12B34567890001", maxCup: "B12B34567890002", node: leaf }], kind: "directory", schemaVersion: 2 });
  const manifest = {
    acquiredAt: null,
    canary: { cup: "A12B34567890001", sourceRow: 1 },
    chunkCount: 1,
    chunkGroups: [{ chunkCount: 1, firstOrdinal: 0, firstSourceRow: 1, object: chunkGroup, rowCount: 3 }],
    datasetId: "opencup-progetti-bulk",
    distinctCups: 2,
    evidenceLabel: "synthetic-fixture",
    fixtureOnly: true,
    headers,
    indexedRows: 3,
    landingUrl: null,
    lastModified: null,
    licenseUrl: null,
    licenseStatus: "unverified",
    observedAt: null,
    projectionVersion: 1,
    publicationDate: null,
    publicRows: 3,
    referenceDate: null,
    receiptSha256: "1".repeat(64),
    rootIndex: directory,
    schemaVersion: 2,
    sourceRows: 3,
    sourceSha256: "2".repeat(64),
    sourceSpecSha256: "3".repeat(64),
    sourceUrl: "https://www.opencup.gov.it/portale/web/opencup/accesso-agli-open-data",
  };
  await writeFile(join(root, "manifest.json"), `${canonical(manifest)}\n`);
  return manifest;
}

async function buildLargePostingFixture() {
  const cup = "A12B34567890001";
  const rows = Array.from({ length: 2_001 }, (_, index) => row(index + 1, cup, `Progetto ${index + 1}`));
  const chunkDescriptors = [];
  for (const [ordinal, first] of [0, 1_000, 2_000].entries()) {
    const chunkRows = rows.slice(first, first + 1_000);
    const chunkRaw = Buffer.from(`${chunkRows.map((value) => canonical(value)).join("\n")}\n`);
    const chunkPayload = gzipSync(chunkRaw, { mtime: 0 });
    const chunkDigest = sha256(chunkPayload);
    await writeFile(join(root, "sha256", chunkDigest), chunkPayload);
    chunkDescriptors.push({
      sha256: chunkDigest,
      bytes: chunkPayload.length,
      rawBytes: chunkRaw.length,
      format: "jsonl-gzip-v1",
      key: `sha256/${chunkDigest}`,
      firstSourceRow: first + 1,
      ordinal,
      rowCount: chunkRows.length,
    });
  }
  const chunkGroup = await object({
    chunks: chunkDescriptors,
    kind: "chunk-group",
    schemaVersion: 2,
  });
  const refs = rows.map((_, index) => ({ chunkOrdinal: Math.floor(index / 1_000), sourceRow: index + 1 }));
  const pageRefs = [refs.slice(0, 1_000), refs.slice(1_000, 2_000), refs.slice(2_000)];
  const lastPage = await object({ cup, kind: "postings", refs: pageRefs[2], schemaVersion: 2, start: 2_000 });
  const middlePage = await object({ cup, kind: "postings", next: lastPage, refs: pageRefs[1], schemaVersion: 2, start: 1_000 });
  const firstPage = await object({ cup, kind: "postings", next: middlePage, refs: pageRefs[0], schemaVersion: 2, start: 0 });
  const postingRoot = await object({
    children: [
      { end: 1_000, node: firstPage, start: 0 },
      { end: 2_000, node: middlePage, start: 1_000 },
      { end: 2_001, node: lastPage, start: 2_000 },
    ],
    kind: "posting-directory",
    schemaVersion: 2,
  });
  const leaf = await object({
    entries: [{ cup, matchedRows: rows.length, postingRoot }],
    kind: "leaf",
    schemaVersion: 2,
  });
  const directory = await object({
    children: [{ maxCup: cup, minCup: cup, node: leaf }],
    kind: "directory",
    schemaVersion: 2,
  });
  const manifest = {
    acquiredAt: null,
    canary: { cup, sourceRow: 1 },
    chunkCount: 3,
    chunkGroups: [{ chunkCount: 3, firstOrdinal: 0, firstSourceRow: 1, object: chunkGroup, rowCount: rows.length }],
    datasetId: "opencup-progetti-bulk",
    distinctCups: 1,
    evidenceLabel: "synthetic-fixture",
    fixtureOnly: true,
    headers,
    indexedRows: rows.length,
    landingUrl: null,
    lastModified: null,
    licenseUrl: null,
    licenseStatus: "unverified",
    observedAt: null,
    projectionVersion: 1,
    publicationDate: null,
    publicRows: rows.length,
    referenceDate: null,
    receiptSha256: "4".repeat(64),
    rootIndex: directory,
    schemaVersion: 2,
    sourceRows: rows.length,
    sourceSha256: "5".repeat(64),
    sourceSpecSha256: "6".repeat(64),
    sourceUrl: "https://www.opencup.gov.it/portale/web/opencup/accesso-agli-open-data",
  };
  return { manifest, firstPage, middlePage, lastPage };
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
  openCupPostingRefs,
  probeOpenCupRelease,
} = await import("../src/lib/opencup-projects-index.ts");
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
assert.throws(enableOpenCupFixtureAccessForTests, /produzione/);
if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalNodeEnv;
enableOpenCupFixtureAccessForTests();
const { GET, handleOpenCupRequest } = await import("../src/app/api/opencup/progetti/route.ts");
const { registeredDatasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const activeRequest = (request) => handleOpenCupRequest(request, "active");

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

test("OpenCUP v2 keeps small posting references inline", async () => {
  const directory = JSON.parse(await readFile(join(root, fixtureManifest.rootIndex.key), "utf8"));
  const leaf = JSON.parse(await readFile(join(root, directory.children[0].node.key), "utf8"));
  assert.deepEqual(leaf.entries[0].refs, [
    { chunkOrdinal: 0, sourceRow: 1 },
    { chunkOrdinal: 0, sourceRow: 3 },
  ]);
  assert.equal("postingRoot" in leaf.entries[0], false);
});

test("OpenCUP v2 starts at a late posting page without reading earlier pages", async () => {
  const manifestPath = join(root, "large-manifest.json");
  const originalManifestPath = process.env.DVNS_OPENCUP_PROJECTS_MANIFEST;
  const large = await buildLargePostingFixture();
  await writeFile(manifestPath, `${canonical(large.manifest)}\n`);
  process.env.DVNS_OPENCUP_PROJECTS_MANIFEST = manifestPath;
  resetImmutableObjectStoreForTests();
  try {
    const match = await openCupPostingRefs("A12B34567890001", 1_000, 1);
    assert.deepEqual(match.refs.map((ref) => ref.sourceRow), [1_001]);
    const cacheKeys = getImmutableObjectStoreDiagnosticsForTests().cacheKeys;
    assert.ok(cacheKeys.some((key) => key.includes(large.middlePage.sha256)));
    assert.equal(cacheKeys.some((key) => key.includes(large.firstPage.sha256)), false);
    assert.equal(cacheKeys.some((key) => key.includes(large.lastPage.sha256)), false);
    assert.equal(cacheKeys.length, 5);
    assert.ok(cacheKeys.length <= 8);

    resetImmutableObjectStoreForTests();
    const acrossBoundary = await openCupPostingRefs("A12B34567890001", 1_000, 1_001);
    assert.equal(acrossBoundary.refs.length, 1_001);
    assert.equal(acrossBoundary.refs[0].sourceRow, 1_001);
    assert.equal(acrossBoundary.refs.at(-1).sourceRow, 2_001);
    const boundaryCacheKeys = getImmutableObjectStoreDiagnosticsForTests().cacheKeys;
    assert.equal(boundaryCacheKeys.some((key) => key.includes(large.firstPage.sha256)), false);
    assert.ok(boundaryCacheKeys.some((key) => key.includes(large.middlePage.sha256)));
    assert.ok(boundaryCacheKeys.some((key) => key.includes(large.lastPage.sha256)));
    assert.equal(boundaryCacheKeys.length, 6);
  } finally {
    process.env.DVNS_OPENCUP_PROJECTS_MANIFEST = originalManifestPath;
    resetImmutableObjectStoreForTests();
  }
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

test("OpenCUP runtime rejects an ETL sample manifest", async () => {
  const manifestPath = join(root, "sample-manifest.json");
  const productionSample = {
    ...fixtureManifest,
    acquiredAt: "2026-09-07T14:12:59Z",
    evidenceLabel: "documented-fact",
    landingUrl: "https://www.opencup.gov.it/portale/web/opencup/accesso-agli-open-data",
    lastModified: "2026-09-03T16:59:46Z",
    licenseStatus: "CC-BY-4.0",
    licenseUrl: "https://www.opencup.gov.it/portale/web/opencup/licenza-cc-by",
    observedAt: "2026-09-07T14:02:03Z",
    referenceDate: "2026-08-01",
    sampleDefinition: { kind: "global-prefix", rows: 3 },
    sampleOnly: true,
  };
  delete productionSample.fixtureOnly;
  await writeFile(manifestPath, `${canonical(productionSample)}\n`);
  const originalManifestPath = process.env.DVNS_OPENCUP_PROJECTS_MANIFEST;
  process.env.DVNS_OPENCUP_PROJECTS_MANIFEST = manifestPath;
  resetImmutableObjectStoreForTests();
  try {
    await assert.rejects(probeOpenCupRelease(), /manifest opencup mancante o non valido/i);
    assert.deepEqual(getImmutableObjectStoreDiagnosticsForTests().cacheKeys, []);
  } finally {
    process.env.DVNS_OPENCUP_PROJECTS_MANIFEST = originalManifestPath;
    resetImmutableObjectStoreForTests();
  }
});

test("OpenCUP runtime rejects an incomplete production index before object reads", async () => {
  const manifestPath = join(root, "incomplete-production-manifest.json");
  const incomplete = {
    ...fixtureManifest,
    acquiredAt: "2026-09-07T14:12:59Z",
    evidenceLabel: "documented-fact",
    indexedRows: fixtureManifest.publicRows - 1,
    landingUrl: "https://www.opencup.gov.it/portale/web/opencup/accesso-agli-open-data",
    lastModified: "2026-09-03T16:59:46Z",
    licenseStatus: "CC-BY-4.0",
    licenseUrl: "https://www.opencup.gov.it/portale/web/opencup/licenza-cc-by",
    observedAt: "2026-09-07T14:02:03Z",
    referenceDate: "2026-08-01",
  };
  delete incomplete.fixtureOnly;
  await writeFile(manifestPath, `${canonical(incomplete)}\n`);
  const originalManifestPath = process.env.DVNS_OPENCUP_PROJECTS_MANIFEST;
  process.env.DVNS_OPENCUP_PROJECTS_MANIFEST = manifestPath;
  resetImmutableObjectStoreForTests();
  try {
    const response = await activeRequest(new NextRequest("http://localhost/api/opencup/progetti?cup=B12B34567890002"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(getImmutableObjectStoreDiagnosticsForTests().cacheKeys, []);
  } finally {
    process.env.DVNS_OPENCUP_PROJECTS_MANIFEST = originalManifestPath;
    resetImmutableObjectStoreForTests();
  }
});

test("OpenCUP runtime rejects non-official production provenance URLs", async () => {
  const manifestPath = join(root, "invalid-production-url-manifest.json");
  const validProduction = {
    ...fixtureManifest,
    acquiredAt: "2026-09-07T14:12:59Z",
    evidenceLabel: "documented-fact",
    landingUrl: "https://www.opencup.gov.it/portale/web/opencup/accesso-agli-open-data",
    lastModified: "2026-09-03T16:59:46Z",
    licenseStatus: "CC-BY-4.0",
    licenseUrl: "https://www.opencup.gov.it/portale/web/opencup/licenza-cc-by",
    observedAt: "2026-09-07T14:02:03Z",
    referenceDate: "2026-08-01",
    sourceUrl: "https://www.opencup.gov.it/portale/documents/21195/299152/OpendataProgetti.zip/7384382b-679a-0380-c750-ce40779b59d7?t=1708657459966",
  };
  delete validProduction.fixtureOnly;
  const originalManifestPath = process.env.DVNS_OPENCUP_PROJECTS_MANIFEST;
  process.env.DVNS_OPENCUP_PROJECTS_MANIFEST = manifestPath;
  try {
    for (const [field, value] of [
      ["landingUrl", "https://example.invalid/portale/web/opencup/accesso-agli-open-data"],
      ["sourceUrl", "javascript:alert(1)"],
      ["licenseUrl", "data:text/plain,CC-BY-4.0"],
    ]) {
      await writeFile(manifestPath, `${canonical({ ...validProduction, [field]: value })}\n`);
      resetImmutableObjectStoreForTests();
      await assert.rejects(probeOpenCupRelease(), /provenienza url manifest opencup/i);
      assert.deepEqual(getImmutableObjectStoreDiagnosticsForTests().cacheKeys, []);
    }
  } finally {
    process.env.DVNS_OPENCUP_PROJECTS_MANIFEST = originalManifestPath;
    resetImmutableObjectStoreForTests();
  }
});

test("OpenCUP HTTP route shares selector results and distinguishes absent from invalid CUP", async () => {
  const gated = await GET(new NextRequest("http://localhost/api/opencup/progetti?cup=A12B34567890001&limit=1"));
  assert.equal(gated.status, 404);
  const response = await activeRequest(new NextRequest("http://localhost/api/opencup/progetti?cup=A12B34567890001&limit=1"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=300");
  const payload = await response.json();
  assert.equal(payload.rows[0].sourceRow, 1);
  assert.deepEqual(payload.dataset.sourceMetadata.canonicalUrls, [fixtureManifest.sourceUrl]);
  assert.equal(payload.dataset.sourceMetadata.referencePeriod, null);
  assert.equal(payload.dataset.sourceMetadata.publicationDate, null);
  assert.equal(payload.dataset.sourceMetadata.acquisitionDate, null);

  const absent = await activeRequest(new NextRequest("http://localhost/api/opencup/progetti?cup=Z99Z99999999999"));
  assert.equal(absent.status, 200);
  assert.equal((await absent.json()).matchedRows, 0);

  for (const query of ["cup=short", "cup=A12B34567890001&cup=A12B34567890001", "q=scuola", "limit=101"]) {
    const invalid = await activeRequest(new NextRequest(`http://localhost/api/opencup/progetti?${query}`));
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
    const response = await activeRequest(new NextRequest("http://localhost/api/opencup/progetti?cup=A12B34567890001"));
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
  const alteredChunkGroup = JSON.parse(await readFile(join(root, alteredManifest.chunkGroups[0].object.key), "utf8"));
  alteredChunkGroup.chunks[0] = {
    bytes: payload.length, firstSourceRow: 1, format: "jsonl-gzip-v1",
    key: `sha256/${digest}`, ordinal: 0, rawBytes: raw.length, rowCount: 3, sha256: digest,
  };
  alteredManifest.chunkGroups[0].object = await object(alteredChunkGroup);
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
    const response = await activeRequest(new NextRequest("http://localhost/api/opencup/progetti?cup=A12B34567890001"));
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
  const largeChunkGroup = JSON.parse(await readFile(join(root, largeManifest.chunkGroups[0].object.key), "utf8"));
  largeChunkGroup.chunks[0] = {
    bytes: payload.length,
    firstSourceRow: 1,
    format: "jsonl-gzip-v1",
    key: `sha256/${digest}`,
    ordinal: 0,
    rawBytes: raw.length,
    rowCount: 3,
    sha256: digest,
  };
  largeManifest.chunkGroups[0].object = await object(largeChunkGroup);
  resetImmutableObjectStoreForTests();
  await writeFile(manifestPath, `${canonical(largeManifest)}\n`);
  try {
    const response = await activeRequest(new NextRequest("http://localhost/api/opencup/progetti?cup=A12B34567890001&limit=1"));
    assert.equal(response.status, 413);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    await writeFile(manifestPath, originalManifest);
    resetImmutableObjectStoreForTests();
  }
});

test("configured OpenCUP MCP descriptor documents plural accounting semantics", async () => {
  const direct = await selectOpenCupProjects({ cup: "  a12b34567890001  ", limit: 1 });
  assert.equal(direct.rows.length, 1);
  const descriptor = registeredDatasetCatalog.find((dataset) => dataset.id === "opencup_progetto");
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
  assert.equal(release.referenceDate, null);
  assert.equal(release.publicationDate, null);
  assert.equal(release.lastModified, null);
  assert.equal(release.observedAt, null);
  assert.equal(release.acquiredAt, null);
  assert.equal(release.landingUrl, null);
  assert.equal(release.licenseUrl, null);
  assert.match(release.releaseId, /^[0-9a-f]{64}$/);
});
