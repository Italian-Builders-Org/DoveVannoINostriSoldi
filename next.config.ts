import type { NextConfig } from "next";

const integratedSourceRuntimeFiles = [
  "data/source-ledger/release-proof.json",
  "data/source-ledger/receipt.json",
  "data/source-ledger/sources.jsonl",
  "data/source-ledger/dataset-proof.json",
  "src/data/generated/integrated/catalog.json",
  "src/data/generated/integrated/rows/*.jsonl.gz",
];

const entityProcurementRuntimeFiles = [
  "src/data/generated/anac-entity-procurement-page/meta.json",
  "src/data/generated/anac-entity-procurement-page/entities/*.jsonl.gz",
  "scripts/etl/specs/anac-entity-procurement-page.source.json",
  "scripts/etl/specs/anac-entity-procurement.source.json",
  "scripts/etl/specs/anac-awardees.source.json",
];

// Keep this policy observational until browser and production checks show it
// can be enforced safely. Next.js and Analytics currently need inline
// scripts/styles; switching to nonces would also make static pages dynamic.
const contentSecurityPolicyReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://www.googletagmanager.com",
  "font-src 'self'",
  "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://www.googletagmanager.com",
  "manifest-src 'self'",
  "worker-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy-Report-Only",
            value: contentSecurityPolicyReportOnly,
          },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/enti/*": entityProcurementRuntimeFiles,
    "/enti/*/appalti": entityProcurementRuntimeFiles,
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
