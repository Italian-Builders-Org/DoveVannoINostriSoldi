import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkWorkflow, validatePins } from "../scripts/ci/check-action-pins.mjs";

const sha = "a".repeat(40);
const pins = { "actions/checkout": { tag: "v6", sha } };

function fixture(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dvns-action-pins-"));
  const file = path.join(dir, "workflow.yml");
  fs.writeFileSync(file, source);
  return file;
}

test("checks quoted, spaced, flow and Unicode-escaped uses keys", () => {
  const file = fixture(`jobs:\n  build:\n    steps:\n      - { "\\u0075ses": actions/checkout@${sha} } # v6\n      - uses : actions/checkout@${sha} # v6\n`);
  assert.equal(checkWorkflow(file, pins), 2);
});

test("resolves block and flow anchors and aliases", () => {
  const file = fixture(`jobs:\n  build:\n    uses: &checkout actions/checkout@${sha} # v6\n  test: { uses: *checkout }\n`);
  assert.equal(checkWorkflow(file, pins), 2);
  const step = fixture(`jobs:\n  build:\n    steps:\n      - &pinned { uses: actions/checkout@${sha} } # v6\n      - *pinned\n`);
  assert.equal(checkWorkflow(step, pins), 2);
});

test("inherits flow job comments for reusable workflows", () => {
  const file = fixture(`jobs:\n  build: { uses: actions/checkout@${sha} } # v6\n`);
  assert.equal(checkWorkflow(file, pins), 1);
  const wrong = fixture(`jobs:\n  build: { uses: actions/checkout@${sha} } # v5\n`);
  assert.throws(() => checkWorkflow(wrong, pins), /version comment/);
});

test("checks mutable references and Docker policy", () => {
  const tag = fixture("jobs:\n  build:\n    uses: actions/checkout@v6\n");
  assert.throws(() => checkWorkflow(tag, pins), /mutable|unsupported|version comment|SHA/);
  const docker = fixture("jobs:\n  build:\n    uses: docker://alpine:3.20\n");
  assert.throws(() => checkWorkflow(docker, pins), /Docker action/);
  const digest = fixture(`jobs:\n  build:\n    uses: docker://alpine@sha256:${"b".repeat(64)}\n`);
  assert.equal(checkWorkflow(digest, pins), 1);
});

test("ignores with.uses and run strings, including comments after flow maps", () => {
  const file = fixture(`jobs:\n  build:\n    steps:\n      - run: 'echo "{ uses: actions/checkout@v6 }"'\n        with: { uses: actions/checkout@v6 }\n      - { uses: actions/checkout@${sha} } # v6\n`);
  assert.equal(checkWorkflow(file, pins), 1);
});

test("duplicate keys are rejected by the YAML AST", () => {
  const file = fixture(`jobs:\n  build:\n    steps:\n      - uses: actions/checkout@${sha} # v6\n        uses: actions/checkout@${sha} # v6\n`);
  assert.throws(() => checkWorkflow(file, pins), /unique/);
});

test("lock schema rejects corrupt and unexpected entries", () => {
  assert.deepEqual(validatePins({ $schema: "1", description: "x", pinnedAt: "today", actions: pins, tools: {} }), pins);
  assert.throws(() => validatePins({ actions: pins }), /top-level/);
  assert.throws(() => validatePins({ $schema: "1", description: "x", pinnedAt: "today", actions: { ...pins, "unknown": { tag: "v1", sha } }, tools: {} }), /invalid entry/);
  assert.throws(() => validatePins({ $schema: "1", description: "x", pinnedAt: "today", actions: { "actions/checkout": { tag: "v6", sha: "bad" } }, tools: {} }), /invalid tag or SHA/);
});

test("file and line bounds fail closed", () => {
  assert.throws(() => checkWorkflow(fixture(`jobs:\n  build:\n    uses: ${"x".repeat(16_500)}\n`), pins), /line exceeds/);
  assert.throws(() => checkWorkflow(fixture("#".repeat(1_000_001)), pins), /file exceeds/);
});
