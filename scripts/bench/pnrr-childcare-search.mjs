import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import "../ci/register-source-alias.mjs";

// --module permits comparison with an unmodified source copy on the same runtime.
const modulePath = process.argv.find((argument) => argument.startsWith("--module="))?.slice(9);
const { queryPnrrChildcare, pnrrChildcareData } = await import(modulePath
  ? pathToFileURL(resolve(modulePath)).href : "../../src/lib/pnrr-childcare-snapshot.ts");
const queries = [
  {}, { region: "Lazio", limit: 7 }, { region: "12", offset: 7, limit: 100 },
  { province: "RM", limit: 100 }, { query: "asilo", limit: 100 },
  { query: "COMUNE DI PIOVENE ROCCHETTE", limit: 100 },
  { query: "riqualificazione", region: "Lazio", limit: 100 },
  { query: "ZZZZZZZZ" }, { query: "  Città  " }, { query: "  " },
  { query: "à" }, { query: "\u0301" }, { cup: pnrrChildcareData.projects[0].cup },
  { cup: "bad" }, { cup: "A00000000000000" }, { query: "x".repeat(201) },
  { limit: 101 }, { offset: 100_001 }, { cup: pnrrChildcareData.projects[0].cup, region: "Lazio" },
  ...Array.from({ length: 128 }, (_, index) => ({
    query: `__absent_${index}__`, region: index % 2 ? "Lazio" : undefined,
  })),
];

function result(query) {
  try { return { ok: queryPnrrChildcare(query) }; }
  catch (error) {
    return { error: { name: error.name, code: error.code, message: error.message } };
  }
}

function measure(label, run) {
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const cpu = process.cpuUsage();
  const start = performance.now();
  const outputs = run();
  const wallMs = performance.now() - start;
  const used = process.cpuUsage(cpu);
  const body = JSON.stringify(outputs);
  global.gc?.();
  console.log(JSON.stringify({
    label, node: process.version, projects: pnrrChildcareData.projects.length,
    cpuMs: (used.user + used.system) / 1000, wallMs,
    heapBefore, heapAfter: process.memoryUsage().heapUsed, rss: process.memoryUsage().rss,
    digest: createHash("sha256").update(body).digest("hex"), bytes: Buffer.byteLength(body),
  }));
}

// Module parsing/validation happens before this measurement. Default and exact CUP
// requests do not populate the text index; isolate the first filtered request.
measure("first-text-query", () => result({ query: "asilo", limit: 100 }));
for (let pass = 0; pass < 5; pass++) {
  measure(`query-batch-${pass}`, () => queries.map(result));
}
