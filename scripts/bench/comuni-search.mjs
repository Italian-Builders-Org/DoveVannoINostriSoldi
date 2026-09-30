import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import "../../tests/helpers/register-ts-alias.mjs";

const { searchComuni } = await import("../../src/lib/comuni-search.ts");
const queries = ["roma", "roma capitale", "mantova", "fiumicino", "san", "forli", "c_h501", "zzzzzz"];
const iterations = 50;
console.log(JSON.stringify({ node: process.version, queries, iterations }));
for (let round = 0; round < 3; round++) {
  const start = performance.now();
  const cpu = process.cpuUsage();
  const hashes = queries.map(() => createHash("sha256"));
  for (let iteration = 0; iteration < iterations; iteration++) {
    queries.forEach((query, index) => hashes[index].update(JSON.stringify(searchComuni(query, 8))));
  }
  const used = process.cpuUsage(cpu);
  console.log(JSON.stringify({ round, elapsedMs: performance.now() - start,
    cpuMs: (used.user + used.system) / 1000, rss: process.memoryUsage().rss,
    digests: Object.fromEntries(queries.map((query, index) => [query, hashes[index].digest("hex")])) }));
}
