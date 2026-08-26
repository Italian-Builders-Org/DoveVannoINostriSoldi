#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isMap, isSeq, isScalar, LineCounter, parseDocument } from "yaml";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const WORKFLOWS_DIR = path.join(ROOT, ".github", "workflows");
const LOCAL_ACTIONS_DIR = path.join(ROOT, ".github", "actions");
const PINS_FILE = path.join(ROOT, "scripts", "ci", "action-pins.json");
const SHA_RE = /^[0-9a-f]{40}$/;
const DOCKER_RE = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;
const ACTION_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/;
const MAX_FILE_BYTES = 1_000_000;
const MAX_LINE_BYTES = 16_384;
const MAX_DEPTH = 64;
const MAX_ALIASES = 100;

function fail(message) { throw new Error(message); }

function filesUnder(root, names) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full, names));
    else if (names.has(path.extname(entry.name).toLowerCase()) || names.has(entry.name)) out.push(full);
  }
  return out.sort();
}

function rel(file) { return path.relative(ROOT, file) || file; }

function location(file, lineCounter, node) {
  const offset = node?.range?.[0] ?? 0;
  const position = lineCounter.linePos(offset);
  return `${rel(file)}:${position.line}:${position.col}`;
}

function resolveNode(node, doc) {
  if (node?.constructor?.name !== "Alias") return node;
  try { return node.resolve(doc); } catch (error) { fail(`invalid YAML alias: ${error.message}`); }
}

function mapValue(map, key, doc) {
  map = resolveNode(map, doc);
  if (!isMap(map)) return undefined;
  return map.items.find((pair) => pair.key?.value === key)?.value;
}

function mapPairs(map, key, doc) {
  map = resolveNode(map, doc);
  if (!isMap(map)) return [];
  return map.items.filter((pair) => pair.key?.value === key);
}

function parseYaml(file) {
  const source = fs.readFileSync(file);
  if (source.byteLength > MAX_FILE_BYTES) fail(`${rel(file)}: file exceeds ${MAX_FILE_BYTES} bytes`);
  for (const [index, line] of source.toString("utf8").split("\n").entries()) {
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) fail(`${rel(file)}:${index + 1}: line exceeds ${MAX_LINE_BYTES} bytes`);
  }
  const text = source.toString("utf8");
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: true, version: "1.2" });
  if (doc.errors.length) fail(`${rel(file)}:${doc.errors[0].message}`);
  let aliases = 0;
  const walk = (node, depth = 0) => {
    if (!node) return;
    if (depth > MAX_DEPTH) fail(`${location(file, lineCounter, node)}: YAML nesting exceeds ${MAX_DEPTH}`);
    if (node.constructor?.name === "Alias") {
      aliases += 1;
      if (aliases > MAX_ALIASES) fail(`${location(file, lineCounter, node)}: too many YAML aliases`);
      try { node.resolve(doc); } catch (error) { fail(`${location(file, lineCounter, node)}: invalid YAML alias: ${error.message}`); }
      return;
    }
    if (isMap(node)) for (const pair of node.items) { walk(pair.key, depth + 1); walk(pair.value, depth + 1); }
    else if (isSeq(node)) for (const item of node.items) walk(item, depth + 1);
  };
  walk(doc.contents);
  return { doc, lineCounter };
}

function scalarRef(file, lineCounter, node, doc, inheritedComment = null) {
  let value = node;
  if (node?.constructor?.name === "Alias") {
    try { value = node.resolve(doc); } catch (error) { fail(`${location(file, lineCounter, node)}: invalid YAML alias: ${error.message}`); }
  }
  if (!isScalar(value) || typeof value.value !== "string") fail(`${location(file, lineCounter, node)}: uses must be a scalar string`);
  return { ref: value.value, comment: value.comment?.trim() || inheritedComment?.trim() || null, at: location(file, lineCounter, node) };
}

function checkRef(file, lineCounter, node, pins, doc, inheritedComment = null) {
  const { ref, comment, at } = scalarRef(file, lineCounter, node, doc, inheritedComment);
  if (ref.startsWith("./")) return;
  if (ref.startsWith("docker://")) {
    if (!DOCKER_RE.test(ref)) fail(`${at}: Docker action must use an immutable @sha256:<digest>`);
    return;
  }
  if (ref.includes("${{") || !ref.includes("@")) fail(`${at}: mutable or expression action reference is not allowed`);
  const [name, sha] = ref.split("@", 2);
  if (!ACTION_RE.test(name) || !SHA_RE.test(sha)) fail(`${at}: unsupported or mutable action; use owner/repo@40hexsha`);
  if (!pins[name]) fail(`${at}: action is missing from action-pins.json`);
  if (pins[name].sha !== sha) fail(`${at}: SHA does not match action-pins.json (expected ${pins[name].sha})`);
  if (comment !== pins[name].tag) fail(`${at}: version comment must be '# ${pins[name].tag}'`);
}

function checkWorkflow(file, pins) {
  const { doc, lineCounter } = parseYaml(file);
  const jobs = mapValue(doc.contents, "jobs", doc);
  if (!isMap(jobs)) return 0;
  let count = 0;
  for (const job of jobs.items) {
    const jobValue = resolveNode(job.value, doc);
    if (!isMap(jobValue)) continue;
    for (const pair of mapPairs(jobValue, "uses", doc)) { checkRef(file, lineCounter, pair.value, pins, doc, jobValue.comment); count += 1; }
    const steps = mapValue(jobValue, "steps", doc);
    if (!isSeq(steps)) continue;
    for (const step of steps.items) {
      const stepValue = resolveNode(step, doc);
      for (const pair of mapPairs(stepValue, "uses", doc)) { checkRef(file, lineCounter, pair.value, pins, doc, stepValue.comment); count += 1; }
    }
  }
  return count;
}

function checkComposite(file, pins) {
  const { doc, lineCounter } = parseYaml(file);
  const steps = mapValue(mapValue(doc.contents, "runs", doc), "steps", doc);
  if (!isSeq(steps)) return 0;
  let count = 0;
  for (const step of steps.items) {
    const stepValue = resolveNode(step, doc);
    for (const pair of mapPairs(stepValue, "uses", doc)) { checkRef(file, lineCounter, pair.value, pins, doc, stepValue.comment); count += 1; }
  }
  return count;
}

function loadPins() {
  let data;
  try { data = JSON.parse(fs.readFileSync(PINS_FILE, "utf8")); }
  catch (error) { fail(`invalid action pin lock: ${error.message}`); }
  return validatePins(data);
}

function validatePins(data) {
  const expected = new Set(["$schema", "description", "pinnedAt", "actions", "tools"]);
  if (!data || typeof data !== "object" || Object.keys(data).some((key) => !expected.has(key)) || Object.keys(data).length !== expected.size) fail("invalid action pin lock: unexpected top-level keys");
  if (typeof data.$schema !== "string" || typeof data.description !== "string" || typeof data.pinnedAt !== "string") fail("invalid action pin lock: metadata must be strings");
  if (!data.actions || typeof data.actions !== "object" || Array.isArray(data.actions) || !Object.keys(data.actions).length) fail("invalid action pin lock: actions must be a non-empty object");
  if (!data.tools || typeof data.tools !== "object" || Array.isArray(data.tools)) fail("invalid action pin lock: tools must be an object");
  for (const [name, entry] of Object.entries(data.actions)) {
    if (!ACTION_RE.test(name) || !entry || typeof entry !== "object" || Object.keys(entry).sort().join() !== "sha,tag") fail(`invalid action pin lock: invalid entry for ${name}`);
    if (typeof entry.tag !== "string" || !entry.tag.trim() || typeof entry.sha !== "string" || !SHA_RE.test(entry.sha)) fail(`invalid action pin lock: invalid tag or SHA for ${name}`);
  }
  return data.actions;
}

function main() {
  try {
    const pins = loadPins();
    const workflows = filesUnder(WORKFLOWS_DIR, new Set([".yml", ".yaml"]));
    const actions = filesUnder(LOCAL_ACTIONS_DIR, new Set(["action.yml", "action.yaml"]));
    let count = 0;
    for (const file of workflows) count += checkWorkflow(file, pins);
    for (const file of actions) count += checkComposite(file, pins);
    console.log(`Checked ${workflows.length + actions.length} workflow/action file(s) (${workflows.length} workflow, ${actions.length} local action), ${count} third-party action reference(s), ${Object.keys(pins).length} pinned action(s)`);
    console.log("✅ All third-party actions are SHA-pinned");
    return 0;
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();

export { checkComposite, checkRef, checkWorkflow, loadPins, parseYaml, validatePins };
