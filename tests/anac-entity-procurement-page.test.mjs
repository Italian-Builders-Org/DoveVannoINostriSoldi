import assert from "node:assert/strict";
import "./helpers/register-ts-alias.mjs";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import test from "node:test";

const ARTIFACT_RELATIVE = "src/data/generated/anac-entity-procurement-page";
const SHARD_RELATIVE = `${ARTIFACT_RELATIVE}/entities`;
const loader = await import("../src/lib/data/anac-entity-procurement-page.ts");

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixtureRecord() {
  return {
    schemaVersion: 1,
    codiceIpa: "ENTE1",
    codiceFiscaleEnte: "12345678903",
    summary: {
      procedureCount: 1,
      awardCount: 5,
      awardValue: "1.201",
      positiveAwardCount: 2,
      awardeeCount: 2,
      awardsWithStableAwardees: 2,
      awardsWithoutStableAwardees: 3,
      singleOperatorAwards: 1,
      multipartOrAmbiguousAwards: 2,
      attributedAwardValue: "1.2",
      unattributedAwardValue: "0.001",
    },
    operators: [
      { ref: "op-000001", name: "Operatore Uno", nameVariants: 0, awardCount: 2, attributedAwardCount: 1, attributedValue: "1.2", rankByCount: 1, rankByValue: 1 },
      { ref: "op-000002", name: "Operatore Due", nameVariants: 0, awardCount: 1, attributedAwardCount: 0, attributedValue: "0", rankByCount: 2, rankByValue: null },
    ],
    procedures: [{ cig: "CIG0000001", publishedAt: null }],
    awards: [
      { cig: "CIG0000001", awardId: "1", awardedAt: "2025-01-03", amount: "1.2", amountStatus: "positive-exact-cent", operatorRefs: ["op-000001"], attribution: "single-operator" },
      { cig: "CIG0000001", awardId: "2", awardedAt: "2025-01-04", amount: "0.001", amountStatus: "positive-subcent", operatorRefs: ["op-000001", "op-000002"], attribution: "multipart" },
      { cig: "CIG0000001", awardId: "3", awardedAt: null, amount: "0", amountStatus: "zero", operatorRefs: [], attribution: "no-awardee" },
      { cig: "CIG0000001", awardId: "4", awardedAt: null, amount: "-1", amountStatus: "negative", operatorRefs: [], attribution: "ambiguous" },
      { cig: "CIG0000001", awardId: "5", awardedAt: null, amount: null, amountStatus: "conflicting", operatorRefs: [], attribution: "no-awardee" },
    ],
  };
}

function fixtureMeta(prefix, shardBytes, shardSha256) {
  const sourceSpec = JSON.parse(readFileSync(resolve("scripts/etl/specs/anac-entity-procurement-page.source.json"), "utf8"));
  const parentSpec = JSON.parse(readFileSync(resolve("scripts/etl/specs/anac-entity-procurement.source.json"), "utf8"));
  const sourceSpecBytes = readFileSync(resolve("scripts/etl/specs/anac-entity-procurement-page.source.json"));
  const parentSpecBytes = readFileSync(resolve("scripts/etl/specs/anac-entity-procurement.source.json"));
  const sourceHash = digest(sourceSpecBytes);
  const parentHash = digest(parentSpecBytes);
  const awardsSpecBytes = readFileSync(resolve("scripts/etl/specs/anac-awardees.source.json"));
  const awardsSpec = JSON.parse(awardsSpecBytes.toString("utf8"));
  const parentInput = (key) => ({
    ...awardsSpec.inputs[key],
    assetObservedAt: null,
    parentSpecPath: "scripts/etl/specs/anac-awardees.source.json",
    parentSpecSha256: digest(awardsSpecBytes),
    parentInputKey: key,
    license: parentSpec.inputs[key].license,
  });
  return {
    schemaVersion: 1,
    dataset: "anac-entity-procurement-page",
    distributionKind: "sharded-public-profile",
    observedAt: sourceSpec.observedAt,
    generatedAt: "2026-08-31T15:00:00Z",
    scope: sourceSpec.scope,
    contract: sourceSpec.contract,
    privacy: sourceSpec.privacy,
    provenance: {
      sourceSpec: { path: "scripts/etl/specs/anac-entity-procurement-page.source.json", sha256: sourceHash },
      parentSourceSpec: { path: "scripts/etl/specs/anac-entity-procurement.source.json", sha256: parentHash },
      anacCatalogObservedAt: parentSpec.catalogObservedAt ?? null,
      anacCatalogMetadataModifiedAt: parentSpec.catalogMetadataModifiedAt ?? null,
      anacAssetObservedAt: {
        cig: parentSpec.inputs.cig.map((entry) => entry.assetObservedAt),
        stations: parentSpec.inputs.stations.assetObservedAt,
      },
      ipa: sourceSpec.ipa,
      awards: parentInput("awards"),
      awardees: parentInput("awardees"),
    },
    coverage: {
      ipaRows: 1,
      ipaRowsWithUniqueValidTaxCode: 1,
      ipaAmbiguousTaxCodes: 0,
      ipaCodes: 1,
      ipaRowsWithMissingOrInvalidTaxCode: 0,
      resolvedAnacEntityTaxCodes: 1,
      linkedEntityProfiles: 1,
      resolvedAnacEntityTaxCodesWithoutIpa: 0,
      awardeeRows: {
        rawRows: 3,
        ineligibleKeyRows: 0,
        knownKeyRows: 3,
        eligibleKeyRows: 3,
        outOfCohortRows: 0,
        resolvedRows: 3,
        unresolvedRows: 0,
      },
    },
    totals: { entities: 1, procedures: 1, awards: 5, operators: 2, awardeeRelations: 3, positiveAwards: 2, awardValue: "1.201", attributedAwardValue: "1.2", unattributedAwardValue: "0.001" },
    shards: Array.from({ length: 256 }, (_, index) => {
      const id = index.toString(16).padStart(2, "0");
      return { id, path: `${SHARD_RELATIVE}/${id}.jsonl.gz`, bytes: id === prefix ? shardBytes : 20, sha256: id === prefix ? shardSha256 : "d".repeat(64), entities: id === prefix ? 1 : 0 };
    }),
    sourceSpecSha256: sourceHash,
    limitations: [
      "CIG, aggiudicazioni, aggiudicatari, stazioni e IPA sono snapshot cross-temporali",
      "la copertura nazionale corrente non e dichiarata",
      "il valore e importo di aggiudicazione dichiarato, non pagamento",
      "gli award multi-operatore o con identita irrisolte restano nel totale ente ma non nel ranking per valore",
      "ranking e drill-down sono descrittivi e non indicano illeciti",
    ],
  };
}

function makeFixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), "anac-page-test-"));
  const artifactRoot = join(projectRoot, ARTIFACT_RELATIVE);
  const entitiesRoot = join(projectRoot, SHARD_RELATIVE);
  mkdirSync(entitiesRoot, { recursive: true });
  const record = fixtureRecord();
  const prefix = digest(record.codiceIpa).slice(0, 2);
  const compressed = gzipSync(Buffer.from(JSON.stringify(record) + "\n"));
  for (let index = 0; index < 256; index += 1) {
    const id = index.toString(16).padStart(2, "0");
    const path = join(entitiesRoot, `${id}.jsonl.gz`);
    writeFileSync(path, gzipSync(Buffer.alloc(0)));
  }
  writeFileSync(join(entitiesRoot, `${prefix}.jsonl.gz`), compressed);
  writeFileSync(join(artifactRoot, "meta.json"), JSON.stringify(fixtureMeta(prefix, compressed.length, digest(compressed))) + "\n");
  return { projectRoot, record, prefix };
}

function cleanup(fixture) {
  rmSync(fixture.projectRoot, { recursive: true, force: true });
}

test("fixture loader accepts four-way attribution, nullable dates and exact subcent sums", async () => {
  const fixture = makeFixture();
  try {
    const result = await loader.loadAnacEntityProcurementPage({ codiceIpa: fixture.record.codiceIpa, currentEntityCf: fixture.record.codiceFiscaleEnte, rootDirectory: fixture.projectRoot });
    assert.equal(result.status, "available");
    if (result.status === "available") {
      assert.equal(result.profile.summary.awardValue, "1.201");
      assert.equal(result.profile.procedures[0].publishedAt, null);
      assert.equal("codiceFiscaleEnte" in result.profile, false);
    }
  } finally {
    cleanup(fixture);
  }
});

test("pagination clamps an out-of-range query to the last available page", () => {
  assert.equal(loader.clampEntityProcurementPage("10000", 51, 25), 3);
  assert.equal(loader.clampEntityProcurementPage("10000", 1, 50), 1);
  assert.equal(loader.clampEntityProcurementPage("not-a-page", 0, 25), 1);
});

test("malformed entity route escapes fail closed before IPA lookup", () => {
  assert.equal(loader.decodeEntityProcurementRouteCode(" ENTE1 "), "ENTE1");
  assert.equal(loader.decodeEntityProcurementRouteCode("%E0%A4%A"), null);
  assert.equal(loader.decodeEntityProcurementRouteCode("   "), null);
});

test("attribution caveat counts no-awardee when multipart count is zero", () => {
  assert.deepEqual(
    loader.countAnacAwardAttributions([{ attribution: "no-awardee" }]),
    { singleOperator: 0, multipart: 0, ambiguous: 0, noAwardee: 1, notAttributed: 1 },
  );
});

test("loader can skip the live fiscal-code check when IPA is unreachable", async () => {
  const fixture = makeFixture();
  try {
    const skipped = await loader.loadAnacEntityProcurementPage({
      codiceIpa: fixture.record.codiceIpa,
      currentEntityCf: null,
      rootDirectory: fixture.projectRoot,
      verifyLiveFiscalCode: false,
    });
    assert.equal(skipped.status, "available");
    const enforced = await loader.loadAnacEntityProcurementPage({
      codiceIpa: fixture.record.codiceIpa,
      currentEntityCf: null,
      rootDirectory: fixture.projectRoot,
    });
    assert.equal(enforced.status, "identity_drift");
  } finally {
    cleanup(fixture);
  }
});

test("loader fails closed on identity drift and shard tampering", async () => {
  const fixture = makeFixture();
  try {
    const drift = await loader.loadAnacEntityProcurementPage({ codiceIpa: fixture.record.codiceIpa, currentEntityCf: "12345678911", rootDirectory: fixture.projectRoot });
    assert.equal(drift.status, "identity_drift");
    writeFileSync(join(fixture.projectRoot, SHARD_RELATIVE, `${fixture.prefix}.jsonl.gz`), Buffer.from("tampered"));
    const tampered = await loader.loadAnacEntityProcurementPage({ codiceIpa: fixture.record.codiceIpa, currentEntityCf: fixture.record.codiceFiscaleEnte, rootDirectory: fixture.projectRoot });
    assert.equal(tampered.status, "unavailable");
    assert.equal(tampered.reason, "artifact-invalid");
  } finally {
    cleanup(fixture);
  }
});

test("loader fails closed when metadata or shard path is not a regular file", async () => {
  const metadataFixture = makeFixture();
  try {
    const metaPath = join(metadataFixture.projectRoot, ARTIFACT_RELATIVE, "meta.json");
    rmSync(metaPath);
    mkdirSync(metaPath);
    const result = await loader.loadAnacEntityProcurementPage({
      codiceIpa: metadataFixture.record.codiceIpa,
      currentEntityCf: metadataFixture.record.codiceFiscaleEnte,
      rootDirectory: metadataFixture.projectRoot,
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "artifact-invalid");
  } finally {
    cleanup(metadataFixture);
  }

  const shardFixture = makeFixture();
  try {
    const shardPath = join(shardFixture.projectRoot, SHARD_RELATIVE, `${shardFixture.prefix}.jsonl.gz`);
    rmSync(shardPath);
    mkdirSync(shardPath);
    const result = await loader.loadAnacEntityProcurementPage({
      codiceIpa: shardFixture.record.codiceIpa,
      currentEntityCf: shardFixture.record.codiceFiscaleEnte,
      rootDirectory: shardFixture.projectRoot,
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "artifact-invalid");
  } finally {
    cleanup(shardFixture);
  }
});

test("record validator rejects nested private keys and arbitrary attribution", () => {
  const fixture = fixtureRecord();
  const prefix = digest(fixture.codiceIpa).slice(0, 2);
  const privateLeak = structuredClone(fixture);
  privateLeak.operators[0].codiceFiscale = "12345678901";
  assert.throws(() => loader.assertAnacEntityProcurementPageRecord(privateLeak, prefix), /chiavi inattese/);
  const arbitraryAttribution = structuredClone(fixture);
  arbitraryAttribution.awards[0].attribution = "not-attributed";
  assert.throws(() => loader.assertAnacEntityProcurementPageRecord(arbitraryAttribution, prefix), /attribution non valido/);
});

test("record validator rejects derived metric, amount, identity and key mutations", () => {
  const fixture = fixtureRecord();
  const prefix = digest(fixture.codiceIpa).slice(0, 2);

  const metricMutation = structuredClone(fixture);
  metricMutation.operators[0].awardCount += 1;
  assert.throws(() => loader.assertAnacEntityProcurementPageRecord(metricMutation, prefix), /metriche operatore/);

  const rankMutation = structuredClone(fixture);
  rankMutation.operators[0].rankByCount = 2;
  assert.throws(() => loader.assertAnacEntityProcurementPageRecord(rankMutation, prefix), /metriche operatore/);

  const summaryMutation = structuredClone(fixture);
  summaryMutation.summary.attributedAwardValue = "0";
  assert.throws(() => loader.assertAnacEntityProcurementPageRecord(summaryMutation, prefix), /somma importi|attribuzione valore/);

  const negativeZero = structuredClone(fixture);
  negativeZero.awards[3].amount = "-0.00";
  assert.throws(() => loader.assertAnacEntityProcurementPageRecord(negativeZero, prefix), /non canonico|negative/);

  const wrongCentStatus = structuredClone(fixture);
  wrongCentStatus.awards[1].amountStatus = "positive-exact-cent";
  assert.throws(() => loader.assertAnacEntityProcurementPageRecord(wrongCentStatus, prefix), /centesimi/);

  const nonCanonicalZero = structuredClone(fixture);
  nonCanonicalZero.awards[2].amount = "0.00";
  assert.throws(() => loader.assertAnacEntityProcurementPageRecord(nonCanonicalZero, prefix), /non canonico/);

  const placeholderCf = structuredClone(fixture);
  placeholderCf.codiceFiscaleEnte = "00000000000";
  assert.throws(() => loader.assertAnacEntityProcurementPageRecord(placeholderCf, prefix), /codice fiscale/);

  const invalidCig = structuredClone(fixture);
  invalidCig.procedures[0].cig = "CIG000000";
  assert.throws(() => loader.assertAnacEntityProcurementPageRecord(invalidCig, prefix), /CIG/);

  const invalidAwardId = structuredClone(fixture);
  invalidAwardId.awards[0].awardId = "0";
  assert.throws(() => loader.assertAnacEntityProcurementPageRecord(invalidAwardId, prefix), /awardId/);

  const invalidDate = structuredClone(fixture);
  invalidDate.awards[0].awardedAt = "2025-02-30";
  assert.throws(() => loader.assertAnacEntityProcurementPageRecord(invalidDate, prefix), /non valido/);

  const orphanOperator = structuredClone(fixture);
  orphanOperator.operators.push({
    ref: "op-000003", name: "Operatore Orfano", nameVariants: 1,
    awardCount: 0, attributedAwardCount: 0, attributedValue: "0", rankByCount: 3, rankByValue: null,
  });
  orphanOperator.summary.awardeeCount += 1;
  assert.throws(() => loader.assertAnacEntityProcurementPageRecord(orphanOperator, prefix), /senza relazione/);
});

test("loader rejects metadata semantic or provenance drift", async () => {
  const fixture = makeFixture();
  try {
    const metaPath = join(fixture.projectRoot, ARTIFACT_RELATIVE, "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.contract.valueRanking = "all-awards";
    writeFileSync(metaPath, JSON.stringify(meta));
    const result = await loader.loadAnacEntityProcurementPage({ codiceIpa: fixture.record.codiceIpa, currentEntityCf: fixture.record.codiceFiscaleEnte, rootDirectory: fixture.projectRoot });
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "artifact-invalid");
  } finally {
    cleanup(fixture);
  }
});

test("loader requires complete parent input provenance when it is emitted", async () => {
  const fixture = makeFixture();
  try {
    const metaPath = join(fixture.projectRoot, ARTIFACT_RELATIVE, "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    delete meta.provenance.awards.encoding;
    writeFileSync(metaPath, JSON.stringify(meta));
    const result = await loader.loadAnacEntityProcurementPage({ codiceIpa: fixture.record.codiceIpa, currentEntityCf: fixture.record.codiceFiscaleEnte, rootDirectory: fixture.projectRoot });
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "artifact-invalid");
  } finally {
    cleanup(fixture);
  }
});

test("loader rejects IPA provenance wire-format drift", async () => {
  const fixture = makeFixture();
  try {
    const metaPath = join(fixture.projectRoot, ARTIFACT_RELATIVE, "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.provenance.ipa.delimiter = ";";
    writeFileSync(metaPath, JSON.stringify(meta));
    const result = await loader.loadAnacEntityProcurementPage({ codiceIpa: fixture.record.codiceIpa, currentEntityCf: fixture.record.codiceFiscaleEnte, rootDirectory: fixture.projectRoot });
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "artifact-invalid");
  } finally {
    cleanup(fixture);
  }
});

test("loader requires IPA wire-format fields", async () => {
  const fixture = makeFixture();
  try {
    const metaPath = join(fixture.projectRoot, ARTIFACT_RELATIVE, "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    delete meta.provenance.ipa.encoding;
    writeFileSync(metaPath, JSON.stringify(meta));
    const result = await loader.loadAnacEntityProcurementPage({ codiceIpa: fixture.record.codiceIpa, currentEntityCf: fixture.record.codiceFiscaleEnte, rootDirectory: fixture.projectRoot });
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "artifact-invalid");
  } finally {
    cleanup(fixture);
  }
});

test("loader rejects coverage partition and entity-total drift", async () => {
  const fixture = makeFixture();
  try {
    const metaPath = join(fixture.projectRoot, ARTIFACT_RELATIVE, "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.coverage.awardeeRows.outOfCohortRows = 1;
    writeFileSync(metaPath, JSON.stringify(meta));
    let result = await loader.loadAnacEntityProcurementPage({ codiceIpa: fixture.record.codiceIpa, currentEntityCf: fixture.record.codiceFiscaleEnte, rootDirectory: fixture.projectRoot });
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "artifact-invalid");

    const fresh = makeFixture();
    try {
      const freshMetaPath = join(fresh.projectRoot, ARTIFACT_RELATIVE, "meta.json");
      const freshMeta = JSON.parse(readFileSync(freshMetaPath, "utf8"));
      freshMeta.coverage.linkedEntityProfiles = 0;
      writeFileSync(freshMetaPath, JSON.stringify(freshMeta));
      result = await loader.loadAnacEntityProcurementPage({ codiceIpa: fresh.record.codiceIpa, currentEntityCf: fresh.record.codiceFiscaleEnte, rootDirectory: fresh.projectRoot });
      assert.equal(result.status, "unavailable");
      assert.equal(result.reason, "artifact-invalid");
    } finally {
      cleanup(fresh);
    }
  } finally {
    cleanup(fixture);
  }
});

test("registered real artifact is present and loadable when the registry claims it", async () => {
  const registry = JSON.parse(readFileSync(resolve("scripts/ci/generated-artifacts.json"), "utf8"));
  const registered = registry.artifacts.some((entry) => entry.id === "anac-entity-procurement-page");
  const metaFile = resolve(ARTIFACT_RELATIVE, "meta.json");
  assert.equal(existsSync(metaFile), registered, "artifact registrato ma meta.json assente");
  if (!registered) return;
  const meta = JSON.parse(readFileSync(metaFile, "utf8"));
  const descriptor = meta.shards.find((item) => item.entities > 0);
  assert.ok(descriptor, "artifact registrato senza profili");
  const line = gunzipSync(readFileSync(resolve(descriptor.path))).toString("utf8").split("\n").find(Boolean);
  assert.ok(line);
  const profile = JSON.parse(line);
  const result = await loader.loadAnacEntityProcurementPage({ codiceIpa: profile.codiceIpa, currentEntityCf: profile.codiceFiscaleEnte });
  assert.equal(result.status, "available");
});

test("UI keeps scope, rankings, official CIG links and no later indicators", () => {
  const section = readFileSync(new URL("../src/app/enti/[codice]/entity-procurement-section.tsx", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../src/app/enti/[codice]/appalti/page.tsx", import.meta.url), "utf8");
  assert.match(section, /Ranking per numero di aggiudicazioni/);
  assert.match(section, /Ranking per valore attribuibile/);
  assert.match(section, /view=procedures/);
  assert.match(section, /view=awards/);
  assert.match(section, /view=operators/);
  assert.match(section, /Operatori economici identificati/);
  assert.match(section, /multipartiti o ambigui/);
  assert.match(section, /senza aggiudicatario pubblicato/);
  assert.match(section, /dataset/);
  assert.match(section, /asset verificato/);
  assert.match(section, /assetBytes/);
  assert.match(section, /assetSha256/);
  assert.match(section, /nameVariants > 1/);
  assert.match(section, /snapshot cross-temporale/);
  assert.match(detail, /dettaglio_cig/);
  assert.match(detail, /positive-exact-cent/);
  assert.match(detail, /nessun aggiudicatario pubblicato/);
  assert.match(detail, /Operatori economici identificati/);
  assert.match(detail, /multipartiti o ambigui/);
  assert.match(detail, /senza aggiudicatario pubblicato/);
  assert.match(detail, /Ordine della classifica aggiudicatari/);
  assert.match(detail, /aria-label="Numero di aggiudicazioni"/);
  assert.match(detail, /aria-label="Valore attribuibile"/);
  assert.match(detail, /metric: "count", pageSize: size/);
  assert.match(detail, /metric: "value", pageSize: size/);
  assert.match(detail, /Perimetro temporale/);
  assert.match(detail, /verifyLiveFiscalCode: false/);
  assert.match(detail, /snapshot IPA verificato durante l'ETL/);
  assert.match(detail, /maxDuration = 15/);
  assert.doesNotMatch(detail, /getIpaEntityByCode/);
  const entityPage = readFileSync(new URL("../src/app/enti/[codice]/page.tsx", import.meta.url), "utf8");
  assert.match(entityPage, /Anagrafica IPA non disponibile/);
  assert.doesNotMatch(entityPage, /Impossibile interrogare la fonte IPA/);
  assert.match(detail, /getSiopeMunicipalityDetailByIpaCode/);
  assert.match(detail, /nameVariants > 1/);
  assert.match(`${section}\n${detail}`, /codici fiscali degli operatori/);
  assert.match(detail, /caption/);
  assert.match(detail, /scope="col"/);
  assert.doesNotMatch(`${section}\n${detail}`, /HHI|Top 1|Top 10 share|percentile|bunching|soglia applicabile|CPV/i);
});

test("ANAC tables and pagination expose 44px keyboard/touch targets", () => {
  const sectionCss = readFileSync(new URL("../src/app/enti/[codice]/entity-procurement.module.css", import.meta.url), "utf8");
  const detailCss = readFileSync(new URL("../src/app/enti/[codice]/appalti/appalti.module.css", import.meta.url), "utf8");
  assert.match(detailCss, /\.pageSize a\s*\{[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px[\s\S]*?padding:\s*8px 10px/);
  assert.match(detailCss, /\.page :global\(\.table-scroll\) td a,\s*\.page :global\(\.table-scroll\) th a\s*\{[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/);
  assert.match(sectionCss, /\.ranking td a,\s*\.ranking th a\s*\{[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/);
});

test("exact summary amounts wrap inside both KPI grids", () => {
  const sectionCss = readFileSync(new URL("../src/app/enti/[codice]/entity-procurement.module.css", import.meta.url), "utf8");
  const detailCss = readFileSync(new URL("../src/app/enti/[codice]/appalti/appalti.module.css", import.meta.url), "utf8");
  assert.match(detailCss, /\.summaryGrid a\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(detailCss, /\.summaryGrid strong,\s*\.operatorFacts strong\s*\{[\s\S]*?min-width:\s*0[\s\S]*?max-width:\s*100%[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(sectionCss, /\.summary\s*>\s*div\s*\{\s*min-width:\s*0/);
  assert.match(sectionCss, /\.summary :global\(\.stat-value\)\s*\{[\s\S]*?width:\s*100%[\s\S]*?min-width:\s*0[\s\S]*?max-width:\s*100%[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(sectionCss, /\.summary \.stat-value\s*\{/);
});

test("Next tracing carries the page and both parent source specs", () => {
  const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(config, /scripts\/etl\/specs\/anac-entity-procurement-page\.source\.json/);
  assert.match(config, /scripts\/etl\/specs\/anac-entity-procurement\.source\.json/);
  assert.match(config, /scripts\/etl\/specs\/anac-awardees\.source\.json/);
});
