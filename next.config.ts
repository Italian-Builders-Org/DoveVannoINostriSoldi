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

const istatBesPoliticaRuntimeFiles = [
  "src/data/generated/istat-bes-politica-2004-2024.data.json",
];

const istatBesSicurezzaRuntimeFiles = [
  "src/data/generated/istat-bes-sicurezza-2004-2023.data.json",
];

const istatBesPaesaggioRuntimeFiles = [
  "src/data/generated/istat-bes-paesaggio-2004-2023.data.json",
];

const istatBesServiziRuntimeFiles = [
  "src/data/generated/istat-bes-servizi-2004-2024.data.json",
];

const istatBesAmbienteRuntimeFiles = [
  "src/data/generated/istat-bes-ambiente-2004-2023.data.json",
];

const istatBesInnovazioneRuntimeFiles = [
  "src/data/generated/istat-bes-innovazione-2004-2023.data.json",
];

const istatPovertaSogliaAssolutaRuntimeFiles = [
  "src/data/generated/istat-poverta-soglia-assoluta-2005-2024.data.json",
];

const istatPovertaSogliaRelativaRuntimeFiles = [
  "src/data/generated/istat-poverta-soglia-relativa-2014-2024.data.json",
];

const childcareRuntimeFiles = ["src/data/generated/pnrr-childcare.data.json"];
const pensionsRuntimeFiles = [
  "src/data/generated/istat-pensions-2012-2022.data.json",
  "src/data/generated/istat-pensions-2012-2022.meta.json",
];
const openCivitas2015RuntimeFiles = ["src/data/generated/opencivitas-2015.json"];
const openCivitas2016RuntimeFiles = ["src/data/generated/opencivitas-2016.json"];
const openCivitas2017RuntimeFiles = ["src/data/generated/opencivitas-2017.json"];
const naspiRuntimeFiles = ["src/data/generated/inps-naspi-2018-2022.data.json"];
const assegnoUnicoRuntimeFiles = ["src/data/generated/inps-assegno-unico-2022-2024.data.json"];
const integrazioniSalarialiRuntimeFiles = [
  "src/data/generated/inps-integrazioni-salariali-2023.data.json",
];
const cigFondiSolidarietaRuntimeFiles = [
  "src/data/generated/inps-cig-fondi-solidarieta-2023-2024.data.json",
];
const inlVigilanzaRuntimeFiles = [
  "src/data/generated/inl-vigilanza-2025.data.json",
];
const aifaSpesaConsumiRuntimeFiles = [
  "src/data/generated/aifa-spesa-consumi-2022-2025.data.json",
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
  "img-src 'self' data: blob: https://documenti.camera.it https://www.senato.it https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://www.googletagmanager.com",
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
    "/api/lavoro/cig-fondi-solidarieta": cigFondiSolidarietaRuntimeFiles,
    "/api/lavoro/vigilanza-inl": inlVigilanzaRuntimeFiles,
    "/api/spese/sanita/farmaci": aifaSpesaConsumiRuntimeFiles,
    "/fonti": [
      ...naspiRuntimeFiles,
      ...assegnoUnicoRuntimeFiles,
      ...integrazioniSalarialiRuntimeFiles,
      ...cigFondiSolidarietaRuntimeFiles,
      ...inlVigilanzaRuntimeFiles,
      ...aifaSpesaConsumiRuntimeFiles,
      ...pensionsRuntimeFiles,
    ],
    "/spese/pensioni": pensionsRuntimeFiles,
    "/api/spese/pensioni": pensionsRuntimeFiles,
    "/api/spese/opencivitas-2015": openCivitas2015RuntimeFiles,
    "/api/spese/opencivitas-2016": openCivitas2016RuntimeFiles,
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
    "/api/territori/bes-politica": istatBesPoliticaRuntimeFiles,
    "/api/territori/bes-sicurezza": istatBesSicurezzaRuntimeFiles,
    "/api/territori/bes-paesaggio": istatBesPaesaggioRuntimeFiles,
    "/api/territori/bes-servizi": istatBesServiziRuntimeFiles,
    "/api/territori/bes-ambiente": istatBesAmbienteRuntimeFiles,
    "/api/territori/bes-innovazione": istatBesInnovazioneRuntimeFiles,
    "/api/territori/poverta-soglia-assoluta": istatPovertaSogliaAssolutaRuntimeFiles,
    "/api/territori/poverta-soglia-relativa": istatPovertaSogliaRelativaRuntimeFiles,
    "/api/assistant/chat": [
      ...operatorRuntimeFiles,
      ...istatBesLavoroRuntimeFiles,
      ...euVatGapItalyRuntimeFiles,
      ...istatBesRelazioniRuntimeFiles,
      ...istatBesPoliticaRuntimeFiles,
      ...istatBesSicurezzaRuntimeFiles,
      ...istatBesPaesaggioRuntimeFiles,
      ...istatBesServiziRuntimeFiles,
      ...istatBesAmbienteRuntimeFiles,
      ...istatBesInnovazioneRuntimeFiles,
      ...istatPovertaSogliaAssolutaRuntimeFiles,
      ...istatPovertaSogliaRelativaRuntimeFiles,
      ...childcareRuntimeFiles,
      ...naspiRuntimeFiles,
      ...assegnoUnicoRuntimeFiles,
      ...integrazioniSalarialiRuntimeFiles,
      ...cigFondiSolidarietaRuntimeFiles,
      ...inlVigilanzaRuntimeFiles,
      ...aifaSpesaConsumiRuntimeFiles,
      ...pensionsRuntimeFiles,
      ...openCivitas2015RuntimeFiles,
      ...openCivitas2016RuntimeFiles,
      ...openCivitas2017RuntimeFiles,
    ],
    "/mcp": [
      ...integratedSourceRuntimeFiles,
      ...operatorRuntimeFiles,
      ...istatBesLavoroRuntimeFiles,
      ...euVatGapItalyRuntimeFiles,
      ...istatBesRelazioniRuntimeFiles,
      ...istatBesPoliticaRuntimeFiles,
      ...istatBesSicurezzaRuntimeFiles,
      ...istatBesPaesaggioRuntimeFiles,
      ...istatBesServiziRuntimeFiles,
      ...istatBesAmbienteRuntimeFiles,
      ...istatBesInnovazioneRuntimeFiles,
      ...istatPovertaSogliaAssolutaRuntimeFiles,
      ...istatPovertaSogliaRelativaRuntimeFiles,
      ...childcareRuntimeFiles,
      ...naspiRuntimeFiles,
      ...assegnoUnicoRuntimeFiles,
      ...integrazioniSalarialiRuntimeFiles,
      ...cigFondiSolidarietaRuntimeFiles,
      ...inlVigilanzaRuntimeFiles,
      ...aifaSpesaConsumiRuntimeFiles,
      ...pensionsRuntimeFiles,
      ...openCivitas2015RuntimeFiles,
      ...openCivitas2016RuntimeFiles,
      ...openCivitas2017RuntimeFiles,
    ],
    "/api/mcp": [
      ...integratedSourceRuntimeFiles,
      ...operatorRuntimeFiles,
      ...istatBesLavoroRuntimeFiles,
      ...euVatGapItalyRuntimeFiles,
      ...istatBesRelazioniRuntimeFiles,
      ...istatBesPoliticaRuntimeFiles,
      ...istatBesSicurezzaRuntimeFiles,
      ...istatBesPaesaggioRuntimeFiles,
      ...istatBesServiziRuntimeFiles,
      ...istatBesAmbienteRuntimeFiles,
      ...istatBesInnovazioneRuntimeFiles,
      ...istatPovertaSogliaAssolutaRuntimeFiles,
      ...istatPovertaSogliaRelativaRuntimeFiles,
      ...childcareRuntimeFiles,
      ...naspiRuntimeFiles,
      ...assegnoUnicoRuntimeFiles,
      ...integrazioniSalarialiRuntimeFiles,
      ...cigFondiSolidarietaRuntimeFiles,
      ...inlVigilanzaRuntimeFiles,
      ...aifaSpesaConsumiRuntimeFiles,
      ...pensionsRuntimeFiles,
      ...openCivitas2015RuntimeFiles,
      ...openCivitas2016RuntimeFiles,
      ...openCivitas2017RuntimeFiles,
    ],
  },
};

export default nextConfig;
