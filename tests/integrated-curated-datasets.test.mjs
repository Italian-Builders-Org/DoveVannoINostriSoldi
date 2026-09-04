import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
} from "node:fs";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { PYTHON_BIN } from "./helpers/python.mjs";


const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const specPath = path.join(
  repositoryRoot,
  "scripts/etl/specs/integrated-curated-datasets.source.json",
);
const catalogPath = path.join(repositoryRoot, "src/data/generated/integrated/catalog.json");
const rowsDirectory = path.join(repositoryRoot, "src/data/generated/integrated/rows");
const receiptsDirectory = path.join(repositoryRoot, "data/source-ledger/datasets");
const proofPath = path.join(repositoryRoot, "data/source-ledger/dataset-proof.json");
const rowChunkRows = 1_000;
const rowChunkMaxRawBytes = 2 * 1024 * 1024;

function rowChunkName(datasetId, ordinal) {
  return `${datasetId}.part-${String(ordinal).padStart(5, "0")}.jsonl.gz`;
}

const mandatoryDatasetIds = [
  "affidamenti-diretti",
  "affitti-immobili",
  "auto-welfare",
  "benchmark-consulenze",
  "benchmark-contratti",
  "benchmark-istituzioni",
  "buchi-organico",
  "buchi-trasparenza",
  "c8-a",
  "c8-b",
  "c8-c",
  "c8-d",
  "campagne-pubblicita",
  "capitoli-consulenze",
  "capitoli-consulenze-copertura",
  "cataloghi-url-supplementari",
  "catalogo-url-trasparenza",
  "cdp-compensi-sedi",
  "cig-aggiudicatari-extra",
  "cig-autorita",
  "cig-ministeri",
  "collaboratori-extra",
  "collaboratori-frammenti",
  "comparazione-ue",
  "comparazione-ue-staff-funzioni",
  "consip-contratti-riconciliati",
  "consip-ranking",
  "consip-snapshot-strutturati",
  "consip-winners-2024",
  "consip-winners-2025",
  "consip-winners-2026",
  "consulenze-legali",
  "consulenze-pnrr",
  "corte-conti",
  "cv-incarichi",
  "eventi-convegni",
  "fuori-consip",
  "gruppi-vincitori",
  "incarichi-nominativi-buchi-copertura",
  "incarichi-nominativi-buchi-riga",
  "incarichi-nominativi-shard",
  "indennita-organi",
  "indice-enti",
  "missioni",
  "missioni-cdp",
  "missioni-cdp-buchi",
  "nominativi-incarichi",
  "openbdap-capitoli-2024-2026",
  "openbdap-consulenze-ce",
  "openbdap-personale-piani-gestione",
  "opencup-census-window",
  "opencup-metadati",
  "opencup-progetti-bulk",
  "opencup-soggetti",
  "opencup-trend-area-soggetto",
  "partecipate-at-focus",
  "partecipate-statali-focus",
  "partecipate-statali-perimetro",
  "parti-atti",
  "personale",
  "problemi-trasparenza",
  "procurement-affidamenti-c1-extra",
  "procurement-atti-mimit",
  "procurement-difesa-direzioni",
  "procurement-difesa-procedimenti",
  "procurement-indici-mimit",
  "procurement-mimit-dork",
  "procurement-partecipate",
  "rimborsi-spese",
  "rimborsi-spese-buchi",
  "rinnovi-proroghe",
  "segnalazioni",
  "segnalazioni-card",
  "segnalazioni-parti",
  "staff-funzioni",
  "trasparenza-parchi-l38",
  "url-morti",
  "vincitori",
  "vincitori-cig",
].sort();

const expectedTotals = {
  catalogOnlyRows: 12_979_505,
  datasets: 79,
  derivedOnlyRows: 2_841,
  publicRows: 338_782,
  sourceBytes: 2_537_014_778,
  sourceRows: 13_321_128,
};

// Non-null periods are admitted only when a dedicated temporal field in the
// pinned source (anno, data, esercizio, dal/al, periodo_*, source_year or
// data_aggiornamento) or an explicit derived-dataset contract supplies the
// boundary. Narrative text and years embedded only in URLs are not used.
const expectedReferencePeriods = {
  "affidamenti-diretti": "2024-2026",
  "affitti-immobili": "2024-2026",
  "auto-welfare": "2024-2026",
  "campagne-pubblicita": "2024-2026",
  "capitoli-consulenze": "2024-2025",
  "cig-autorita": "2017 e 2024-2026",
  "cig-ministeri": "2024-2026",
  "collaboratori-extra": "date dichiarate negli incarichi: 2016-2029",
  "comparazione-ue": "2024-2025",
  "comparazione-ue-staff-funzioni": "2024-2026",
  "consip-contratti-riconciliati": "2024-2026",
  "consip-ranking": "2024-2026",
  "consip-snapshot-strutturati": "2024-2026",
  "consip-winners-2024": "2024",
  "consip-winners-2025": "2025",
  "consip-winners-2026": "2026",
  "consulenze-legali": "2024-2026",
  "cv-incarichi": "date dichiarate negli incarichi: 2020-2029",
  "eventi-convegni": "2024-2026",
  "fuori-consip": "2024-2026",
  "indennita-organi": "date dichiarate nei mandati: 2020-2028",
  "indice-enti": "aggiornamenti dichiarati 2018-2026",
  "missioni": "2024-2025",
  "nominativi-incarichi": "date dichiarate negli incarichi: 2004-2030",
  "openbdap-capitoli-2024-2026": "2024-2026",
  "openbdap-consulenze-ce": "2024-2025",
  "openbdap-personale-piani-gestione": "2024-2025",
  "opencup-census-window": "2025-2026",
  personale: "2024-2025",
  "rimborsi-spese": "2024-2026",
  "rinnovi-proroghe": "date dichiarate negli atti: 2020-2029",
  vincitori: "2024-2026",
};

const sensitiveQueryKeys = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "code",
  "credential",
  "key",
  "password",
  "secret",
  "session",
  "signature",
  "sig",
  "token",
]);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function canonicalJson(value) {
  const orderKeys = (entry) => {
    if (Array.isArray(entry)) return entry.map(orderKeys);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, orderKeys(child)]),
      );
    }
    return entry;
  };
  return `${JSON.stringify(orderKeys(value))}\n`;
}

function inspectionProjection(inspection) {
  if (inspection === undefined) return undefined;
  const stripPrivateNames = (entry) => {
    if (Array.isArray(entry)) return entry.map(stripPrivateNames);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry)
          .filter(([key]) => key !== "name")
          .map(([key, child]) => [key, stripPrivateNames(child)]),
      );
    }
    return entry;
  };
  const projected = stripPrivateNames(inspection);
  projected.contractSha256 = sha256(canonicalJson(inspection));
  projected.sha256 = sha256(canonicalJson(projected));
  return projected;
}

function repositoryRelative(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join("/");
}

function sorted(values) {
  return [...values].sort();
}

function assertPublicUrlSafe(rawUrl, context) {
  const parsed = new URL(rawUrl);
  assert.ok(["http:", "https:"].includes(parsed.protocol), `${context}: protocollo URL`);
  assert.equal(parsed.username, "", `${context}: username nell'URL pubblico`);
  assert.equal(parsed.password, "", `${context}: password nell'URL pubblico`);
  for (const key of parsed.searchParams.keys()) {
    assert.ok(
      !sensitiveQueryKeys.has(key.toLowerCase()),
      `${context}: parametro sensibile ${key}`,
    );
  }
}

function assertNoInternalProvenance(value, context) {
  const text = JSON.stringify(value);
  assert.doesNotMatch(
    text,
    /(^|[\s|;:(=["'])(?:file:\/\/)?\/(?:workspace|users|home|private\/tmp|tmp)\//i,
    `${context}: percorso macchina interno`,
  );
  assert.doesNotMatch(
    text,
    /(?:copy|ui)-[a-z]+\.(?:tsv|json|md)|(?:other[-_ ]agent|private[-_ ]batch|browser[-_ ]session|raw[-_ ]internal)/i,
    `${context}: nome di processo interno`,
  );
  assert.doesNotMatch(
    text,
    /(?<![\/\w:-])(?:dashboard|affidamenti-work|at-catalog|buchi|releases|voce-della-spesa)\//i,
    `${context}: percorso relativo del pacchetto`,
  );
  assert.doesNotMatch(
    text,
    /(?<![\/\w:-])(?:[a-z0-9][a-z0-9._-]*-)?README\.md\b/i,
    `${context}: README interno`,
  );
}

test("the committed curated corpus has an exact, closed artifact and row ledger", () => {
  const spec = readJson(specPath);
  const catalog = readJson(catalogPath);
  const proof = readJson(proofPath);
  const sourceMetadataFor = (datasetId) => ({
    ...spec.sourceMetadata.default,
    ...(spec.sourceMetadata.overrides[datasetId] ?? {}),
  });

  assert.deepEqual(spec.corpusContract, {
    elements: 51_303,
    hardlinks: 4_860,
    regularFiles: 46_438,
    symlinks: 5,
  });
  assert.equal(proof.complete, true);
  assert.deepEqual(proof.totals, expectedTotals);
  assert.deepEqual(catalog.totals, expectedTotals);
  assert.equal(proof.generatedAt, spec.generatedAt);
  assert.equal(catalog.generatedAt, spec.generatedAt);
  assert.equal(proof.catalogSha256, sha256(readFileSync(catalogPath)));

  const specIds = sorted(spec.datasets.map((dataset) => dataset.id));
  const catalogIds = catalog.datasets.map((dataset) => dataset.id);
  assert.deepEqual(specIds, mandatoryDatasetIds);
  assert.deepEqual(catalogIds, mandatoryDatasetIds);

  const expectedReceiptNames = sorted(specIds.map((id) => `${id}.receipt.json`));
  const expectedRowsNames = sorted(
    spec.datasets
      .filter((dataset) => ["rows", "source-index"].includes(dataset.publication))
      .flatMap((dataset) =>
        Array.from(
          { length: Math.ceil(dataset.expected.rows / rowChunkRows) },
          (_, ordinal) => rowChunkName(dataset.id, ordinal),
        ),
      ),
  );
  assert.deepEqual(sorted(readdirSync(receiptsDirectory)), expectedReceiptNames);
  assert.deepEqual(sorted(readdirSync(rowsDirectory)), expectedRowsNames);

  const expectedArtifactPaths = new Set([
    repositoryRelative(catalogPath),
    ...expectedReceiptNames.map((name) => repositoryRelative(path.join(receiptsDirectory, name))),
    ...expectedRowsNames.map((name) => repositoryRelative(path.join(rowsDirectory, name))),
  ]);
  assert.deepEqual(sorted(Object.keys(proof.artifactSha256)), sorted(expectedArtifactPaths));
  for (const [relativePath, digest] of Object.entries(proof.artifactSha256)) {
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.equal(
      sha256(readFileSync(path.join(repositoryRoot, relativePath))),
      digest,
      `${relativePath}: hash nel proof`,
    );
  }

  const catalogById = new Map(catalog.datasets.map((dataset) => [dataset.id, dataset]));
  assert.deepEqual(
    Object.fromEntries(
      catalog.datasets
        .filter((dataset) => dataset.sourceMetadata.referencePeriod !== null)
        .map((dataset) => [dataset.id, dataset.sourceMetadata.referencePeriod]),
    ),
    expectedReferencePeriods,
    "i periodi pubblicati devono restare limitati ai confini temporali documentati",
  );
  let sourceRows = 0;
  let publicRows = 0;
  let catalogOnlyRows = 0;
  let derivedOnlyRows = 0;
  let sourceBytes = 0;

  for (const dataset of spec.datasets) {
    const catalogEntry = catalogById.get(dataset.id);
    assert.ok(catalogEntry, `${dataset.id}: catalog entry`);
    assert.deepEqual(
      catalogEntry,
      {
        authority: dataset.authority,
        caveats: dataset.caveats,
        domain: dataset.domain,
        evidenceLabel: dataset.evidenceLabel,
        headers: dataset.dataKind === "json-object" ? ["value"] : dataset.expected.headers,
        id: dataset.id,
        ...(dataset.inspection === undefined
          ? {}
          : { inspection: inspectionProjection(dataset.inspection) }),
        licenseStatus: dataset.licenseStatus,
        privateFields: sorted(dataset.privateFields),
        publicRows: ["rows", "source-index"].includes(dataset.publication)
          ? dataset.expected.rows
          : 0,
        publication: dataset.publication,
        receiptSha256: catalogEntry.receiptSha256,
        rows: dataset.expected.rows,
        rowsWithPublicSource: catalogEntry.rowsWithPublicSource,
        sourceMetadata: sourceMetadataFor(dataset.id),
        title: dataset.title,
      },
      `${dataset.id}: catalog metadata must be derived from the pinned spec`,
    );

    const receiptPath = path.join(receiptsDirectory, `${dataset.id}.receipt.json`);
    const receiptBytes = readFileSync(receiptPath);
    const receipt = JSON.parse(receiptBytes);
    assert.equal(catalogEntry.receiptSha256, sha256(receiptBytes));
    assert.match(catalogEntry.sourceMetadata.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    for (const url of catalogEntry.sourceMetadata.canonicalUrls) {
      assertPublicUrlSafe(url, `${dataset.id}: fonte canonica`);
    }
    assert.equal(proof.artifactSha256[repositoryRelative(receiptPath)], sha256(receiptBytes));
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.datasetId, dataset.id);
    assert.equal(receipt.rowEquationClosed, true);
    const expectedReceiptSource = {
      bytes: dataset.expected.bytes,
      columns: dataset.dataKind === "json-object" ? 1 : dataset.expected.columns,
      headers: dataset.dataKind === "json-object" ? ["value"] : dataset.expected.headers,
      ...(dataset.expected.reportedColumns === undefined
        ? {}
        : { reportedColumns: dataset.expected.reportedColumns }),
      ...(dataset.expected.reportedFiles === undefined
        ? {}
        : { reportedFiles: dataset.expected.reportedFiles }),
      rows: dataset.expected.rows,
      sha256: dataset.expected.sha256,
      ...(dataset.sources
        ? {
            sourceSet: {
              files: dataset.sources.map((source, index) => ({
                bytes: source.expected.bytes,
                id: `source-${String(index + 1).padStart(4, "0")}`,
                rows: source.expected.rows,
                sha256: source.expected.sha256,
              })),
              sha256: dataset.expected.sha256,
            },
          }
        : {}),
      ...(dataset.inspection === undefined
        ? {}
        : { inspection: inspectionProjection(dataset.inspection) }),
    };
    assert.deepEqual(receipt.source, expectedReceiptSource);

    const expectedPublicRows = ["rows", "source-index"].includes(dataset.publication)
      ? dataset.expected.rows
      : 0;
    const expectedCatalogOnly = dataset.publication === "catalog-only" ? dataset.expected.rows : 0;
    const expectedDerivedOnly = dataset.publication === "derived-only" ? dataset.expected.rows : 0;
    assert.equal(receipt.publication.status, dataset.publication);
    assert.equal(receipt.publication.publicRows, expectedPublicRows);
    assert.equal(receipt.publication.catalogOnlyRows, expectedCatalogOnly);
    assert.equal(receipt.publication.derivedOnlyRows, expectedDerivedOnly);
    assert.equal(
      receipt.publication.publicRows
        + receipt.publication.catalogOnlyRows
        + receipt.publication.derivedOnlyRows,
      dataset.expected.rows,
      `${dataset.id}: closed row equation`,
    );

    sourceRows += receipt.source.rows;
    publicRows += receipt.publication.publicRows;
    catalogOnlyRows += receipt.publication.catalogOnlyRows;
    derivedOnlyRows += receipt.publication.derivedOnlyRows;
    sourceBytes += receipt.source.bytes;

    if (!["rows", "source-index"].includes(dataset.publication)) {
      assert.equal(receipt.rowsSha256, null);
      continue;
    }

    const chunkCount = Math.ceil(dataset.expected.rows / rowChunkRows);
    const plainChunks = Array.from({ length: chunkCount }, (_, ordinal) => {
      const rowsPath = path.join(rowsDirectory, rowChunkName(dataset.id, ordinal));
      const compressedRows = readFileSync(rowsPath);
      assert.deepEqual(
        [...compressedRows.subarray(0, 10)],
        [0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xff],
        `${dataset.id}:${ordinal}: canonical gzip header independent of Python and host OS`,
      );
      const plainChunk = gunzipSync(compressedRows);
      assert.ok(
        plainChunk.length <= rowChunkMaxRawBytes,
        `${dataset.id}:${ordinal}: chunk raw oltre 2 MiB`,
      );
      assert.equal(
        plainChunk.toString("utf8").trimEnd().split("\n").length,
        Math.min(rowChunkRows, dataset.expected.rows - ordinal * rowChunkRows),
        `${dataset.id}:${ordinal}: cardinalità chunk`,
      );
      return plainChunk;
    });
    const plainRows = Buffer.concat(plainChunks);
    assert.equal(sha256(plainRows), receipt.rowsSha256);
    assert.ok(plainRows.length > 0 && plainRows.at(-1) === 0x0a, `${dataset.id}: newline finale`);
    const lines = plainRows.toString("utf8").slice(0, -1).split("\n");
    assert.equal(lines.length, receipt.publication.publicRows, `${dataset.id}: cardinalità JSONL`);

    let rowsWithPublicSource = 0;
    let redactions = 0;
    const rowIds = new Set();
    for (const [index, line] of lines.entries()) {
      const row = JSON.parse(line);
      const sourceRow = index + 1;
      assert.deepEqual(sorted(Object.keys(row)), [
        "cells",
        "evidenceLabel",
        "id",
        "redactions",
        "sourceRow",
        "sourceRowSha256",
        "sourceUrls",
      ]);
      assert.equal(row.sourceRow, sourceRow, `${dataset.id}: sourceRow ${sourceRow}`);
      assert.match(row.sourceRowSha256, /^[a-f0-9]{64}$/);
      assert.equal(
        row.id,
        `row-${sha256(`${dataset.id}:${sourceRow}:${row.sourceRowSha256}`).slice(0, 24)}`,
      );
      assert.ok(!rowIds.has(row.id), `${dataset.id}: duplicate row id ${row.id}`);
      rowIds.add(row.id);
      assert.equal(row.evidenceLabel, dataset.evidenceLabel);
      assert.deepEqual(sorted(Object.keys(row.cells)), sorted(receipt.source.headers));
      assertNoInternalProvenance(row.cells, `${dataset.id}:${sourceRow}`);

      for (const privateField of dataset.privateFields) {
        assert.ok(
          row.cells[privateField] === null || row.cells[privateField] === "",
          `${dataset.id}:${sourceRow}: private field ${privateField}`,
        );
        if (row.cells[privateField] === null) {
          assert.ok(
            row.redactions.some(
              (redaction) => redaction.field === privateField
                && redaction.reason === "personal-identifier",
            ),
            `${dataset.id}:${sourceRow}: missing private-field redaction receipt`,
          );
        }
      }

      assert.deepEqual(row.sourceUrls, sorted(new Set(row.sourceUrls)));
      for (const sourceUrl of row.sourceUrls) {
        assertPublicUrlSafe(sourceUrl, `${dataset.id}:${sourceRow}`);
      }
      if (row.sourceUrls.length > 0) {
        rowsWithPublicSource += 1;
      }
      for (const redaction of row.redactions) {
        assert.deepEqual(sorted(Object.keys(redaction)), ["field", "reason"]);
        assert.ok(receipt.source.headers.includes(redaction.field));
        assert.ok(
          [
            "personal-identifier",
            "private-value-copy",
            "credential",
            "internal-path",
            "internal-process-name",
            "unsafe-url",
          ].includes(redaction.reason),
        );
      }
      redactions += row.redactions.length;
    }
    assert.equal(receipt.publication.rowsWithPublicSource, rowsWithPublicSource);
    assert.equal(receipt.publication.redactions, redactions);
  }

  assert.deepEqual(
    {
      catalogOnlyRows,
      datasets: spec.datasets.length,
      derivedOnlyRows,
      publicRows,
      sourceBytes,
      sourceRows,
    },
    expectedTotals,
  );
  assert.equal(sourceRows, publicRows + catalogOnlyRows + derivedOnlyRows);
});

test("the committed curated corpus passes source-free verification", () => {
  const result = spawnSync(
    PYTHON_BIN,
    ["scripts/etl/integrated_curated_datasets.py", "check"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    action: "check",
    sourceRequired: false,
    status: "ok",
  });
});
