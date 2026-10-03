import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { checkTrace } from "../scripts/ci/check-runtime-traces.mjs";
import nextConfig from "../next.config.ts";

const require = createRequire(import.meta.url);
const picomatch = require("next/dist/compiled/picomatch");
const childcare = "src/data/generated/pnrr-childcare.data.json";
const entityChildcareRoutes = [
  ["enti/[codice]/page.js.nft.json", true],
  ["api/enti/[codice]/route.js.nft.json", true],
  ["enti/page.js.nft.json", false],
  ["enti/[codice]/appalti/page.js.nft.json", false],
  ["enti/[codice]/appalti/confronti/page.js.nft.json", false],
  ["snapshot-pages/enti/[codice]/[view]/page.js.nft.json", false],
  ["api/enti/route.js.nft.json", false],
  ["api/enti/[codice]/struttura/route.js.nft.json", false],
];

function matchingRuntimeFile(patterns, route, file) {
  // Same route names and matcher options used by installed collect-build-traces.
  return Object.entries(patterns).some(([key, files]) =>
    picomatch(key, { dot: true, contains: true })(`/app/${route}`)
    && picomatch(files, { dot: true })(file));
}

function explicitRuntimeFile(route, file) {
  return matchingRuntimeFile(nextConfig.outputFileTracingIncludes, route, file)
    && !matchingRuntimeFile(nextConfig.outputFileTracingExcludes, route, file);
}

function fixture(t, files, route = "enti/page.js.nft.json") {
  const root = mkdtempSync(join(tmpdir(), "dvns-runtime-trace-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = join(root, ".next/server/app", route);
  mkdirSync(dirname(manifest), { recursive: true });
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "bytes");
  }
  writeFileSync(manifest, JSON.stringify({ version: 1, files: files.map((file) => relative(dirname(manifest), join(root, file))) }));
  return { root, manifest };
}

test("runtime package guard requires dynamically opened artifacts", (t) => {
  const artifact = "src/data/generated/anac-entity-procurement-page/entities/ab.jsonl.gz";
  const { root, manifest } = fixture(t, [artifact]);
  assert.deepEqual(checkTrace(root, manifest, [artifact]), { files: 1, bytes: 5 });
  assert.throws(() => checkTrace(root, manifest, [artifact.replace("ab", "cd")]), /omits runtime files/);
});

test("runtime package guard rejects accidental repository-wide and cross-domain tracing", (t) => {
  const { root, manifest } = fixture(t, ["tests/fixtures/private.json"]);
  assert.throws(() => checkTrace(root, manifest), /traces unrelated files/);
  const other = fixture(t, ["src/data/generated/unrelated/large.json"]);
  assert.throws(() => checkTrace(other.root, other.manifest, [], ["src/data/generated/unrelated"]), /traces unrelated files/);
  const prefixed = fixture(t, ["src/data/generated/integrated/rows/salute-spesa-dispositivi-2020.part-00000.jsonl.gz"]);
  assert.throws(() => checkTrace(prefixed.root, prefixed.manifest, [], [], ["src/data/generated/integrated/rows/salute-spesa-dispositivi-"]), /traces unrelated files/);
});

test("runtime package guard fails on traced files missing from the deployment", (t) => {
  const { root, manifest } = fixture(t, ["required.json"]);
  rmSync(join(root, "required.json"));
  assert.throws(() => checkTrace(root, manifest), /ENOENT/);
});

test("entity tracing includes childcare only in its runtime consumers", () => {
  for (const [route, consumer] of entityChildcareRoutes) {
    const internalRoute = route.replace(/\/(?:page|route)\.js\.nft\.json$/, "");
    assert.equal(explicitRuntimeFile(internalRoute, childcare), consumer, route);
    assert.equal(matchingRuntimeFile(nextConfig.outputFileTracingExcludes, internalRoute, childcare), !consumer, route);
  }
  for (const route of ["opere", "coesione", "coesione/asili", "progetti/[cup]",
    "api/pnrr/asili", "api/assistant/chat", "api/mcp"]) {
    assert.equal(explicitRuntimeFile(route, childcare), true, route);
  }
});

test("runtime package guard rejects CI intake without dropping proofs or row chunks", (t) => {
  const required = ["data/source-ledger/release-proof.json", "data/source-ledger/receipt.json",
    "data/source-ledger/dataset-proof.json", "data/source-ledger/sources.jsonl",
    "src/data/generated/integrated/catalog.json",
    "src/data/generated/integrated/rows/public.part-00000.jsonl.gz"];
  const clean = fixture(t, required);
  assert.equal(checkTrace(clean.root, clean.manifest, required).files, required.length);
  rmSync(join(clean.root, required[0]));
  assert.throws(() => checkTrace(clean.root, clean.manifest, required), /ENOENT/);
  const omitted = fixture(t, required.slice(1));
  assert.throws(() => checkTrace(omitted.root, omitted.manifest, required), /omits runtime files/);
  const intake = fixture(t, [...required, "data/source-ledger/elements/part-00001.jsonl"]);
  assert.throws(() => checkTrace(intake.root, intake.manifest, required), /traces unrelated files/);
});

test("runtime package guard rejects childcare in nonconsumer entity routes and requires it in consumers", (t) => {
  for (const [route, consumer] of entityChildcareRoutes) {
    const { root, manifest } = fixture(t, [childcare], route);
    if (consumer) {
      assert.equal(checkTrace(root, manifest, [childcare]).files, 1, route);
      rmSync(join(root, childcare));
      assert.throws(() => checkTrace(root, manifest, [childcare]), /ENOENT/, route);
    } else {
      assert.throws(() => checkTrace(root, manifest), /traces unrelated files/, route);
    }
  }
});
