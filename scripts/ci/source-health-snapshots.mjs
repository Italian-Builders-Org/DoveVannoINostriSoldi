import { readFileSync, writeFileSync } from "node:fs";
import "./register-source-alias.mjs";
const { buildSourceHealthSnapshots } = await import("../../src/lib/data/source-health-snapshots.ts");

const artifact = new URL("../../src/data/generated/source-health-snapshots.json", import.meta.url);
const expected = `${JSON.stringify(buildSourceHealthSnapshots(), null, 2)}\n`;
if (process.argv.includes("--write")) {
  writeFileSync(artifact, expected);
} else if (readFileSync(artifact, "utf8") !== expected) {
  throw new Error("Riepilogo stato fonti non aggiornato: eseguire npm run source-health:generate");
}
console.log("Riepilogo stato fonti riconciliato con gli snapshot validati.");
