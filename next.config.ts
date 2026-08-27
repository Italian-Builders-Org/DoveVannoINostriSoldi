import type { NextConfig } from "next";

const integratedSourceRuntimeFiles = [
  "data/source-ledger/release-proof.json",
  "data/source-ledger/receipt.json",
  "data/source-ledger/sources.jsonl",
  "data/source-ledger/dataset-proof.json",
  "src/data/generated/integrated/catalog.json",
  "src/data/generated/integrated/rows/*.jsonl.gz",
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  outputFileTracingIncludes: {
    "/dati": integratedSourceRuntimeFiles,
    "/dati/*": integratedSourceRuntimeFiles,
    "/api/dati/*": integratedSourceRuntimeFiles,
    "/fonti/copertura": integratedSourceRuntimeFiles,
    "/fonti/catalogo": integratedSourceRuntimeFiles,
    "/api/fonti/catalogo": integratedSourceRuntimeFiles,
    "/mcp": integratedSourceRuntimeFiles,
    "/api/mcp": integratedSourceRuntimeFiles,
  },
};

export default nextConfig;
