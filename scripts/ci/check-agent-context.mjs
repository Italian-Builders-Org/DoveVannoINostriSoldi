#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..", "..");

// Documenti posseduti dal sistema di contesto: il checker non segue ricorsivamente
// gli altri documenti del repository, ne verifica soltanto l'esistenza quando sono
// referenziati.
const OWNED_DOCUMENTS = [
  "AGENTS.md",
  "CLAUDE.md",
  "docs/AGENT_CONTEXT.md",
];

const MAP_DOCUMENT = "docs/AGENT_CONTEXT.md";
const CLAUDE_DOCUMENT = "CLAUDE.md";
const AGENTS_DOCUMENT = "AGENTS.md";

// Sezioni obbligatorie nella mappa: ingresso e i domini coperti.
const REQUIRED_MAP_SECTIONS = [
  "## Ingresso",
  "## MCP e API",
  "## UI e browser",
  "## Runtime e CI",
  "## Acquisizione e snapshot",
  "## Finanza e territori",
  "## Progetti enti e altri dati",
  "## Politici",
];

// Collegamento AGENTS -> mappa e fallback AGENTS -> ARCHITECTURE, realizzati come
// link Markdown attivi fuori dai blocchi di codice.
const AGENTS_REQUIRED_LINKS = ["docs/AGENT_CONTEXT.md", "docs/ARCHITECTURE.md", "CONTRIBUTING.md"];
// Percorsi obbligatori dalla mappa: architettura e l'ingresso specialistico /politici.
const MAP_REQUIRED_LINKS = ["docs/ARCHITECTURE.md", "docs/POLITICI.md"];
// Il ponte CLAUDE e' l'intero contenuto del file, non una sottostringa casuale.
const CLAUDE_BRIDGE = "@AGENTS.md";

const INLINE_LINK_RE = /\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(\s*([^()\s]+?)(?:\s+["'][^"']*["'])?\s*\)/g;
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
// Solo HTTP/HTTPS sono considerati URL esterni da ignorare; ogni altro schema
// (javascript:, data:, mailto:, ...) e' un riferimento non supportato.
const IGNORED_EXTERNAL_SCHEMES = new Set(["http", "https"]);
const FENCE_RE = /^(`{3,}|~{3,})/;
const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;

class UsageError extends Error {}

function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function safeRealpath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

// path.relative usa il separatore del sistema: su Windows restituisce docs\X.md,
// mentre documenti posseduti e link obbligatori sono dichiarati con la barra. Il
// confronto va fatto in forma POSIX, altrimenti ogni link obbligatorio risulta
// mancante e le ancore verso i documenti in docs/ non vengono mai controllate.
export function relativePosix(root, target, pathApi = path) {
  return pathApi.relative(root, target).split(pathApi.sep).join("/");
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function linesOutsideFences(lines) {
  const outside = new Set();
  // La fence di apertura conserva tipo e lunghezza: una fence si chiude solo con
  // lo stesso carattere e una lunghezza almeno pari (CommonMark).
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const match = FENCE_RE.exec(lines[index].trimStart());
    if (match) {
      const marker = match[1][0];
      const length = match[1].length;
      if (fence === null) {
        fence = { marker, length };
      } else if (fence.marker === marker && length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence === null) outside.add(index);
  }
  return outside;
}

function extractHeadings(content) {
  const lines = content.split("\n");
  const outside = linesOutsideFences(lines);
  const headings = new Set();
  lines.forEach((line, index) => {
    if (!outside.has(index)) return;
    const match = HEADING_RE.exec(line);
    if (match) headings.add(slugify(match[2]));
  });
  return headings;
}

function collectActiveLinks(document) {
  const outside = linesOutsideFences(document.lines);
  const links = [];
  document.lines.forEach((line, index) => {
    if (!outside.has(index)) return;
    INLINE_LINK_RE.lastIndex = 0;
    let match;
    while ((match = INLINE_LINK_RE.exec(line)) !== null) {
      links.push({ text: match[1], target: match[2], line: index + 1 });
    }
  });
  return links;
}

function classifyTarget(target) {
  if (target.startsWith("//")) return { kind: "external" };
  const scheme = SCHEME_RE.exec(target);
  if (scheme) {
    if (IGNORED_EXTERNAL_SCHEMES.has(scheme[1].toLowerCase())) return { kind: "external" };
    return { kind: "unsupported", scheme: scheme[1] };
  }
  const hashIndex = target.indexOf("#");
  const pathPart = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const anchor = hashIndex === -1 ? "" : target.slice(hashIndex + 1);
  return { kind: "local", pathPart, anchor };
}

function readOwnedDocuments(root, violations) {
  const documents = new Map();
  const realRoot = safeRealpath(root) ?? path.resolve(root);
  for (const relative of OWNED_DOCUMENTS) {
    const absolute = path.join(root, relative);
    const real = safeRealpath(absolute) ?? absolute;
    if (!isWithin(realRoot, real)) {
      violations.push({ file: relative, line: 1, message: `documento posseduto fuori dalla root: ${relative}` });
      continue;
    }
    let descriptor;
    let content;
    try {
      descriptor = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      if (!fs.fstatSync(descriptor).isFile()) {
        violations.push({ file: relative, line: 1, message: `documento posseduto mancante: ${relative}` });
        continue;
      }
      // Validate and read the same open file, even if its pathname is replaced.
      content = fs.readFileSync(descriptor, "utf8");
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "ELOOP"].includes(error.code)) throw error;
      violations.push({ file: relative, line: 1, message: `documento posseduto mancante: ${relative}` });
      continue;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
    documents.set(relative, {
      absolute,
      content,
      lines: content.split("\n"),
      headings: extractHeadings(content),
    });
  }
  return { documents, realRoot };
}

function linkResolvesTo(document, root, expectedRelative) {
  for (const link of collectActiveLinks(document)) {
    const classified = classifyTarget(link.target);
    if (classified.kind !== "local" || classified.pathPart === "") continue;
    const resolved = path.resolve(path.dirname(document.absolute), classified.pathPart);
    if (!isWithin(root, resolved)) continue;
    if (relativePosix(root, resolved) === expectedRelative) return true;
  }
  return false;
}

function checkMandatoryReferences(documents, root, violations) {
  const agents = documents.get(AGENTS_DOCUMENT);
  if (agents) {
    for (const required of AGENTS_REQUIRED_LINKS) {
      if (!linkResolvesTo(agents, root, required)) {
        violations.push({
          file: AGENTS_DOCUMENT,
          line: 1,
          message: `manca il link AGENTS -> ${required}`,
        });
      }
    }
  }

  const map = documents.get(MAP_DOCUMENT);
  if (map) {
    const mapOutside = linesOutsideFences(map.lines);
    for (const section of REQUIRED_MAP_SECTIONS) {
      const present = map.lines.some((line, index) => mapOutside.has(index) && line.trim() === section);
      if (!present) {
        violations.push({
          file: MAP_DOCUMENT,
          line: 1,
          message: `manca la sezione obbligatoria '${section}' in ${MAP_DOCUMENT}`,
        });
      }
    }
    for (const required of MAP_REQUIRED_LINKS) {
      if (!linkResolvesTo(map, root, required)) {
        violations.push({
          file: MAP_DOCUMENT,
          line: 1,
          message: `manca il link ${MAP_DOCUMENT} -> ${required}`,
        });
      }
    }
  }

  const claude = documents.get(CLAUDE_DOCUMENT);
  if (claude && claude.content.trim() !== CLAUDE_BRIDGE) {
    violations.push({
      file: CLAUDE_DOCUMENT,
      line: 1,
      message: `il ponte deve essere esattamente '${CLAUDE_BRIDGE}'`,
    });
  }
}

function checkLinkTarget(documentName, document, root, realRoot, documents, violations, target, line) {
  const classified = classifyTarget(target);
  if (classified.kind === "external") return;
  if (classified.kind === "unsupported") {
    violations.push({ file: documentName, line, message: `schema non supportato: ${classified.scheme}:` });
    return;
  }

  const { pathPart, anchor } = classified;
  if (pathPart === "") {
    if (anchor && !document.headings.has(anchor)) {
      violations.push({ file: documentName, line, message: `ancora locale assente: #${anchor}` });
    }
    return;
  }

  let decodedPathPart;
  try {
    decodedPathPart = decodeURIComponent(pathPart);
  } catch {
    violations.push({ file: documentName, line, message: `codifica percentuale non valida: ${target}` });
    return;
  }

  const resolved = path.resolve(path.dirname(document.absolute), decodedPathPart);
  if (!isWithin(root, resolved)) {
    violations.push({ file: documentName, line, message: `riferimento fuori dalla root: ${target}` });
    return;
  }
  if (!fs.existsSync(resolved)) {
    violations.push({ file: documentName, line, message: `target assente: ${target}` });
    return;
  }

  const real = safeRealpath(resolved);
  if (real && !isWithin(realRoot, real)) {
    violations.push({ file: documentName, line, message: `riferimento fuori dalla root (symlink): ${target}` });
    return;
  }

  if (!anchor) return;
  const relativeTarget = relativePosix(root, resolved);
  if (!OWNED_DOCUMENTS.includes(relativeTarget)) return;
  const targetDocument = documents.get(relativeTarget);
  if (targetDocument && !targetDocument.headings.has(anchor)) {
    violations.push({ file: documentName, line, message: `ancora assente in ${relativeTarget}: #${anchor}` });
  }
}

function checkDocumentLinks(documentName, document, root, realRoot, documents, violations) {
  for (const link of collectActiveLinks(document)) {
    checkLinkTarget(documentName, document, root, realRoot, documents, violations, link.target, link.line);
  }
}

export function checkAgentContext(options = {}) {
  const root = path.resolve(options.root ?? DEFAULT_ROOT);
  const violations = [];
  const { documents, realRoot } = readOwnedDocuments(root, violations);
  checkMandatoryReferences(documents, root, violations);
  for (const [name, document] of documents) {
    checkDocumentLinks(name, document, root, realRoot, documents, violations);
  }
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.message.localeCompare(b.message));
  return violations;
}

export function parseArgs(argv) {
  const options = { root: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--root") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) throw new UsageError("--root richiede un valore");
      options.root = value;
      index += 1;
      continue;
    }
    throw new UsageError(`opzione o argomento non supportato: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    "Uso: node scripts/ci/check-agent-context.mjs [--root DIR]",
    "",
    "Verifica i riferimenti di AGENTS.md, del ponte CLAUDE.md e di docs/AGENT_CONTEXT.md.",
    "  --root DIR  radice del repository da controllare (default: radice dello script)",
    "  --help      mostra questo messaggio",
    "",
    "Exit code: 0 valido, 1 violazioni, 2 uso errato.",
  ].join("\n");
}

export function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr.write(`ERRORE: ${error.message}\n${usage()}\n`);
    return 2;
  }
  if (options.help) {
    io.stdout.write(`${usage()}\n`);
    return 0;
  }
  const violations = checkAgentContext({ root: options.root });
  if (violations.length > 0) {
    for (const violation of violations) {
      io.stderr.write(`${violation.file}:${violation.line}: ${violation.message}\n`);
    }
    io.stderr.write(`${violations.length} problema/i nel contesto agenti.\n`);
    return 1;
  }
  io.stdout.write("Contesto agenti valido: AGENTS.md, ponte CLAUDE.md e docs/AGENT_CONTEXT.md.\n");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  process.exitCode = main();
}
