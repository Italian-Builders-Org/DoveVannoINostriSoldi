import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ENTITY = "src/data/generated/anac-entity-procurement-page";
const CPV = "src/data/generated/anac-procurement-cpv";
const OPERATOR = "src/data/generated/anac-operator-awards-index";
const SPEC = "scripts/etl/specs";
const MEDICAL_DEVICE_ROW_PREFIXES = [
  "src/data/generated/integrated/rows/salute-spesa-dispositivi-2020.",
  "src/data/generated/integrated/rows/salute-spesa-dispositivi-2021.",
  "src/data/generated/integrated/rows/salute-dispositivi-bdrdm.",
  "src/data/generated/integrated/rows/salute-classificazione-cnd.",
];
const MEDICAL_DEVICE_QUERY_ROUTES = new Set([
  "api/assistant/route.js.nft.json",
  "api/assistant/chat/route.js.nft.json",
  "api/dati/[dataset]/route.js.nft.json",
  "api/mcp/route.js.nft.json",
  "dati/page.js.nft.json",
  "dati/[dataset]/page.js.nft.json",
  "mcp/page.js.nft.json",
]);
const HISTORY_ROUTES = new Set([
  "spese/sanita/storico/page.js.nft.json",
  "api/spese/sanita/storico/route.js.nft.json",
  "stato/legislature/page.js.nft.json",
  "api/spese/stato/legislature/route.js.nft.json",
]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** Check the emitted package, including data opened dynamically at runtime. */
export function checkTrace(root, manifest, required = [], forbidden = [], forbiddenFilePrefixes = []) {
  const trace = JSON.parse(readFileSync(manifest, "utf8"));
  if (trace.version !== 1 || !Array.isArray(trace.files)) {
    throw new Error(`Invalid runtime trace: ${manifest}`);
  }
  const paths = new Set(trace.files.map((file) => resolve(dirname(manifest), file)));
  const files = [...paths].map((file) => relative(root, file).replaceAll("\\", "/"));
  const unexpected = files.filter((file) => /^(tests|docs|research)\//.test(file)
    || forbidden.some((prefix) => file.startsWith(`${prefix}/`))
    || forbiddenFilePrefixes.some((prefix) => file.startsWith(prefix)));
  if (unexpected.length) throw new Error(`${relative(root, manifest)} traces unrelated files: ${unexpected.slice(0, 5).join(", ")}`);
  const missing = required.filter((file) => !paths.has(resolve(root, file)));
  if (missing.length) throw new Error(`${relative(root, manifest)} omits runtime files: ${missing.slice(0, 5).join(", ")}`);
  // stat also fails if a trace points at an absent file; normalize before counting.
  return { files: paths.size, bytes: [...paths].reduce((sum, file) => sum + statSync(file).size, 0) };
}

export function checkRuntimeTraces(root = process.cwd()) {
  root = resolve(root);
  const json = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
  const entityFiles = [
    `${ENTITY}/meta.json`,
    ...json(`${ENTITY}/meta.json`).shards.map((shard) => shard.path),
    `${SPEC}/anac-entity-procurement-page.source.json`,
    `${SPEC}/anac-entity-procurement.source.json`,
    `${SPEC}/anac-awardees.source.json`,
  ];
  const cpvSpec = json(`${SPEC}/anac-procurement-cpv.source.json`);
  const cpvFiles = [
    `${CPV}/meta.json`, `${SPEC}/anac-procurement-cpv.source.json`,
    cpvSpec.profiles.path, cpvSpec.sourceLock.path,
    ...json(`${CPV}/meta.json`).shards.map((shard) => `${CPV}/${shard.id}.jsonl.gz`),
  ];
  const operatorMeta = json(`${OPERATOR}/meta.json`);
  const operatorCommonFiles = [
    `${OPERATOR}/meta.json`, `${OPERATOR}/search.jsonl.gz`,
    `${SPEC}/anac-operator-awards-index.source.json`,
    ...(operatorMeta.summaries ? [operatorMeta.summaries.path] : []),
  ];
  const browse = "src/data/generated/anac-operator-browse";
  const operatorBrowseFiles = [
    ...operatorCommonFiles, `${browse}/manifest.json`,
    ...Object.keys(json(`${browse}/manifest.json`).orders).map((order) => `${browse}/${order}.jsonl.gz`),
  ];
  const history = "src/data/generated/anac-operator-history";
  const historyManifest = json(`${history}/manifest.json`);
  const operatorDetailFiles = [
    `${OPERATOR}/meta.json`, `${SPEC}/anac-operator-awards-index.source.json`,
    `${SPEC}/anac-cig-2007-2025.source.json`, `${history}/manifest.json`,
    ...historyManifest.shards.map(shard => `${history}/${shard.id}.jsonl.gz`),
    ...historyManifest.packs.map(pack => `${history}/${pack.id}.pack`),
  ];
  const peers = "src/data/generated/anac-procurement-peers";
  const peerFiles = [
    `${peers}/meta.json`, `${peers}/snapshot.json.gz`, `${SPEC}/anac-procurement-peers.source.json`,
    ...Object.values(json(`${SPEC}/anac-procurement-peers.source.json`).inputs).map((entry) => entry.path),
  ];
  const requirements = new Map([
    ["enti/[codice]/page.js.nft.json", [...entityFiles, ...cpvFiles]],
    ["enti/[codice]/appalti/page.js.nft.json", [...entityFiles, ...cpvFiles]],
    ["enti/[codice]/appalti/confronti/page.js.nft.json", peerFiles],
    ["appalti/operatori/page.js.nft.json", operatorBrowseFiles],
    ["appalti/operatori/[ref]/page.js.nft.json", operatorDetailFiles],
  ]);
  for (const [file, routes] of [
    ["integrated/rows/istat-economia-non-osservata-territori.part-00000.jsonl.gz", ["dati/[dataset]/page", "api/dati/[dataset]/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["istat-bes-relazioni-2011-2024.data.json", ["api/territori/bes-relazioni/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["istat-bes-politica-2004-2024.data.json", ["api/territori/bes-politica/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["istat-bes-sicurezza-2004-2023.data.json", ["api/territori/bes-sicurezza/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["istat-bes-paesaggio-2004-2023.data.json", ["api/territori/bes-paesaggio/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["istat-bes-servizi-2004-2024.data.json", ["api/territori/bes-servizi/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["istat-bes-ambiente-2004-2023.data.json", ["api/territori/bes-ambiente/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["istat-bes-innovazione-2004-2023.data.json", ["api/territori/bes-innovazione/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["istat-poverta-soglia-assoluta-2005-2024.data.json", ["api/territori/poverta-soglia-assoluta/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["integrated/rows/eurostat-disuguaglianza-redditi.part-00000.jsonl.gz", ["disuguaglianza/page", "dati/[dataset]/page", "api/dati/[dataset]/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["pnrr-childcare.data.json", ["opere/page", "coesione/page", "coesione/asili/page", "progetti/[cup]/page", "enti/[codice]/page", "api/enti/[codice]/route", "api/pnrr/asili/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["istat-pensions-2012-2022.data.json", ["spese/pensioni/page", "api/spese/pensioni/route", "fonti/page", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["istat-pensions-2012-2022.meta.json", ["spese/pensioni/page", "api/spese/pensioni/route", "fonti/page", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["opencivitas-2015.json", ["api/spese/opencivitas-2015/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["opencivitas-2016.json", ["api/spese/opencivitas-2016/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["opencivitas-2017.json", ["api/spese/opencivitas-2017/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["inps-naspi-2018-2022.data.json", ["fonti/page", "api/lavoro/naspi/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["inps-assegno-unico-2022-2024.data.json", ["fonti/page", "api/famiglia/assegno-unico/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["inps-integrazioni-salariali-2023.data.json", ["fonti/page", "api/lavoro/integrazioni-salariali/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["inps-cig-fondi-solidarieta-2023-2024.data.json", ["fonti/page", "api/lavoro/cig-fondi-solidarieta/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["inl-vigilanza-2025.data.json", ["fonti/page", "api/lavoro/vigilanza-inl/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
    ["aifa-spesa-consumi-2022-2025.data.json", ["fonti/page", "api/spese/sanita/farmaci/route", "api/assistant/chat/route", "mcp/page", "api/mcp/route"]],
  ]) {
    for (const route of routes) {
      const manifest = `${route}.js.nft.json`;
      requirements.set(manifest, [...(requirements.get(manifest) ?? []), `src/data/generated/${file}`]);
    }
  }
  const appRoot = resolve(root, ".next/server/app");
  const results = [];
  for (const manifest of walk(appRoot).filter((path) => path.endsWith(".nft.json"))) {
    const route = relative(appRoot, manifest).replaceAll("\\", "/");
    const forbidden = route.startsWith("appalti/operatori/") ? [ENTITY, CPV]
      : route.startsWith("enti/") || route.startsWith("api/enti/") ? [OPERATOR] : [];
    if (route !== "appalti/operatori/[ref]/page.js.nft.json") forbidden.push(history);
    if (route.startsWith("appalti/operatori/")) forbidden.push(`${OPERATOR}/operators`);
    if (HISTORY_ROUTES.has(route) || route === "fonti/stato/page.js.nft.json"
      || route === "api/fonti/stato/route.js.nft.json") {
      forbidden.push("data/source-ledger", "src/data/generated/integrated", OPERATOR, ENTITY, CPV);
    }
    const forbiddenFilePrefixes = MEDICAL_DEVICE_QUERY_ROUTES.has(route) ? [] : MEDICAL_DEVICE_ROW_PREFIXES;
    results.push({ route, ...checkTrace(root, manifest, requirements.get(route), forbidden, forbiddenFilePrefixes) });
    requirements.delete(route);
  }
  if (requirements.size) throw new Error(`Missing runtime traces: ${[...requirements.keys()].join(", ")}`);
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const results = checkRuntimeTraces();
  console.log(`Runtime traces: ${results.length} checked; required ANAC artifacts present; no tests, docs or research bundled.`);
  for (const result of results.filter(({ route }) => /^(enti\/\[codice\]|appalti\/operatori)/.test(route))) {
    console.log(`${result.route}: ${result.files} files, ${(result.bytes / 1024 / 1024).toFixed(1)} MiB`);
  }
}
