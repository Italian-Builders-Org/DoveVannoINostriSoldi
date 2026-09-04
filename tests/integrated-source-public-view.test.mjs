import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const contract = await import("../src/lib/integrated-source-contract.ts");
const loader = await import("../src/lib/integrated-sources.ts");
const view = await import("../src/lib/integrated-public-view.ts");
const datasetRoute = await import("../src/app/api/dati/[dataset]/route.ts");
const sourceRoute = await import("../src/app/api/fonti/catalogo/route.ts");

const releasePath = new URL("../data/source-ledger/release-proof.json", import.meta.url);
const execFileAsync = promisify(execFile);

test("the aggregate release proof closes the fixed public contract", async () => {
  const raw = JSON.parse(await readFile(releasePath, "utf8"));
  const release = contract.assertIntegratedReleaseProof(raw);
  assert.equal(release.complete, true);
  assert.equal(release.archiveReceipt.entries, 51_303);
  assert.equal(release.sourceCatalog.identities, 34_071);
  assert.equal(release.sourceCatalog.quarantined, 1_493);
  assert.equal(release.datasets.sourceRows, 13_321_128);
  assert.equal(release.datasets.publicRows, 338_782);
  assert.equal(release.datasets.catalogOnlyRows, 12_979_505);
  assert.equal(release.datasets.derivedOnlyRows, 2_841);

  const drifted = structuredClone(raw);
  drifted.datasets.publicRows -= 1;
  assert.throws(
    () => contract.assertIntegratedReleaseProof(drifted),
    /publicRows|rilascio|contratto atteso/,
  );
});

test("all 79 datasets remain visible and only catalog dispositions decide row access", async () => {
  const overview = await view.getIntegratedDataOverview();
  assert.equal(overview.complete, true);
  assert.equal(overview.datasets.length, 79);
  assert.equal(overview.datasets.filter((dataset) => dataset.queryable).length, 57);
  assert.equal(overview.datasets.reduce((sum, dataset) => sum + dataset.sourceRows, 0), 13_321_128);
  assert.equal(overview.datasets.reduce((sum, dataset) => sum + dataset.publicRows, 0), 338_782);
  assert.ok(overview.datasets.every((dataset) => dataset.sourceMetadata.holder.length > 0));
  assert.ok(overview.datasets.every((dataset) => /^\d{4}-\d{2}-\d{2}$/.test(dataset.sourceMetadata.checkedAt)));
  assert.ok(overview.datasets.every((dataset) => dataset.provenanceHref === `/fonti/copertura#dataset-${dataset.id}`));

  const consip = overview.datasets.find((dataset) => dataset.id === "consip-winners-2025");
  assert.equal(consip?.sourceMetadata.holder, "Consip S.p.A.");
  assert.deepEqual(consip?.sourceMetadata.canonicalUrls, ["https://dati.consip.it/"]);

  const undeclared = overview.datasets.filter(
    (dataset) => dataset.queryable && dataset.licenseStatus === "not-declared",
  );
  assert.ok(undeclared.length > 0);
  assert.ok(undeclared.every((dataset) => /non dichiarate/i.test(dataset.reuseNote)));

  const catalogOnly = await view.selectIntegratedDataset({
    datasetId: "benchmark-consulenze",
    q: "qualunque testo",
  });
  assert.equal(catalogOnly.dataset.queryable, false);
  assert.equal(catalogOnly.dataset.sourceRows, 56);
  assert.equal(catalogOnly.dataset.publicRows, 0);
  assert.equal(catalogOnly.rows.length, 0);
});

test("the sole dataset selector uses release-bound cursors and keeps offset only for unfiltered access", async () => {
  const result = await view.selectIntegratedDataset({
    datasetId: "consip-winners-2024",
    q: "2024",
    limit: "7",
  });
  assert.equal(result.dataset.queryable, true);
  assert.equal(result.limit, 7);
  assert.equal(result.rows.length, 7);
  assert.equal(result.matchedRows, null);
  assert.equal(result.pagination.scannedRows, 7);
  assert.equal(result.pagination.exhausted, false);
  assert.equal(typeof result.pagination.nextCursor, "string");
  assert.ok(result.rows.every((row) => row.cells.source_year === "2024"));
  assert.ok(
    result.rows.every((row) =>
      Object.values(row.cells).every((value) => value === null || typeof value === "string"),
    ),
  );

  const continued = await view.selectIntegratedDataset({
    datasetId: "consip-winners-2024",
    q: "2024",
    limit: 7,
    cursor: result.pagination.nextCursor,
  });
  assert.equal(continued.rows[0].sourceRow, result.rows.at(-1).sourceRow + 1);
  assert.equal(new Set([...result.rows, ...continued.rows].map((row) => row.id)).size, 14);

  await assert.rejects(
    view.selectIntegratedDataset({
      datasetId: "consip-winners-2024",
      q: "2025",
      cursor: result.pagination.nextCursor,
    }),
    /cursor.*dataset|cursor.*rilascio|cursor.*filtro/i,
  );
  await assert.rejects(
    view.selectIntegratedDataset({
      datasetId: "consip-winners-2025",
      q: "2024",
      cursor: result.pagination.nextCursor,
    }),
    view.IntegratedQueryError,
  );
  const cursorPayload = JSON.parse(
    Buffer.from(result.pagination.nextCursor, "base64url").toString("utf8"),
  );
  cursorPayload.releaseSetSha256 = "0".repeat(64);
  const staleCursor = Buffer.from(
    contract.canonicalJson(cursorPayload),
    "utf8",
  ).toString("base64url");
  await assert.rejects(
    view.selectIntegratedDataset({
      datasetId: "consip-winners-2024",
      q: "2024",
      cursor: staleCursor,
    }),
    /cursor.*rilascio|cursor.*dataset|cursor.*filtro/i,
  );
  await assert.rejects(
    view.selectIntegratedDataset({
      datasetId: "consip-winners-2024",
      q: "2024",
      cursor: "a".repeat(513),
    }),
    view.IntegratedQueryError,
  );
  await assert.rejects(
    view.selectIntegratedDataset({
      datasetId: "consip-winners-2024",
      q: "2024",
      cursor: `${result.pagination.nextCursor}=`,
    }),
    view.IntegratedQueryError,
  );
  const extraKeyCursor = Buffer.from(
    contract.canonicalJson({ ...cursorPayload, unexpected: true }),
    "utf8",
  ).toString("base64url");
  await assert.rejects(
    view.selectIntegratedDataset({
      datasetId: "consip-winners-2024",
      q: "2024",
      cursor: extraKeyCursor,
    }),
    /cursor.*canonico/i,
  );
  const traversalCursor = Buffer.from(
    contract.canonicalJson({ ...cursorPayload, datasetId: "../../etc/passwd" }),
    "utf8",
  ).toString("base64url");
  await assert.rejects(
    view.selectIntegratedDataset({
      datasetId: "consip-winners-2024",
      q: "2024",
      cursor: traversalCursor,
    }),
    /cursor.*dataset|cursor.*rilascio|cursor.*filtro/i,
  );
  await assert.rejects(
    view.selectIntegratedDataset({
      datasetId: "consip-winners-2024",
      q: "2024",
      offset: 0,
    }),
    /offset.*ricerca|ricerca.*cursor/i,
  );

  const finalPage = await view.selectIntegratedDataset({
    datasetId: "parti-atti",
    limit: 100,
    offset: 159_400,
  });
  assert.equal(finalPage.rows.length, 93);
  assert.equal(finalPage.rows[0].sourceRow, 159_401);
  assert.equal(finalPage.rows.at(-1).sourceRow, 159_493);
  assert.equal(finalPage.matchedRows, 159_493);
  assert.equal(finalPage.pagination.nextCursor, null);
  assert.equal(finalPage.pagination.exhausted, true);

  await assert.rejects(
    view.selectIntegratedDataset({ datasetId: "consip-winners-2024", limit: 101 }),
    view.IntegratedQueryError,
  );
  await assert.rejects(
    view.selectIntegratedDataset({ datasetId: "parti-atti", offset: 159_494 }),
    view.IntegratedQueryError,
  );
  await assert.rejects(
    view.selectIntegratedDataset({ datasetId: "parti-atti", offset: 159_493 }),
    view.IntegratedQueryError,
  );
  await assert.rejects(
    view.selectIntegratedDataset({ datasetId: "consip-winners-2024", q: ["a", "b"] }),
    view.IntegratedQueryError,
  );
  await assert.rejects(
    view.selectIntegratedDataset({ datasetId: "dataset-inesistente" }),
    view.IntegratedDatasetNotFoundError,
  );
});

test("a sparse search stops at eight chunks and continues without a false empty result", async () => {
  loader.resetIntegratedDatasetLoaderDiagnosticsForTests();
  const result = await view.selectIntegratedDataset({
    datasetId: "parti-atti",
    q: "query-sintetica-che-non-puo-comparire-9f52f21e",
    limit: 100,
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.matchedRows, null);
  assert.equal(result.pagination.scannedRows, 8_000);
  assert.equal(result.pagination.scanStartSourceRow, 1);
  assert.equal(result.pagination.scanEndSourceRow, 8_000);
  assert.equal(result.pagination.exhausted, false);
  assert.equal(typeof result.pagination.nextCursor, "string");
  const diagnostics = loader.getIntegratedDatasetLoaderDiagnosticsForTests();
  assert.equal(diagnostics.completedChunkLoads, 8);
  assert.ok(diagnostics.maxObservedChunkRawBytes <= 2 * 1024 * 1024);

  const continued = await view.selectIntegratedDataset({
    datasetId: "parti-atti",
    q: "query-sintetica-che-non-puo-comparire-9f52f21e",
    limit: 100,
    cursor: result.pagination.nextCursor,
  });
  assert.equal(continued.rows.length, 0);
  assert.equal(continued.pagination.scanStartSourceRow, 8_001);
  assert.equal(continued.pagination.scanEndSourceRow, 16_000);
  assert.equal(continued.pagination.scannedRows, 8_000);
});

test("bounded file and decoder gates reject symlinks, oversize input, invalid UTF-8 and gzip bombs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dvns-integrated-loader-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const regular = join(directory, "regular.jsonl");
  const linked = join(directory, "linked.jsonl");
  await writeFile(regular, Buffer.from("{}\n", "utf8"));
  await symlink(regular, linked);

  await assert.rejects(loader.readRegularFileForTests(linked, 16), /non regolare/);
  await assert.rejects(loader.readRegularFileForTests(regular, 2), /non regolare/);
  assert.throws(
    () => loader.parseCanonicalJsonLinesForTests(Buffer.from([0xff, 0x0a])),
    /UTF-8/,
  );
  await assert.rejects(
    loader.gunzipDatasetChunkForTests(
      gzipSync(Buffer.alloc(2 * 1024 * 1024 + 1, 0x61)),
    ),
    /oltre limite/,
  );
});

test("every queryable artifact passes schema, hash, decompression and URL gates", async () => {
  const overview = await view.getIntegratedDataOverview();
  const queryable = overview.datasets.filter((dataset) => dataset.queryable);
  const checked = await Promise.all(
    queryable.map((dataset) =>
      view.selectIntegratedDataset({ datasetId: dataset.id, limit: 1 }),
    ),
  );
  assert.equal(checked.length, 57);
  assert.equal(
    checked.reduce((sum, result) => sum + result.dataset.publicRows, 0),
    338_782,
  );
  assert.ok(checked.every((result) => result.rows.length === 1));
});

test("a three-row preview of the largest dataset loads exactly one bounded chunk", async () => {
  loader.resetIntegratedDatasetLoaderDiagnosticsForTests();
  const preview = await view.selectIntegratedDataset({ datasetId: "parti-atti", limit: 3 });
  assert.equal(preview.rows.length, 3);
  const diagnostics = loader.getIntegratedDatasetLoaderDiagnosticsForTests();
  assert.equal(diagnostics.completedChunkLoads, 1);
  assert.ok(diagnostics.maxObservedChunkRawBytes > 0);
  assert.ok(diagnostics.maxObservedChunkRawBytes <= 2 * 1024 * 1024);
});

test("dataset artifacts are deduplicated only in flight and bounded to two concurrent loads", async () => {
  loader.resetIntegratedDatasetLoaderDiagnosticsForTests();
  const bundle = await loader.loadIntegratedSourceBundle();
  const queryable = bundle.catalog.datasets.filter(
    (dataset) => dataset.publication === "rows" || dataset.publication === "source-index",
  );
  const firstDataset = queryable[0];
  assert.ok(firstDataset);

  const firstLoad = loader.loadIntegratedDatasetChunk(bundle, firstDataset, 0);
  const duplicateLoad = loader.loadIntegratedDatasetChunk(bundle, firstDataset, 0);
  assert.notStrictEqual(duplicateLoad, firstLoad);
  const firstChunk = await firstLoad;
  assert.strictEqual(await duplicateLoad, firstChunk);
  let diagnostics = loader.getIntegratedDatasetLoaderDiagnosticsForTests();
  assert.equal(diagnostics.maxConcurrentLoads, 2);
  assert.equal(diagnostics.maxPendingLoads, 64);
  assert.equal(diagnostics.maxConsumersPerChunk, 64);
  assert.equal(diagnostics.activeLoads, 0);
  assert.equal(diagnostics.queuedLoads, 0);
  assert.deepEqual(diagnostics.inFlightChunkKeys, []);
  assert.equal(diagnostics.completedChunkLoads, 1);

  const secondLoad = loader.loadIntegratedDatasetChunk(bundle, firstDataset, 0);
  assert.notStrictEqual(secondLoad, firstLoad);
  const secondChunk = await secondLoad;
  assert.notStrictEqual(secondChunk, firstChunk);

  const pending = queryable.map((dataset) =>
    loader.loadIntegratedDatasetChunk(bundle, dataset, 0),
  );
  const whileLoading = loader.getIntegratedDatasetLoaderDiagnosticsForTests();
  assert.equal(whileLoading.maxConcurrentLoads, 2);
  assert.equal(whileLoading.activeLoads, 2);
  assert.equal(whileLoading.queuedLoads, queryable.length - 2);
  assert.equal(whileLoading.inFlightChunkKeys.length, queryable.length);
  await Promise.all(pending);
  diagnostics = loader.getIntegratedDatasetLoaderDiagnosticsForTests();
  assert.equal(diagnostics.activeLoads, 0);
  assert.equal(diagnostics.queuedLoads, 0);
  assert.deepEqual(diagnostics.inFlightChunkKeys, []);
  assert.ok(diagnostics.maxObservedChunkRawBytes <= 2 * 1024 * 1024);
});

test("the bounded load queue rejects overload and removes an abandoned queued load", async () => {
  loader.resetIntegratedDatasetLoaderDiagnosticsForTests();
  const bundle = await loader.loadIntegratedSourceBundle();
  const dataset = bundle.datasetsById.get("parti-atti");
  assert.ok(dataset);
  const controllers = Array.from({ length: 66 }, () => new AbortController());
  const pending = controllers.map((controller, ordinal) =>
    loader.loadIntegratedDatasetChunk(bundle, dataset, ordinal, controller.signal),
  );
  await assert.rejects(
    loader.loadIntegratedDatasetChunk(bundle, dataset, 66),
    loader.IntegratedLoadOverloadedError,
  );
  controllers[65].abort();
  await assert.rejects(pending[65], /annullato/);
  await new Promise((resolve) => setImmediate(resolve));
  const replacement = loader.loadIntegratedDatasetChunk(bundle, dataset, 66);
  await Promise.all([...pending.slice(0, 65), replacement]);
  const diagnostics = loader.getIntegratedDatasetLoaderDiagnosticsForTests();
  assert.equal(diagnostics.activeLoads, 0);
  assert.equal(diagnostics.queuedLoads, 0);
  assert.deepEqual(diagnostics.inFlightChunkKeys, []);
});

test("enumerating every queryable dataset does not retain all parsed row arrays", async () => {
  const registerUrl = new URL("./helpers/register-ts-alias.mjs", import.meta.url).href;
  const loaderUrl = new URL("../src/lib/integrated-sources.ts", import.meta.url).href;
  const program = `
    await import(${JSON.stringify(registerUrl)});
    const loader = await import(${JSON.stringify(loaderUrl)});
    const collect = () => {
      for (let index = 0; index < 4; index += 1) global.gc();
      return process.memoryUsage();
    };
    const bundle = await loader.loadIntegratedSourceBundle();
    const datasets = bundle.catalog.datasets.filter(
      (dataset) => dataset.publication === "rows" || dataset.publication === "source-index",
    );
    const before = collect();
    await (async () => {
      const loaded = await Promise.all(
        datasets.map((dataset) => loader.loadIntegratedDatasetChunk(bundle, dataset, 0)),
      );
      if (loaded.length !== 57) throw new Error("Unexpected queryable dataset count");
    })();
    await new Promise((resolve) => setImmediate(resolve));
    const after = collect();
    const diagnostics = loader.getIntegratedDatasetLoaderDiagnosticsForTests();
    process.stdout.write(JSON.stringify({
      heapDelta: after.heapUsed - before.heapUsed,
      diagnostics,
    }));
  `;
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--expose-gc", "--experimental-strip-types", "--input-type=module", "--eval", program],
    {
      cwd: new URL("..", import.meta.url),
      maxBuffer: 1024 * 1024,
    },
  );
  const measured = JSON.parse(stdout);
  assert.ok(
    measured.heapDelta < 32 * 1024 * 1024,
    `retained heap grew by ${measured.heapDelta} bytes`,
  );
  assert.equal(measured.diagnostics.maxConcurrentLoads, 2);
  assert.equal(measured.diagnostics.activeLoads, 0);
  assert.equal(measured.diagnostics.queuedLoads, 0);
  assert.deepEqual(measured.diagnostics.inFlightChunkKeys, []);
  assert.ok(measured.diagnostics.maxObservedChunkRawBytes <= 2 * 1024 * 1024);
});

test("all quarantined source identities are traversable without their source value", async () => {
  const result = await view.selectPublicSourceCatalog({
    disposition: "quarantined",
    limit: 100,
  });
  assert.equal(result.matchedSources, 1_493);
  assert.equal(result.sources.length, 100);
  assert.ok(result.sources.every((source) => source.disposition === "quarantined"));
  assert.ok(result.sources.every((source) => source.publicValue === null));
  assert.ok(result.sources.every((source) => source.id.startsWith("src_")));
});

test("dataset and source APIs share the selectors and return bounded controlled errors", async () => {
  const success = await datasetRoute.GET(
    new Request("https://example.test/api/dati/consip-winners-2024?limit=3&q=2024"),
    { params: Promise.resolve({ dataset: "consip-winners-2024" }) },
  );
  assert.equal(success.status, 200);
  const successBody = await success.json();
  assert.equal(successBody.rows.length, 3);
  assert.equal(successBody.dataset.id, "consip-winners-2024");
  assert.equal(successBody.matchedRows, null);
  assert.equal(typeof successBody.pagination.nextCursor, "string");

  const continued = await datasetRoute.GET(
    new Request(
      `https://example.test/api/dati/consip-winners-2024?limit=3&q=2024&cursor=${encodeURIComponent(successBody.pagination.nextCursor)}`,
    ),
    { params: Promise.resolve({ dataset: "consip-winners-2024" }) },
  );
  assert.equal(continued.status, 200);
  const continuedBody = await continued.json();
  assert.equal(continuedBody.rows[0].sourceRow, successBody.rows.at(-1).sourceRow + 1);

  const finalPage = await datasetRoute.GET(
    new Request("https://example.test/api/dati/parti-atti?limit=100&offset=159400"),
    { params: Promise.resolve({ dataset: "parti-atti" }) },
  );
  assert.equal(finalPage.status, 200);
  const finalBody = await finalPage.json();
  assert.equal(finalBody.rows.length, 93);
  assert.equal(finalBody.rows.at(-1).sourceRow, 159_493);
  assert.equal(finalBody.pagination.exhausted, true);

  const accounted = await datasetRoute.GET(
    new Request("https://example.test/api/dati/benchmark-consulenze"),
    { params: Promise.resolve({ dataset: "benchmark-consulenze" }) },
  );
  assert.equal(accounted.status, 200);
  assert.equal((await accounted.json()).dataset.sourceRows, 56);

  const invalid = await datasetRoute.GET(
    new Request("https://example.test/api/dati/consip-winners-2024?limit=101"),
    { params: Promise.resolve({ dataset: "consip-winners-2024" }) },
  );
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /limit/);

  const invalidCursor = await datasetRoute.GET(
    new Request("https://example.test/api/dati/parti-atti?cursor=not-a-valid-cursor"),
    { params: Promise.resolve({ dataset: "parti-atti" }) },
  );
  assert.equal(invalidCursor.status, 400);
  assert.match((await invalidCursor.json()).error, /cursor/);

  const missing = await datasetRoute.GET(
    new Request("https://example.test/api/dati/non-esiste"),
    { params: Promise.resolve({ dataset: "non-esiste" }) },
  );
  assert.equal(missing.status, 404);

  const sources = await sourceRoute.GET(
    new Request("https://example.test/api/fonti/catalogo?disposition=quarantined&limit=2"),
  );
  assert.equal(sources.status, 200);
  const sourceBody = await sources.json();
  assert.equal(sourceBody.matchedSources, 1_493);
  assert.equal(sourceBody.sources.length, 2);
  assert.ok(sourceBody.sources.every((source) => source.publicValue === null));
});

test("the server boundary and pages preserve missing, zero and async Next route contracts", async () => {
  const files = await Promise.all([
    readFile(new URL("../src/lib/integrated-sources.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/integrated-public-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/dati/[dataset]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/dati/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/fonti/copertura/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/fonti/catalogo/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/editorial-topic-page.tsx", import.meta.url), "utf8"),
  ]);
  const [loader, publicView, detail, catalog, coverage, sources, editorial] = files;
  assert.match(loader, /^import "server-only";/);
  assert.match(publicView, /^import "server-only";/);
  assert.match(detail, /await Promise\.all\(\[params, searchParams\]\)/);
  assert.match(detail, /value === ""/);
  assert.match(detail, /Dato non presente/);
  assert.match(detail, /value === "0"/);
  assert.match(detail, /<caption>/);
  assert.match(detail, /role="region"/);
  assert.match(detail, /Fonte, riuso e limiti/);
  assert.match(detail, /URL canonico non disponibile/);
  assert.match(detail, /URL non disponibile/);
  assert.doesNotMatch(detail, /href=\{dataset\.provenanceHref\}/);
  assert.match(detail, /dataset\.sourceMetadata\.canonicalUrls\.map/);
  assert.match(detail, /row\.sourceUrls\.map/);
  assert.match(detail, /DatasetInsightPanel|loadDatasetInsights/);
  assert.match(detail, /Niente da scorrere qui|Torna ai numeri da leggere/);
  assert.match(catalog, /Tutti i dataset integrati/);
  assert.match(catalog, /parseCatalogQuery/);
  assert.match(catalog, /catalogViewHref/);
  assert.match(catalog, /filterBar/);
  assert.match(catalog, /Numeri da leggere/);
  assert.match(catalog, /Cosa manca ancora/);
  assert.match(coverage, /51\.303|observedEntries/);
  assert.match(coverage, /URL canonico non disponibile/);
  assert.doesNotMatch(coverage, /Fonti puntuali e limiti/);
  assert.match(sources, /Valore non pubblicato/);
  assert.match(editorial, /URL non disponibile/);
  assert.doesNotMatch(editorial, /href=\{result\.dataset\.provenanceHref\}/);
  assert.match(editorial, /row\.sourceUrls\[0\]/);
  assert.match(editorial, /sourceMetadata\.canonicalUrls\[0\]/);
  assert.match(editorial, /DatasetInsightPanel|loadDatasetInsights/);

  const publicSurface = files.join("\n");
  assert.doesNotMatch(publicSurface, /\/Users\//);
  assert.doesNotMatch(publicSurface, /\.tar\.gz/i);
});

test("the dataset sheet puts insights and rows before collapsed provenance", async () => {
  const detail = await readFile(
    new URL("../src/app/dati/[dataset]/page.tsx", import.meta.url),
    "utf8",
  );
  const insight = detail.indexOf("DatasetInsightPanel");
  const rows = detail.indexOf('id="dataset-rows-title"');
  const meta = detail.indexOf("Fonte, riuso e limiti");
  assert.ok(insight > 0, "sezione assente: insight");
  assert.ok(rows > 0, "sezione assente: rows");
  assert.ok(meta > 0, "sezione assente: meta");
  assert.ok(insight < rows, "gli insight devono precedere le righe");
  assert.ok(rows < meta, "le righe devono precedere la provenienza");
  // The three value conventions travel with the cells they explain.
  assert.match(detail, /valueLegend/);
  // Amount columns are classified in the shared helper so n.d. does not
  // hide a canone/importo field, and new *_eur headers stay formatted.
  assert.match(detail, /amountColumnKeys/);
  assert.match(detail, /formatIntegratedAmountCell/);
  assert.doesNotMatch(detail, /Come leggere questa scheda/);
});

test("the integrated catalogue indexes its domains and names them in Italian", async () => {
  const [catalogPage, css] = await Promise.all([
    readFile(new URL("../src/app/dati/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/dati/dati.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(catalogPage, /INTEGRATED_DOMAIN_ORDER/);
  assert.match(catalogPage, /integratedDomainLabel/);
  assert.match(catalogPage, /domainIndex/);
  assert.match(catalogPage, /viewSwitch/);
  assert.match(catalogPage, /Da controllare/);
  // No page may print a raw domain slug as a heading.
  assert.doesNotMatch(catalogPage, /DOMAIN_LABELS\[domain\] \?\? domain/);
  assert.match(css, /\.domainIndex \{/);
  assert.match(css, /\.viewSwitch \{/);
});
