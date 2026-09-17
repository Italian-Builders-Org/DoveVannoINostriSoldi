import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import "./helpers/register-ts-alias.mjs";

const {
  MAX_GOVERNMENT_SCORECARD_FUNCTION_RESPONSE_BYTES,
  assertGovernmentScorecardFunctionResponseSize,
  getGovernmentScorecardDownload,
  getGovernmentScorecardDownloadManifest,
  reconcileGovernmentScorecardPageProvenance,
  serializeGovernmentScorecardDownloadJson,
  validateGovernmentScorecardDownloadManifest,
} = await import("../src/lib/government-scorecard-downloads.ts");
const { GET: GETGovernmentScorecardDownloadManifest } = await import("../src/app/api/governi/dati/route.ts");
const { GET: GETGovernmentScorecardDownload } = await import("../src/app/api/governi/dati/[download]/route.ts");
const {
  GOVERNMENT_SCORECARD_DOWNLOADS,
  GOVERNMENT_SCORECARD_DOWNLOAD_MANIFEST_HREF,
} = await import("../src/lib/government-scorecard-download-links.ts");

const EXPECTED_DOWNLOAD_IDS = [
  "score-data",
  "page-data",
  "methodology",
  "chronology",
  "score-provenance",
  "page-provenance",
];

test("the public download catalog offers one direct attachment link per artifact", () => {
  assert.deepEqual(
    GOVERNMENT_SCORECARD_DOWNLOADS.map((download) => download.id),
    EXPECTED_DOWNLOAD_IDS,
  );
  assert.ok(GOVERNMENT_SCORECARD_DOWNLOADS.every(
    (download) => download.href === `${GOVERNMENT_SCORECARD_DOWNLOAD_MANIFEST_HREF}/${download.id}`,
  ));
  assert.ok(GOVERNMENT_SCORECARD_DOWNLOADS.every((download) => download.filename.length > 0));
  assert.ok(GOVERNMENT_SCORECARD_DOWNLOADS.every((download) => download.label.length > 0));
  assert.ok(GOVERNMENT_SCORECARD_DOWNLOADS.every((download) => download.description.length > 0));
});

test("the public manifest exposes only the closed scorecard download contract", () => {
  const manifest = getGovernmentScorecardDownloadManifest();

  assert.equal(manifest.schema_version, 1);
  assert.deepEqual(manifest.data_roles, [
    "score_data",
    "page_data",
    "editorial_context",
  ]);
  assert.deepEqual(manifest.downloads.map((download) => download.id), EXPECTED_DOWNLOAD_IDS);
  assert.deepEqual(
    [...new Set(manifest.downloads.map((download) => download.category))].sort(),
    ["chronology", "data", "methodology", "provenance"],
  );
  assert.ok(manifest.downloads.every((download) => download.format === "json"));
  assert.deepEqual(
    manifest.downloads.map(({ id, compression }) => [id, compression]),
    EXPECTED_DOWNLOAD_IDS.map((id) => [id, id === "page-data" ? "gzip" : "none"]),
  );
  assert.deepEqual(
    manifest.downloads.map(({ id, content_type }) => [id, content_type]),
    EXPECTED_DOWNLOAD_IDS.map((id) => [
      id,
      id === "page-data" ? "application/gzip" : "application/json; charset=utf-8",
    ]),
  );
  assert.ok(manifest.downloads.every((download) => download.href === `/api/governi/dati/${download.id}`));
  assert.ok(manifest.downloads.every((download) => download.bytes > 0));
  assert.ok(manifest.downloads.every((download) => /^[0-9a-f]{64}$/.test(download.sha256)));
  assert.equal(manifest.verification.offline.command, "npm run government-scorecard:verify");
  assert.match(manifest.verification.offline.scope, /snapshot/i);
  assert.match(manifest.verification.online.scope, /fonti ufficiali/i);
});

test("page-data is a deterministic gzip of the canonical JSON within the Function limit", () => {
  const canonicalPageData = serializeGovernmentScorecardDownloadJson(JSON.parse(readFileSync(
    new URL("../src/data/generated/government-scorecard-page.json", import.meta.url),
    "utf8",
  )));
  const first = getGovernmentScorecardDownload("page-data");
  const second = getGovernmentScorecardDownload("page-data");
  const manifestEntry = getGovernmentScorecardDownloadManifest().downloads.find(
    (download) => download.id === "page-data",
  );

  assert.ok(first);
  assert.ok(second);
  assert.ok(manifestEntry);
  assert.equal(first.filename, "government-scorecard-page-data.json.gz");
  assert.equal(first.contentType, "application/gzip");
  assert.equal(first.format, "json");
  assert.equal(first.compression, "gzip");
  assert.ok(first.body instanceof Uint8Array);
  assert.deepEqual(first.body, second.body);
  assert.equal(gunzipSync(first.body).toString("utf8"), canonicalPageData);
  assert.equal(first.bytes, first.body.byteLength);
  assert.equal(first.sha256, createHash("sha256").update(first.body).digest("hex"));
  assert.equal(manifestEntry.bytes, first.bytes);
  assert.equal(manifestEntry.sha256, first.sha256);
  assert.equal(manifestEntry.content_type, "application/gzip");
  assert.ok(first.bytes <= MAX_GOVERNMENT_SCORECARD_FUNCTION_RESPONSE_BYTES);
});

test("the Function response limit fails closed above 4,500,000 bytes", () => {
  assert.equal(MAX_GOVERNMENT_SCORECARD_FUNCTION_RESPONSE_BYTES, 4_500_000);
  assert.doesNotThrow(() => assertGovernmentScorecardFunctionResponseSize(4_500_000, "boundary"));
  assert.throws(
    () => assertGovernmentScorecardFunctionResponseSize(4_500_001, "oversize"),
    /4,?500,?000|limite|oversize/i,
  );
  for (const id of EXPECTED_DOWNLOAD_IDS) {
    assert.ok(getGovernmentScorecardDownload(id).bytes <= MAX_GOVERNMENT_SCORECARD_FUNCTION_RESPONSE_BYTES);
  }
});

test("every score and chart indicator has complete reconstruction provenance", () => {
  const manifest = getGovernmentScorecardDownloadManifest();

  assert.equal(manifest.indicators.filter((indicator) => indicator.data_role === "score_data").length, 6);
  assert.equal(manifest.indicators.filter((indicator) => indicator.data_role === "page_data").length, 9);
  for (const indicator of manifest.indicators) {
    assert.ok(indicator.indicator_id.length > 0);
    assert.ok(indicator.source_owner.length > 0);
    assert.ok(indicator.dataset_code.length > 0);
    assert.ok(indicator.series_or_query.length > 0);
    assert.ok(indicator.unit.length > 0);
    assert.ok(indicator.frequency.length > 0);
    assert.ok(indicator.period.length > 0);
    assert.ok(indicator.vintage.length > 0);
    assert.ok(indicator.transformation.length > 0);
    assert.match(indicator.acquired_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(indicator.sha256, /^[0-9a-f]{64}$/);
    assert.ok(indicator.record_download_id.length > 0);
    assert.ok(indicator.provenance_download_id.length > 0);
  }
  assert.deepEqual(manifest.editorial_context, {
    data_role: "editorial_context",
    score_impact: "none",
    record_download_id: "page-data",
    provenance_download_id: "page-provenance",
    note: manifest.editorial_context.note,
  });
});

test("the manifest fails closed on drifted hashes, missing downloads or missing provenance", () => {
  const manifest = getGovernmentScorecardDownloadManifest();

  const badHash = structuredClone(manifest);
  badHash.downloads[0].sha256 = "0".repeat(64);
  assert.throws(() => validateGovernmentScorecardDownloadManifest(badHash), /hash|sha256/i);

  const missingDownload = structuredClone(manifest);
  missingDownload.downloads.pop();
  assert.throws(() => validateGovernmentScorecardDownloadManifest(missingDownload), /download|manifest/i);

  const missingProvenance = structuredClone(manifest);
  delete missingProvenance.indicators[0].acquired_at;
  assert.throws(() => validateGovernmentScorecardDownloadManifest(missingProvenance), /provenienza|manifest|acquired/i);
});

test("download lookup is an exact allowlist", () => {
  for (const id of EXPECTED_DOWNLOAD_IDS) {
    const download = getGovernmentScorecardDownload(id);
    assert.ok(download);
    assert.equal(download.id, id);
  }
  assert.equal(getGovernmentScorecardDownload("unknown"), null);
  assert.equal(getGovernmentScorecardDownload("../government-scorecard.json"), null);
  assert.equal(getGovernmentScorecardDownload("%2e%2e%2fgovernment-scorecard.json"), null);
});

test("the manifest route returns the open index with attachment headers", async () => {
  const response = await GETGovernmentScorecardDownloadManifest();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=3600, stale-while-revalidate=86400");
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="government-scorecard-downloads.json"');
  assert.equal(response.headers.get("content-length"), String(Buffer.byteLength(await response.clone().text())));
  assert.ok(Number(response.headers.get("content-length")) <= MAX_GOVERNMENT_SCORECARD_FUNCTION_RESPONSE_BYTES);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(JSON.parse(await response.text()), getGovernmentScorecardDownloadManifest());
});

test("registered downloads use attachment headers and exact bytes", async () => {
  for (const id of EXPECTED_DOWNLOAD_IDS) {
    const expected = getGovernmentScorecardDownload(id);
    const response = await GETGovernmentScorecardDownload(
      new Request(`https://example.test/api/governi/dati/${id}`),
      { params: Promise.resolve({ download: id }) },
    );

    assert.ok(expected);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), expected.contentType);
    assert.equal(response.headers.get("content-disposition"), `attachment; filename="${expected.filename}"`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("content-length"), String(expected.bytes));
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(
      typeof expected.body === "string" ? Buffer.from(expected.body) : expected.body,
    ));
  }
});

test("the HTTP boundary returns 404 for unknown and traversal-shaped identifiers", async () => {
  for (const download of [
    "unknown",
    "../government-scorecard.json",
    "%2e%2e%2fgovernment-scorecard.json",
    "score-data/../../etc/passwd",
  ]) {
    const response = await GETGovernmentScorecardDownload(
      new Request("https://example.test/api/governi/dati/invalid"),
      { params: Promise.resolve({ download }) },
    );
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type"), /^application\/json/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("offline reconciliation traces every displayed value and context item to frozen provenance", () => {
  const result = reconcileGovernmentScorecardPageProvenance();

  assert.equal(result.governments, 17);
  assert.equal(result.charts, 17 * 9);
  assert.ok(result.displayed_values > 10_000);
  assert.ok(result.context_items > 100);
  assert.equal(result.source_receipts, 10);
});

test("the canonical guide documents one offline verification command and the online refresh limit", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const guide = readFileSync(
    new URL("../docs/PAGELLA_POLITICO_ECONOMICA.md", import.meta.url),
    "utf8",
  );

  assert.match(packageJson.scripts["government-scorecard:verify"], /check-government-scorecard-artifacts\.py/);
  assert.match(packageJson.scripts["government-scorecard:verify"], /tests\/government-scorecard-/);
  assert.match(guide, /npm run government-scorecard:verify/);
  assert.match(guide, /\/api\/governi\/dati\/score-data/);
  assert.match(guide, /government-scorecard-page-data\.json\.gz/);
  assert.match(guide, /gzip/i);
  assert.match(guide, /4[.]500[.]000 byte/);
  assert.match(guide, /validazione offline[\s\S]*snapshot congelati/i);
  assert.match(guide, /refresh online[\s\S]*fonti ufficiali/i);
  assert.match(guide, /non conserva[\s\S]*payload raw/i);
});
