import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const sourceRoot = resolve(fileURLToPath(new URL("../../src/", import.meta.url)));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export default undefined", shortCircuit: true };
    }
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const base = resolve(sourceRoot, specifier.slice(2));
    const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.json`, resolve(base, "index.ts")]
      .find((candidate) => existsSync(candidate));
    if (!target) throw new Error(`Test alias non risolto: ${specifier}`);
    return nextResolve(pathToFileURL(target).href, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".json")) return nextLoad(url, context);
    return nextLoad(url, {
      ...context,
      importAttributes: { ...context.importAttributes, type: "json" },
    });
  },
});
