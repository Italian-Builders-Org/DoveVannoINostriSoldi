import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import "../../tests/helpers/register-ts-alias.mjs";

// Pass a git-show copy to compare revisions without changing HEAD or snapshots.
const adapter = await import(pathToFileURL(resolve(process.argv[2] || "src/lib/data/anac-entity-procurement-page.ts")));
const cpv = await import("../../src/lib/data/anac-procurement-cpv.ts");
const cases = [];
for (const codiceIpa of ["c_h501", "c_f205", "c_a944"]) {
  const state = await adapter.loadAnacEntityProcurementPage({ codiceIpa, currentEntityCf: null, verifyLiveFiscalCode: false });
  if (state.status !== "available") throw new Error(`Unavailable profile: ${codiceIpa} (${state.status})`);
  const profile = state.profile;
  const record = await cpv.loadAnacCpvRecord(profile);
  if (!record) throw new Error(`Unavailable CPV record: ${codiceIpa}`);
  const codes = cpv.anacCpvOptions(record).options
    .sort((left, right) => right.procedures - left.procedures).slice(0, 3).map((option) => option.code);
  const years = adapter.anacAwardYearOptions(profile).years.slice(0, 3).map((option) => option.year);
  cases.push({ profile, cigs: new Set(profile.procedures.map((row) => row.cig)), years });
  for (const code of [...codes, "unclassified"]) {
    const cigs = new Set(record.procedures.filter((row) => code === "unclassified"
      ? cpv.normalizeAnacCpv(row.rawCode) === null : cpv.normalizeAnacCpv(row.rawCode) === code).map((row) => row.cig));
    cases.push({ profile, cigs, years });
  }
}

console.log(JSON.stringify({ node: process.version, platform: process.platform, cases: cases.length, repetitions: 10 }));
const digests = new Set();
for (let round = 0; round < 3; round++) {
  const start = process.cpuUsage();
  let result;
  for (let repeat = 0; repeat < 10; repeat++) {
    result = cases.map(({ profile, cigs, years }) => {
      const subset = adapter.selectAnacEntityProcurementCigs(profile, cigs);
      return [subset, ...[...years, "undated", "2030"].map((year) => adapter.filterAnacProcurementByAwardYear(subset, year))];
    });
  }
  const cpu = process.cpuUsage(start);
  const digest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
  console.log(JSON.stringify({ round, cpuMs: (cpu.user + cpu.system) / 1000, digest, rss: process.memoryUsage().rss, heap: process.memoryUsage().heapUsed }));
  digests.add(digest);
}
if (digests.size !== 1) throw new Error("Unstable output across passes");
