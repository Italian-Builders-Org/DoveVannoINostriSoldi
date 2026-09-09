import { execFileSync } from "node:child_process";

// Vercel esegue questo script prima di installare: 0 salta il deployment, 1 lo avvia.
// Il confronto parte dall'ultimo deployment riuscito: dopo un build fallito o
// un push con più commit, HEAD^ può già contenere codice non ancora distribuito.
const previous = process.env.VERCEL_GIT_PREVIOUS_SHA;
const current = process.env.VERCEL_GIT_COMMIT_SHA;
const sha = /^[0-9a-f]{40}$/i;

function decide() {
  if (!sha.test(previous ?? "") || !sha.test(current ?? "") || previous === current) {
    return { skip: false, reason: "Primo deployment, redeploy o metadati del commit mancanti." };
  }

  let files;
  try {
    files = execFileSync("git", [
      "diff", "--name-only", "--no-renames", "-z", previous, current, "--",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 })
      .split("\0").filter(Boolean);
  } catch {
    return { skip: false, reason: "Impossibile confrontare i commit distribuiti, per esempio con cronologia incompleta." };
  }

  const runtimeFile = files.find((file) => !(
    /^(README|CONTRIBUTING|AGENTS|CLAUDE|CODE_OF_CONDUCT|SECURITY)\.md$/.test(file) ||
    (/^docs\/.*\.md$/.test(file) && !file.startsWith("docs/research/data/")) ||
    file.startsWith("tests/") ||
    // I comandi Vercel provengono da vercel.json e package.json; la CI è separata.
    file === ".github/workflows/ci.yml" ||
    file === "scripts/ci/action-pins.json" ||
    file.startsWith(".github/ISSUE_TEMPLATE/") ||
    file === ".github/PULL_REQUEST_TEMPLATE.md"
  ));
  if (runtimeFile) return { skip: false, reason: `Input del deployment modificato: ${runtimeFile}` };
  // docs/research/data e scripts/etl/specs sono input del runtime.
  // I percorsi sconosciuti richiedono il build: l'elenco contiene solo le eccezioni.
  return { skip: true, reason: `${files.length} file modificati: solo documentazione, test o configurazione CI, oppure contenuti identici.` };
}

const result = decide();
console.log(`${result.skip ? "SKIP" : "BUILD"}: ${result.reason}`);
process.exitCode = result.skip ? 0 : 1;
