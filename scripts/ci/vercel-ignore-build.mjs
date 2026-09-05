import { execFileSync } from "node:child_process";

// Vercel runs this before installation: 0 skips the deployment, 1 builds it.
// Compare with the last successful deployment, not HEAD^: earlier code changes
// may still be undeployed after a failed build or a push containing many commits.
const previous = process.env.VERCEL_GIT_PREVIOUS_SHA;
const current = process.env.VERCEL_GIT_COMMIT_SHA;
const sha = /^[0-9a-f]{40}$/i;

function decide() {
  if (!sha.test(previous ?? "") || !sha.test(current ?? "") || previous === current) {
    return { skip: false, reason: "First deployment, redeploy, or missing commit metadata." };
  }

  let files;
  try {
    files = execFileSync("git", [
      "diff", "--name-only", "--no-renames", "-z", previous, current, "--",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 })
      .split("\0").filter(Boolean);
  } catch {
    return { skip: false, reason: "Cannot compare deployed commits (for example, shallow history)." };
  }

  const runtimeFile = files.find((file) => !(
    /^(README|CONTRIBUTING|AGENTS|CLAUDE|CODE_OF_CONDUCT|SECURITY)\.md$/.test(file) ||
    (/^docs\/.*\.md$/.test(file) && !file.startsWith("docs/research/data/")) ||
    file.startsWith("tests/") ||
    file.startsWith(".github/ISSUE_TEMPLATE/") ||
    file === ".github/PULL_REQUEST_TEMPLATE.md"
  ));
  if (runtimeFile) return { skip: false, reason: `Deployment input changed: ${runtimeFile}` };
  // In particular, docs/research/data and scripts/etl/specs are runtime inputs.
  // Unknown paths build by default; don't turn this into a list of source paths.
  return { skip: true, reason: `${files.length} changed files; only documentation/tests, or identical trees.` };
}

const result = decide();
console.log(`${result.skip ? "SKIP" : "BUILD"}: ${result.reason}`);
process.exitCode = result.skip ? 0 : 1;
