import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { canonicalJson: canonical, sha256Hex: sha256 } = await import("../src/lib/integrated-source-contract.ts");
const { selectOpenCupProjects } = await import("../src/lib/integrated-public-view.ts");
const { getImmutableObjectStoreDiagnosticsForTests, resetImmutableObjectStoreForTests } = await import("../src/lib/integrated-object-store.ts");
const { enableOpenCupFixtureAccessForTests, openCupPostingRefs, probeOpenCupRelease } = await import("../src/lib/opencup-projects-index.ts");
const { SOURCE_POLICIES } = await import("../src/lib/data/source-policy.ts");
const { SOURCE_HEALTH_ADAPTERS } = await import("../src/lib/data/source-health.ts");
const { GET } = await import("../src/app/api/opencup/progetti/route.ts");
const temporary = await mkdtemp(join(tmpdir(), "opencup-selector-"));
const root = join(temporary, "small");
const manifestPath = join(root, "manifest.json");

function buildFixture(output, count) {
  // Exercise the real ETL -> manifest -> TypeScript contract; never hand-build the index.
  return JSON.parse(execFileSync(process.env.PYTHON ?? "python3", ["-c", String.raw`
import csv, io, json, sys, zipfile
from pathlib import Path
import opencup_projects as etl

output, count = Path(sys.argv[1]), int(sys.argv[2])
if count > 3:
    etl.MAX_CHUNK_ROWS = 1
    etl.MAX_CHUNK_GROUP_CHUNKS = 1
    etl.MAX_INDEX_CHILDREN = 2
headers = etl.official_contract()["csv"]["headers"]
text = io.StringIO(newline="")
writer = csv.DictWriter(text, fieldnames=headers, delimiter=";", lineterminator="\n")
writer.writeheader()
for index in range(count):
    row = dict.fromkeys(headers, "")
    row.update({
        "CUP": "B12B34567890002" if count == 3 and index == 1 else "A12B34567890001",
        "DESCRIZIONE_SINTETICA_CUP": f"Progetto sintetico {index + 1}",
        "COSTO_PROGETTO": "0" if index == 0 else "10",
        "FINANZIAMENTO_PROGETTO": "" if index == 1 else "9",
        "PIVA_CODFISCALE_SOG_TITOLARE": "00000000000",
        "PIVA_CF_BENEFICIARIO": "RSSMRA80A01H501U",
    })
    writer.writerow(row)
archive = output.with_suffix(".zip")
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as target:
    target.writestr("OpenCup_Progetti0.csv", text.getvalue().encode("utf-8"))
manifest = etl.build_release(archive, output, etl.synthetic_contract())
proof = etl.verify_release(output / "manifest.json")
assert proof["verifiedRows"] == proof["verifiedPostingRefs"] == count
print(json.dumps(manifest))
`, output, String(count)], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, DVNS_OFFLINE_GUARD: "1", PYTHONPATH: "scripts/etl:scripts/ci" },
    encoding: "utf8",
  }));
}

const fixtureManifest = buildFixture(root, 3);
const group = JSON.parse(await readFile(join(root, fixtureManifest.chunkGroups[0].object.key), "utf8"));
const fixtureRows = gunzipSync(await readFile(join(root, group.chunks[0].key)))
  .toString().trimEnd().split("\n").map((line) => JSON.parse(line));

const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
assert.throws(enableOpenCupFixtureAccessForTests, /produzione/);
if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalNodeEnv;
enableOpenCupFixtureAccessForTests();
process.env.DVNS_OPENCUP_PROJECTS_MANIFEST = manifestPath;

async function object(value) {
  const raw = Buffer.from(canonical(value) + "\n");
  const digest = sha256(raw);
  await mkdir(join(root, "sha256"), { recursive: true });
  await writeFile(join(root, "sha256", digest), raw);
  return { sha256: digest, bytes: raw.length, rawBytes: raw.length, format: "json-v1", key: "sha256/" + digest };
}

async function replaceRows(rows) {
  const raw = Buffer.from(rows.map((value) => canonical(value)).join("\n") + "\n");
  const payload = gzipSync(raw, { mtime: 0 });
  const digest = sha256(payload);
  await writeFile(join(root, "sha256", digest), payload);
  const changedGroup = structuredClone(group);
  Object.assign(changedGroup.chunks[0], {
    bytes: payload.length, rawBytes: raw.length, sha256: digest, key: "sha256/" + digest,
  });
  const manifest = structuredClone(fixtureManifest);
  manifest.chunkGroups[0].object = await object(changedGroup);
  await writeFile(manifestPath, canonical(manifest) + "\n");
}

function rehashRow(row) {
  row.sourceRowSha256 = sha256(canonical(row.cells) + "\n");
  row.id = "row-" + sha256("opencup-progetti-bulk:" + row.sourceRow + ":" + row.sourceRowSha256).slice(0, 24);
}

function request(query = "cup=A12B34567890001") {
  return GET(new NextRequest("http://localhost/api/opencup/progetti?" + query));
}

test.afterEach(async () => {
  SOURCE_POLICIES.opencup.integration = "configured";
  process.env.DVNS_OPENCUP_PROJECTS_MANIFEST = manifestPath;
  await writeFile(manifestPath, canonical(fixtureManifest) + "\n");
  resetImmutableObjectStoreForTests();
});
test.after(async () => {
  delete process.env.DVNS_OPENCUP_PROJECTS_MANIFEST;
  await rm(temporary, { recursive: true, force: true });
});

test("ETL output supports exact CUP pagination, redaction and absent results", async () => {
  const first = await selectOpenCupProjects({ cup: "  a12b34567890001  ", limit: 1 });
  assert.equal(first.filters.cup, "A12B34567890001");
  assert.equal(first.matchedRows, 2);
  assert.deepEqual(first.rows.map((row) => row.sourceRow), [1]);
  assert.equal(first.rows[0].cells.COSTO_PROGETTO, "0");
  assert.equal(first.rows[0].cells.PIVA_CODFISCALE_SOG_TITOLARE, null);
  assert.equal(first.rows[0].cells.PIVA_CF_BENEFICIARIO, null);
  const second = await selectOpenCupProjects({
    cup: "A12B34567890001", limit: 1, cursor: first.pagination.nextCursor,
  });
  assert.deepEqual(second.rows.map((row) => row.sourceRow), [3]);
  assert.equal(second.pagination.nextCursor, null);
  assert.equal(second.pagination.exhausted, true);
  assert.equal((await selectOpenCupProjects({ cup: "Z99Z99999999999" })).matchedRows, 0);
});

test("late posting lookup skips earlier objects and stays within the read budget", async () => {
  const largeRoot = join(temporary, "large");
  const manifest = buildFixture(largeRoot, 2_001);
  process.env.DVNS_OPENCUP_PROJECTS_MANIFEST = join(largeRoot, "manifest.json");
  const first = await selectOpenCupProjects({ cup: "A12B34567890001", limit: 1 });
  assert.equal(first.rows[0].sourceRow, 1);
  assert.ok(first.pagination.nextCursor);
  resetImmutableObjectStoreForTests();
  const directory = JSON.parse(await readFile(join(largeRoot, manifest.rootIndex.key), "utf8"));
  const leaf = JSON.parse(await readFile(join(largeRoot, directory.children[0].node.key), "utf8"));
  const postingRoot = JSON.parse(await readFile(join(largeRoot, leaf.entries[0].postingRoot.key), "utf8"));
  let earlier = postingRoot.children[0].node;
  while (true) {
    const node = JSON.parse(await readFile(join(largeRoot, earlier.key), "utf8"));
    if (node.kind === "postings") break;
    earlier = node.children[0].node;
  }
  await writeFile(join(largeRoot, earlier.key), "unreadable earlier page");
  const match = await openCupPostingRefs("A12B34567890001", 1_000, 1_001);
  assert.equal(match.refs.length, 1_001);
  assert.equal(match.refs[0].sourceRow, 1_001);
  assert.equal(match.refs.at(-1).sourceRow, 2_001);
  assert.ok(getImmutableObjectStoreDiagnosticsForTests().cacheKeys.length <= 8);
});

test("invalid CUP and stale cursor fail before reading immutable objects", async () => {
  await assert.rejects(selectOpenCupProjects({ cup: "short" }), /15 caratteri/);
  assert.deepEqual(getImmutableObjectStoreDiagnosticsForTests().cacheKeys, []);
  const first = await selectOpenCupProjects({ cup: "A12B34567890001", limit: 1 });
  const cursor = JSON.parse(Buffer.from(first.pagination.nextCursor, "base64url").toString("utf8"));
  cursor.releaseId = "f".repeat(64);
  resetImmutableObjectStoreForTests();
  await assert.rejects(selectOpenCupProjects({
    cup: "A12B34567890001", limit: 1, cursor: Buffer.from(canonical(cursor)).toString("base64url"),
  }), /rilascio diverso/i);
  assert.deepEqual(getImmutableObjectStoreDiagnosticsForTests().cacheKeys, []);
});

test("production manifests reject samples, incomplete indexes and unofficial provenance", async () => {
  const production = {
    ...fixtureManifest, acquiredAt: "2026-09-07T14:12:59Z", evidenceLabel: "documented-fact",
    landingUrl: "https://www.opencup.gov.it/portale/web/opencup/accesso-agli-open-data",
    lastModified: "2026-09-03T16:59:46Z", licenseStatus: "CC-BY-4.0",
    licenseUrl: "https://www.opencup.gov.it/portale/web/opencup/licenza-cc-by",
    observedAt: "2026-09-07T14:02:03Z", referenceDate: "2026-08-01",
    sourceUrl: "https://www.opencup.gov.it/portale/documents/21195/299152/OpendataProgetti.zip/release",
  };
  delete production.fixtureOnly;
  for (const change of [
    { sampleOnly: true, sampleDefinition: { kind: "global-prefix", rows: 3 } },
    { indexedRows: 2 }, { landingUrl: "https://example.invalid/opencup" },
    { sourceUrl: "javascript:alert(1)" }, { licenseUrl: "data:text/plain,CC-BY-4.0" },
    { licenseStatus: "unverified" },
  ]) {
    await writeFile(manifestPath, canonical({ ...production, ...change }) + "\n");
    await assert.rejects(probeOpenCupRelease(), /manifest OpenCUP/i);
    assert.deepEqual(getImmutableObjectStoreDiagnosticsForTests().cacheKeys, []);
  }
});

test("HTTP gate, query validation and source health follow the configured integration", async () => {
  assert.equal((await request()).status, 404);
  assert.equal((await SOURCE_HEALTH_ADAPTERS.opencup()).integration, "configured");
  SOURCE_POLICIES.opencup.integration = "active";
  const response = await request("cup=A12B34567890001&limit=1");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=300");
  const payload = await response.json();
  assert.equal(payload.rows[0].sourceRow, 1);
  assert.equal(payload.dataset.sourceMetadata.referencePeriod, null);
  assert.equal(payload.dataset.sourceMetadata.publicationDate, null);
  assert.equal((await SOURCE_HEALTH_ADAPTERS.opencup()).integration, "active");
  for (const query of ["cup=short", "cup=A12B34567890001&cup=A12B34567890001", "q=scuola", "limit=101"]) {
    const invalid = await request(query);
    assert.equal(invalid.status, 400, query);
    assert.equal(invalid.headers.get("cache-control"), "no-store");
  }
});

test("caller cancellation is not reported as an OpenCUP outage", async () => {
  SOURCE_POLICIES.opencup.integration = "active";
  const controller = new AbortController();
  const reason = new Error("client disconnected");
  controller.abort(reason);

  await assert.rejects(
    GET(new NextRequest(
      "http://localhost/api/opencup/progetti?cup=A12B34567890001",
      { signal: controller.signal },
    )),
    (error) => error === reason,
  );
});

test("missing storage and corrupt objects return a non-cacheable 503", async () => {
  SOURCE_POLICIES.opencup.integration = "active";
  delete process.env.DVNS_OPENCUP_PROJECTS_MANIFEST;
  assert.equal((await SOURCE_HEALTH_ADAPTERS.opencup()).reachability, "down");
  const missing = await request();
  assert.equal(missing.status, 503);
  assert.equal(missing.headers.get("cache-control"), "no-store");
  process.env.DVNS_OPENCUP_PROJECTS_MANIFEST = manifestPath;
  const indexPath = join(root, fixtureManifest.rootIndex.key);
  const original = await readFile(indexPath);
  const altered = Buffer.from(original);
  altered[0] ^= 1;
  await writeFile(indexPath, altered);
  try {
    const corrupt = await request();
    assert.equal(corrupt.status, 503);
    assert.equal(corrupt.headers.get("cache-control"), "no-store");
    assert.equal(corrupt.headers.get("retry-after"), "5");
  } finally {
    await writeFile(indexPath, original);
  }
});

test("valid hashes cannot bypass posting counts, redaction or response limits", async () => {
  const directory = JSON.parse(await readFile(join(root, fixtureManifest.rootIndex.key), "utf8"));
  const leaf = JSON.parse(await readFile(join(root, directory.children[0].node.key), "utf8"));
  leaf.entries[0].matchedRows = 3;
  directory.children[0].node = await object(leaf);
  await writeFile(manifestPath, canonical({ ...fixtureManifest, rootIndex: await object(directory) }) + "\n");
  await assert.rejects(selectOpenCupProjects({ cup: "A12B34567890001" }), /conteggio posting list/i);
  for (const [field, value, status] of [
    ["PIVA_CODFISCALE_SOG_TITOLARE", "00000000000", 503],
    ["COSTO_PROGETTO", "10,50", 503],
    ["DESCRIZIONE_SINTETICA_CUP", "x".repeat(760_000), 413],
  ]) {
    resetImmutableObjectStoreForTests();
    const rows = structuredClone(fixtureRows);
    rows[0].cells[field] = value;
    rehashRow(rows[0]);
    await replaceRows(rows);
    SOURCE_POLICIES.opencup.integration = "active";
    const response = await request("cup=A12B34567890001&limit=1");
    assert.equal(response.status, status, field);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});
