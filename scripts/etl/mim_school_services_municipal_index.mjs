#!/usr/bin/env node
/**
 * Build the compact municipal MIM school index used by /comuni.
 * Reads committed integrated row shards only (offline, fail-closed).
 */
import { createGunzip } from "node:zlib";
import { createReadStream, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const spec = JSON.parse(readFileSync(join(root, "scripts/etl/specs/mim-school-services.source.json"), "utf8"));
const dir = join(root, "src/data/generated/integrated/rows");
const out = join(root, "src/data/generated/mim-school-services-municipal.json");
const files = readdirSync(dir).filter((f) => f.startsWith("mim-scuole-statali-comuni.") && f.endsWith(".jsonl.gz")).sort();
if (files.length === 0) throw new Error("Nessuno shard MIM comunale trovato.");

const byIstat = {};
let n = 0;
for (const file of files) {
  const rl = createInterface({ input: createReadStream(join(dir, file)).pipe(createGunzip()) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const cells = row.cells || row;
    const istat = cells["Codice ISTAT comune"];
    const cadastral = cells["Codice catastale"];
    const sites = Number(cells["Sedi scolastiche statali"]);
    const other = Number(cells["Altri codici anagrafici"]);
    if (!/^\d{6}$/.test(istat) || !/^[A-Z][0-9]{3}$/.test(cadastral)) {
      throw new Error(`Riga MIM invalida in ${file}`);
    }
    if (!Number.isInteger(sites) || sites < 0 || !Number.isInteger(other) || other < 0) {
      throw new Error(`Conteggi MIM invalidi per ${istat}`);
    }
    if (byIstat[istat]) throw new Error(`Duplicato ISTAT ${istat}`);
    byIstat[istat] = { c: cadastral, s: sites, o: other };
    n += 1;
  }
}
if (n !== spec.expected.municipalities) {
  throw new Error(`Attesi ${spec.expected.municipalities} comuni, trovati ${n}`);
}
const payload = {
  schemaVersion: 1,
  datasetId: spec.datasetId,
  schoolYear: spec.schoolYearLabel,
  dataAsOf: spec.dataAsOf,
  landingUrl: spec.source.landingUrl,
  municipalityCount: n,
  municipalities: byIstat,
};
writeFileSync(out, `${JSON.stringify(payload)}\n`);
console.log(`Wrote ${out} (${n} comuni)`);
