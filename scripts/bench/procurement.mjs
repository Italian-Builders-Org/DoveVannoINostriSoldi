import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import "../../tests/helpers/register-ts-alias.mjs";

const { loadAnacEntityProcurementPage } = await import("../../src/lib/data/anac-entity-procurement-page.ts");
const { loadAnacCpvRecord } = await import("../../src/lib/data/anac-procurement-cpv.ts");
const { getOperatorHistory } = await import("../../src/lib/data/anac-operator-history.ts");
const records = (path) => gunzipSync(readFileSync(path)).toString("utf8").trim().split("\n").map(JSON.parse);
const entities = ["00", "01"].flatMap((prefix) => records(`src/data/generated/anac-entity-procurement-page/entities/${prefix}.jsonl.gz`).slice(0, 8).map((row) => row.codiceIpa));
const operators = records("src/data/generated/anac-operator-history/00.jsonl.gz").slice(0, 16).map((row) => row.ref);
console.log(JSON.stringify({ node: process.version, entities, operators }));
for (const [name, run] of Object.entries({
  entities: async () => {
    const result = [];
    for (const codiceIpa of entities) {
      const state = await loadAnacEntityProcurementPage({ codiceIpa, currentEntityCf: null, verifyLiveFiscalCode: false });
      if (state.status !== "available") throw new Error(JSON.stringify(state));
      result.push([state.profile, await loadAnacCpvRecord(state.profile)]);
    }
    return result;
  },
  operators: () => operators.map(getOperatorHistory),
})) {
  for (let round = 0; round < 4; round++) {
    const start = performance.now();
    const result = await run();
    const elapsedMs = performance.now() - start;
    console.log(JSON.stringify({ name, round, elapsedMs, digest: createHash("sha256").update(JSON.stringify(result)).digest("hex"), rss: process.memoryUsage().rss }));
  }
}
