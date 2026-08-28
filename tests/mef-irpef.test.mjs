import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./helpers/register-ts-alias.mjs";

const contract = await import("../src/lib/data/mef-irpef-contract.ts");
const { MEF_IRPEF_SOURCE } = await import("../src/lib/data/mef-irpef-source.ts");
const { MefIrpefQueryError, queryMefMunicipalIrpef } = await import(
  "../src/lib/mef-irpef-snapshot.ts"
);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const dataBytes = await readFile(new URL("../src/data/generated/mef-irpef-2024.data.json", import.meta.url));
const meta = JSON.parse(await readFile(
  new URL("../src/data/generated/mef-irpef-2024.meta.json", import.meta.url),
  "utf8",
));
const data = JSON.parse(dataBytes.toString("utf8"));
const lock = JSON.parse(await readFile(
  new URL("../scripts/etl/specs/mef-irpef-2024.source.json", import.meta.url),
  "utf8",
));

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [path];
  }));
  return nested.flat();
}

test("MEF IRPEF artifacts are byte-bound, source-lock aligned and independently reconciled", () => {
  const digest = createHash("sha256").update(dataBytes).digest("hex");
  const validated = contract.validateMefIrpefSnapshot(meta, data, {
    bytes: dataBytes.byteLength,
    sha256: digest,
  });
  assert.equal(validated.data.datasetId, contract.MEF_IRPEF_DATASET_ID);
  assert.equal(validated.data.taxYear, 2024);
  assert.deepEqual(validated.data.measureOrder, [...contract.MEF_IRPEF_MEASURE_ORDER]);
  assert.deepEqual(
    [validated.data.municipalities.length, validated.data.provinces.length, validated.data.regions.length],
    [7_896, 107, 20],
  );
  assert.equal(meta.dataArtifactBytes, dataBytes.byteLength);
  assert.equal(meta.dataArtifactSha256, digest);
  assert.equal(meta.datasetId, lock.datasetId);
  assert.equal(meta.lockSha256, lock.integrity.lockSha256);
  assert.equal(meta.source.assetUrl, lock.source.assetUrl);
  assert.deepEqual(meta.source.zip, lock.source.zip);
  assert.deepEqual(meta.source.csvMember, {
    name: lock.source.csvMember.name,
    bytes: lock.source.csvMember.bytes,
    sha256: lock.source.csvMember.sha256,
    crc32: lock.source.csvMember.crc32,
  });
  assert.equal(meta.source.licenseUrl, "https://creativecommons.org/licenses/by/3.0/it/");
  assert.equal(MEF_IRPEF_SOURCE.sourceUrl, meta.source.landingUrl);
  for (const key of ["landingUrl", "assetUrl", "methodologyUrl", "definitionsUrl"]) {
    const url = new URL(meta.source[key]);
    assert.equal(url.protocol, "https:");
    assert.ok(MEF_IRPEF_SOURCE.allowedHosts.includes(url.hostname), `${key}: ${url.hostname}`);
  }

  const lockWithoutDigest = structuredClone(lock);
  delete lockWithoutDigest.integrity.lockSha256;
  assert.equal(
    createHash("sha256").update(canonicalJson(lockWithoutDigest)).digest("hex"),
    lock.integrity.lockSha256,
  );
});

test("MEF IRPEF query keeps periods and semantic boundaries explicit", () => {
  const result = queryMefMunicipalIrpef();
  assert.equal(result.dataset, "mef_irpef_comunale");
  assert.deepEqual(result.period, {
    taxYear: 2024,
    declarationYear: 2025,
    publishedAt: "2026-04-23",
    observedAt: "2026-08-21T00:00:00Z",
    municipalityAssignmentDateRule: "domicilio fiscale al 31 dicembre dell'anno di presentazione della dichiarazione",
    surtaxDomicileDate: "2024-01-01",
  });
  assert.deepEqual(result.pagination, { total: 20, offset: 0, limit: 20, returned: 20 });
  assert.ok(result.data.every((row) => row.territory.level === "region"));
  assert.equal(
    result.national.assigned.taxpayers + result.national.unassigned.taxpayers,
    result.national.allSource.taxpayers,
  );
  assert.match(result.caveats.join(" "), /imposta netta dichiarata/i);
  assert.match(result.caveats.join(" "), /non è il gettito fiscale totale/i);
  assert.match(result.caveats.join(" "), /non vengono sottratti.*CPT/i);
  assert.doesNotMatch(JSON.stringify(result), /ABANO TERME/);

  const originalName = result.data[0].territory.name;
  const originalSourceName = result.data[0].territory.sourceNames[0];
  result.data[0].territory.name = "MUTATED";
  result.data[0].territory.sourceNames[0] = "MUTATED";
  const freshResult = queryMefMunicipalIrpef();
  assert.equal(freshResult.data[0].territory.name, originalName);
  assert.equal(freshResult.data[0].territory.sourceNames[0], originalSourceName);
});

test("MEF IRPEF query is bounded, stable and preserves suppressed values", () => {
  const abano = queryMefMunicipalIrpef({ level: "municipality", code: "028001" });
  assert.equal(abano.data[0].territory.name, "ABANO TERME");
  assert.deepEqual(abano.data[0].measures.netTaxDeclared, {
    coverage: "complete",
    frequency: 13_100,
    amountCents: 8_981_665_600,
  });

  const balme = queryMefMunicipalIrpef({ level: "municipality", code: "001019" });
  assert.deepEqual(balme.data[0].measures.municipalSurtaxDue, {
    coverage: "partial",
    knownFrequency: 0,
    knownAmountCents: 0,
    suppressedRows: 1,
  });

  const abanoByName = queryMefMunicipalIrpef({
    level: "municipality",
    query: "abano térme",
  });
  assert.equal(abanoByName.pagination.total, 1);
  assert.equal(abanoByName.data[0].territory.code, abano.data[0].territory.code);
  assert.deepEqual(abanoByName.matchedTotals, {
    taxpayers: abano.data[0].taxpayers,
    measures: abano.data[0].measures,
  });

  const firstPage = queryMefMunicipalIrpef({
    level: "municipality",
    region: "Veneto",
    limit: 2,
  });
  const secondPage = queryMefMunicipalIrpef({
    level: "municipality",
    region: "05",
    limit: 1,
    offset: 1,
  });
  assert.ok(firstPage.pagination.total > firstPage.pagination.returned);
  assert.equal(secondPage.data[0].territory.code, firstPage.data[1].territory.code);
  assert.deepEqual(secondPage.matchedTotals, firstPage.matchedTotals);
  assert.ok(firstPage.matchedTotals.taxpayers > firstPage.data[0].taxpayers);
  assert.ok(firstPage.data.length <= 100);
});

test("MEF IRPEF query rejects unbounded, unsupported and unknown requests", () => {
  const invalid = (query, pattern) => assert.throws(
    () => queryMefMunicipalIrpef(query),
    (error) => error instanceof MefIrpefQueryError && error.status === 400 && pattern.test(error.message),
  );
  invalid({ year: 2023 }, /Anno d.imposta non disponibile/);
  invalid({ level: "municipality" }, /almeno/);
  invalid({ level: "municipality", query: "Roma", limit: 101 }, /limit/);
  invalid({ level: "region", surprise: true }, /non supportati/);
  assert.throws(
    () => queryMefMunicipalIrpef({ level: "region", offset: 20 }),
    (error) => error instanceof MefIrpefQueryError && error.code === "not_found",
  );
  assert.throws(
    () => queryMefMunicipalIrpef({ level: "municipality", code: "999999" }),
    (error) => error instanceof MefIrpefQueryError && error.status === 404,
  );
});

test("MEF IRPEF validator fails closed on suppression, aggregate and digest drift", () => {
  const brokenRow = [...data.municipalities[0]];
  brokenRow[16] = null;
  assert.throws(
    () => contract.validateMefIrpefData({
      ...data,
      municipalities: [brokenRow, ...data.municipalities.slice(1)],
    }),
    /entrambi presenti o entrambi oscurati/,
  );

  assert.throws(
    () => contract.validateMefIrpefData({
      ...data,
      national: {
        ...data.national,
        assigned: { ...data.national.assigned, taxpayers: data.national.assigned.taxpayers + 1 },
      },
    }),
    /Nazionale assegnato: contribuenti non riconciliati/,
  );
  assert.throws(
    () => contract.validateMefIrpefSnapshot(meta, data, {
      bytes: dataBytes.byteLength,
      sha256: "0".repeat(64),
    }),
    /SHA-256 artefatto dati non riconciliato/,
  );
});

test("the full municipal artifact stays behind the server query boundary", async () => {
  const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));
  const matches = [];
  for (const file of await sourceFiles(srcRoot)) {
    if (![".ts", ".tsx"].includes(extname(file))) continue;
    const source = await readFile(file, "utf8");
    if (source.includes("mef-irpef-2024.data.json")) {
      matches.push(relative(repositoryRoot, file));
    }
  }
  // relative() yields the platform separator; the expected identity is a repository
  // path, so compare on one canonical form instead of the host's.
  const repositoryPaths = matches.map((path) => path.split(sep).join("/"));
  assert.deepEqual(repositoryPaths.map((path) => path.replace(/^.*?src\//, "src/")).sort(), [
    "src/lib/mef-irpef-snapshot.ts",
  ]);
  const snapshotSource = await readFile(
    new URL("../src/lib/mef-irpef-snapshot.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(snapshotSource, /from ["']@\/lib\/cpt/);
});
