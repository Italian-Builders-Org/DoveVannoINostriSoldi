#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "../../tests/helpers/register-ts-alias.mjs";

const { PUBLISHED_MONTHLY_REPORTS } = await import("../../src/content/monthly-reports/published/index.ts");
const { createMonthlyReportsCatalog } = await import("../../src/lib/monthly-reports.ts");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publishedDir = resolve(ROOT, "src/content/monthly-reports/published");
const indexSource = readFileSync(resolve(publishedDir, "index.ts"), "utf8");

if (/drafts|data\/generated|fetch\s*\(/u.test(indexSource)) {
  throw new Error("Registry report non valido: bozze, snapshot correnti o fetch non possono essere importati");
}
for (const name of readdirSync(publishedDir).filter((entry) => entry.endsWith(".ts") && entry !== "index.ts")) {
  if (!indexSource.includes(`./${name.slice(0, -3)}`)) throw new Error(`Edizione pubblicata non registrata: ${name}`);
  const source = readFileSync(resolve(publishedDir, name), "utf8");
  if (/content\/monthly-reports\/drafts|data\/generated|fetch\s*\(/u.test(source)) {
    throw new Error(`Edizione pubblicata dipendente da dati mutabili: ${name}`);
  }
}
createMonthlyReportsCatalog(PUBLISHED_MONTHLY_REPORTS);
process.stdout.write(`Report mensili verificati: ${PUBLISHED_MONTHLY_REPORTS.length}\n`);
