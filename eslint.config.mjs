import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**", "out/**", "build/**", ".scratch/**", "artifacts/**", ".venv/**", "next-env.d.ts",
    // Offline research prototypes (own Node/Python tests; not App Router product code).
    "research/**",
  ]),
]);
