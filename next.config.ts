import type { NextConfig } from "next";

const integratedSourceRuntimeFilesWithoutRows = [
  "data/source-ledger/release-proof.json",
  "data/source-ledger/receipt.json",
  "data/source-ledger/sources.jsonl",
  "data/source-ledger/dataset-proof.json",
  "src/data/generated/integrated/catalog.json",
  "src/data/generated/pnrr-projects-index/*.json.gz",
];

const integratedSourceRuntimeFiles = [
  ...integratedSourceRuntimeFilesWithoutRows,
  "src/data/generated/integrated/rows/*.jsonl.gz",
];

const medicalDeviceRuntimeRows = [
  "src/data/generated/integrated/rows/salute-spesa-dispositivi-*.jsonl.gz",
  "src/data/generated/integrated/rows/salute-dispositivi-bdrdm.part-*.jsonl.gz",
  "src/data/generated/integrated/rows/salute-classificazione-cnd.part-*.jsonl.gz",
];

// Next 16.3.4 evaluates exclusions against internal `app/...` entry names.
// Anchoring here prevents `/dati` from also matching routes such as `/api/.../dati`.
const routesWithoutMedicalDeviceRows = [
  "/app/api/enti/**",
  "/app/api/fonti/**",
  "/app/api/governi/**",
  "/app/api/opencup/**",
  "/app/api/pnrr/**",
  "/app/appalti/**",
  "/app/confronti/**",
  "/app/controlli/**",
  "/app/disuguaglianza",
  "/app/enti/**",
  "/app/fonti/**",
  "/app/incarichi/**",
  "/app/mcp",
  "/app/partecipazioni",
  "/app/pnrr",
  "/app/pnrr/**",
  "/app/progetti/**",
  "/app/spese/**",
  "/app/trasparenza",
  "/app/trasparenza/**",
];

const operatorRuntimeFiles = [
  "src/data/generated/anac-operator-awards-index/meta.json",
  "src/data/generated/anac-operator-awards-index/summaries.json",
  "src/data/generated/anac-operator-awards-index/search.jsonl.gz",
  "src/data/generated/anac-operator-awards-index/operators/*.jsonl.gz",
  "scripts/etl/specs/anac-operator-awards-index.source.json",
];

const entityProcurementRuntimeFiles = [
  "src/data/generated/anac-procurement-cpv/*.jsonl.gz",
  "src/data/generated/anac-procurement-cpv/meta.json",
  "scripts/etl/specs/anac-procurement-cpv.source.json",
  "src/data/generated/anac-entity-procurement-page/meta.json",
  "src/data/generated/anac-entity-procurement-page/entities/*.jsonl.gz",
  "scripts/etl/specs/anac-entity-procurement-page.source.json",
  "scripts/etl/specs/anac-entity-procurement.source.json",
  "scripts/etl/specs/anac-awardees.source.json",
];

const istatBesLavoroRuntimeFiles = [
  "src/data/generated/istat-bes-lavoro-2008-2024.data.json",
];

const euVatGapItalyRuntimeFiles = [
  "src/data/generated/eu-vat-gap-italy.data.json",
  "src/data/generated/eu-vat-gap-italy.meta.json",
  "scripts/etl/specs/eu-vat-gap-italy.source.json",
];

const istatBesRelazioniRuntimeFiles = [
  "src/data/generated/istat-bes-relazioni-2011-2024.data.json",
];

const childcareRuntimeFiles = ["src/data/generated/pnrr-childcare.data.json"];
const pensionsRuntimeFiles = [
  "src/data/generated/istat-pensions-2012-2022.data.json",
  "src/data/generated/istat-pensions-2012-2022.meta.json",
];
const openCivitas2017RuntimeFiles = ["src/data/generated/opencivitas-2017.json"];
const naspiRuntimeFiles = ["src/data/generated/inps-naspi-2018-2022.data.json"];
const assegnoUnicoRuntimeFiles = ["src/data/generated/inps-assegno-unico-2022-2024.data.json"];
const integrazioniSalarialiRuntimeFiles = [
  "src/data/generated/inps-integrazioni-salariali-2023.data.json",
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
  // Element-level intake ledgers are checked offline; public MCP reads the
  // receipt, release proofs and validated row chunks, never these CI files.
  outputFileTracingExcludes: {
    ...Object.fromEntries(
      routesWithoutMedicalDeviceRows.map((route) => [route, medicalDeviceRuntimeRows]),
    ),
    "/appalti/operatori": ["src/data/generated/anac-operator-awards-index/operators/*"],
    "/appalti/operatori/\\[ref\\]": [
      "src/data/generated/anac-operator-awards-index/operators/*",
      "src/data/generated/anac-operator-awards-index/search.jsonl.gz",
      "src/data/generated/anac-operator-awards-index/summaries.json",
      "src/data/generated/anac-operator-browse/*",
    ],
    "/api/mcp": ["data/source-ledger/elements/**/*"],
    "/opere": ["docs/**/*", "tests/**/*", "research/**/*"],
  },
  outputFileTracingIncludes: {
    "/opere": [
      "src/data/generated/mop-comparable-browse.meta.json",
      "src/data/generated/mop-comparable-browse.data.jsonl.gz",
      ...childcareRuntimeFiles,
    ],
    "/coesione": childcareRuntimeFiles,
    "/coesione/asili": childcareRuntimeFiles,
    "/progetti/*": childcareRuntimeFiles,
    "/api/pnrr/asili": childcareRuntimeFiles,
    "/api/enti/*": childcareRuntimeFiles,
    "/api/lavoro/naspi": naspiRuntimeFiles,
    "/api/famiglia/assegno-unico": assegnoUnicoRuntimeFiles,
    "/api/lavoro/integrazioni-salariali": integrazioniSalarialiRuntimeFiles,
    "/fonti": [
      ...naspiRuntimeFiles,
      ...assegnoUnicoRuntimeFiles,
      ...integrazioniSalarialiRuntimeFiles,
      ...pensionsRuntimeFiles,
    ],
    "/spese/pensioni": pensionsRuntimeFiles,
    "/api/spese/pensioni": pensionsRuntimeFiles,
    "/api/spese/opencivitas-2017": openCivitas2017RuntimeFiles,

    "/appalti/operatori": [
      "src/data/generated/anac-operator-awards-index/meta.json",
      "src/data/generated/anac-operator-awards-index/summaries.json",
      "src/data/generated/anac-operator-awards-index/search.jsonl.gz",
      "src/data/generated/anac-operator-browse/*",
      "scripts/etl/specs/anac-operator-awards-index.source.json",
    ],
    "/appalti/operatori/\\[ref\\]": [
      "src/data/generated/anac-operator-history/*",
      "src/data/generated/anac-operator-awards-index/meta.json",
      "scripts/etl/specs/anac-operator-awards-index.source.json",
      "scripts/etl/specs/anac-cig-2007-2025.source.json",
    ],
    "/enti/*": [...entityProcurementRuntimeFiles, ...childcareRuntimeFiles],
    "/enti/*/appalti": entityProcurementRuntimeFiles,
    "/enti/*/appalti/confronti": [
      "src/data/generated/anac-procurement-peers/*",
      "scripts/etl/specs/anac-procurement-peers.source.json",
      "src/data/generated/anac-entity-procurement-page/meta.json",
      "src/data/generated/anac-procurement-cpv/meta.json",
      "scripts/etl/specs/anac-procurement-cpv.source.json",
      "src/data/generated/istat-municipality-geography.json",
    ],
    "/dati/\\[dataset\\]": integratedSourceRuntimeFiles,
    "/pnrr": integratedSourceRuntimeFilesWithoutRows,
    "/api/pnrr/progetti": integratedSourceRuntimeFilesWithoutRows,
    "/fonti/copertura": integratedSourceRuntimeFilesWithoutRows,
    "/fonti/catalogo": integratedSourceRuntimeFilesWithoutRows,
    "/api/fonti/catalogo": integratedSourceRuntimeFilesWithoutRows,
    "/api/tributi/vat-gap": euVatGapItalyRuntimeFiles,
    "/api/territori/bes-lavoro": istatBesLavoroRuntimeFiles,
    "/api/territori/bes-relazioni": istatBesRelazioniRuntimeFiles,
    "/api/assistant/chat": [
      ...operatorRuntimeFiles,
      ...istatBesLavoroRuntimeFiles,
      ...euVatGapItalyRuntimeFiles,
      ...istatBesRelazioniRuntimeFiles,
      ...childcareRuntimeFiles,
      ...naspiRuntimeFiles,
      ...assegnoUnicoRuntimeFiles,
      ...integrazioniSalarialiRuntimeFiles,
      ...pensionsRuntimeFiles,
      ...openCivitas2017RuntimeFiles,
    ],
    "/mcp": [
      ...integratedSourceRuntimeFiles,
      ...operatorRuntimeFiles,
      ...istatBesLavoroRuntimeFiles,
      ...euVatGapItalyRuntimeFiles,
      ...istatBesRelazioniRuntimeFiles,
      ...childcareRuntimeFiles,
      ...naspiRuntimeFiles,
      ...assegnoUnicoRuntimeFiles,
      ...integrazioniSalarialiRuntimeFiles,
      ...pensionsRuntimeFiles,
      ...openCivitas2017RuntimeFiles,
    ],
    "/api/mcp": [
      ...integratedSourceRuntimeFiles,
      ...operatorRuntimeFiles,
      ...istatBesLavoroRuntimeFiles,
      ...euVatGapItalyRuntimeFiles,
      ...istatBesRelazioniRuntimeFiles,
      ...childcareRuntimeFiles,
      ...naspiRuntimeFiles,
      ...assegnoUnicoRuntimeFiles,
      ...integrazioniSalarialiRuntimeFiles,
      ...pensionsRuntimeFiles,
      ...openCivitas2017RuntimeFiles,
    ],
  },
};

export default nextConfig;
