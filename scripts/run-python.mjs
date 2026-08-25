#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

const REQUIRED_MAJOR = 3;
const REQUIRED_MINOR = 12;
const requested = process.env.PYTHON?.trim();

function uvPython() {
  const result = spawnSync("uv", ["python", "find", "3.12"], {
    encoding: "utf8",
    env: {
      ...process.env,
      UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? join(tmpdir(), "dvns-uv-cache"),
    },
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

const candidates = [
  ...new Set([requested, "python3.12", "python3", "python"].filter(Boolean)),
];
const managedPython = uvPython();
if (managedPython) candidates.push(managedPython);

function versionOf(command) {
  const result = spawnSync(
    command,
    ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return null;
  const match = result.stdout.trim().match(/^(\d+)\.(\d+)$/);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

const python = candidates.find((candidate) => {
  const version = versionOf(candidate);
  return version?.major === REQUIRED_MAJOR && version.minor === REQUIRED_MINOR;
});

if (!python) {
  console.error(
    "Python 3.12 non trovato. Installa la versione indicata in .python-version oppure imposta PYTHON sul relativo eseguibile.",
  );
  process.exit(1);
}

const pythonDirectory = dirname(python);
const result = spawnSync(python, process.argv.slice(2), {
  stdio: "inherit",
  env: {
    ...process.env,
    PYTHON: python,
    PATH: `${pythonDirectory}${delimiter}${process.env.PATH ?? ""}`,
  },
});
if (result.error) {
  console.error(`Impossibile avviare ${python}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
