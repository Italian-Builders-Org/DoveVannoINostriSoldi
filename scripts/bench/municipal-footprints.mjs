import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import "../ci/register-source-alias.mjs";

const { getComuniFootprintByIpaCode } = await import("../../src/lib/comuni-footprint.ts");
const codes = ["c_e897", "c_f205", "c_h501", "c_a783", "c_f839", "c_d612"];

for (let pass = 0; pass < 3; pass++) {
  const cpu = process.cpuUsage();
  const start = performance.now();
  const rows = [];
  for (const code of codes) rows.push(await getComuniFootprintByIpaCode(code));
  const used = process.cpuUsage(cpu);
  console.log(JSON.stringify({
    pass,
    node: process.version,
    codes,
    wallMs: performance.now() - start,
    cpuMs: (used.user + used.system) / 1000,
    rss: process.memoryUsage().rss,
    digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  }));
}
