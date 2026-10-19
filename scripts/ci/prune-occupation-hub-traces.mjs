import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OCCUPATION_INDEX = "src/data/generated/rgs-conto-annuale-occupazione-ente-index";
const HUB_MANIFESTS = [
  ".next/server/app/personale-pa/conto-annuale/page.js.nft.json",
  ".next/server/app/snapshot-pages/personale-pa/conto-annuale/page.js.nft.json",
];

const FORBIDDEN_PREFIXES = [
  `${OCCUPATION_INDEX}/resolve.json`,
  `${OCCUPATION_INDEX}/by-code.json`,
  `${OCCUPATION_INDEX}/shards/`,
];

export function pruneOccupationHubTrace(root, manifestPath) {
  const manifest = resolve(root, manifestPath);
  const trace = JSON.parse(readFileSync(manifest, "utf8"));
  if (trace.version !== 1 || !Array.isArray(trace.files)) {
    throw new Error(`Invalid runtime trace: ${manifestPath}`);
  }
  const kept = trace.files.filter((file) => {
    const normalized = relative(root, resolve(dirname(manifest), file)).replaceAll("\\", "/");
    return !FORBIDDEN_PREFIXES.some((prefix) =>
      normalized === prefix || normalized.startsWith(prefix));
  });
  if (kept.length === trace.files.length) return false;
  writeFileSync(manifest, JSON.stringify({ version: 1, files: kept }));
  return true;
}

export function pruneOccupationHubTraces(root = process.cwd()) {
  root = resolve(root);
  let pruned = 0;
  for (const manifestPath of HUB_MANIFESTS) {
    if (pruneOccupationHubTrace(root, manifestPath)) pruned += 1;
  }
  return pruned;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const pruned = pruneOccupationHubTraces();
  console.log(`Occupation hub traces pruned: ${pruned} manifest(s).`);
}
