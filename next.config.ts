import type { NextConfig } from "next";

const integratedSourceRuntimeFilesWithoutRows = [
  "data/source-ledger/release-proof.json",
  "data/source-ledger/receipt.json",
  "data/source-ledger/sources.jsonl",
  "data/source-ledger/dataset-proof.json",
  "src/data/generated/integrated/catalog.json",
  "src/data/generated/pnrr-projects-index/*.json.gz",
];

// Full rows glob for excludes (assistant/MCP must drop every shard).
const allIntegratedRowRuntimeFiles = [
  "src/data/generated/integrated/rows/*.jsonl.gz",
];

// Broad rows/* pulls ~430 MiB of medical shards and exceeds the 250 MB serverless
// cap once Fluid is off. Keep compact non-medical globs (not thousands of paths:
// Turbopack Glob::new fails on huge include lists).
const integratedRowRuntimeFiles = [
  "src/data/generated/integrated/rows/affidamenti-*.jsonl.gz",
  "src/data/generated/integrated/rows/affitti-*.jsonl.gz",
  "src/data/generated/integrated/rows/auto-*.jsonl.gz",
  "src/data/generated/integrated/rows/buchi-*.jsonl.gz",
  "src/data/generated/integrated/rows/campagne-*.jsonl.gz",
  "src/data/generated/integrated/rows/capitoli-*.jsonl.gz",
  "src/data/generated/integrated/rows/catalogo-*.jsonl.gz",
  "src/data/generated/integrated/rows/cdp-*.jsonl.gz",
  "src/data/generated/integrated/rows/cig-*.jsonl.gz",
  "src/data/generated/integrated/rows/collaboratori-*.jsonl.gz",
  "src/data/generated/integrated/rows/consip-*.jsonl.gz",
  "src/data/generated/integrated/rows/consulenze-*.jsonl.gz",
  "src/data/generated/integrated/rows/corte-*.jsonl.gz",
  "src/data/generated/integrated/rows/eurostat-*.jsonl.gz",
  "src/data/generated/integrated/rows/eventi-*.jsonl.gz",
  "src/data/generated/integrated/rows/fuori-*.jsonl.gz",
  "src/data/generated/integrated/rows/incarichi-*.jsonl.gz",
  "src/data/generated/integrated/rows/indennita-*.jsonl.gz",
  "src/data/generated/integrated/rows/indice-*.jsonl.gz",
  "src/data/generated/integrated/rows/istat-*.jsonl.gz",
  "src/data/generated/integrated/rows/mef-*.jsonl.gz",
  "src/data/generated/integrated/rows/mim-*.jsonl.gz",
  "src/data/generated/integrated/rows/missioni*.jsonl.gz",
  "src/data/generated/integrated/rows/nominativi-*.jsonl.gz",
  "src/data/generated/integrated/rows/openbdap-*.jsonl.gz",
  "src/data/generated/integrated/rows/opencup-*.jsonl.gz",
  "src/data/generated/integrated/rows/partecipate-*.jsonl.gz",
  "src/data/generated/integrated/rows/parti-*.jsonl.gz",
  "src/data/generated/integrated/rows/personale*.jsonl.gz",
  "src/data/generated/integrated/rows/pnrr-*.jsonl.gz",
  "src/data/generated/integrated/rows/problemi-*.jsonl.gz",
  "src/data/generated/integrated/rows/procurement-*.jsonl.gz",
  "src/data/generated/integrated/rows/rgs-*.jsonl.gz",
  "src/data/generated/integrated/rows/rimborsi-*.jsonl.gz",
  "src/data/generated/integrated/rows/rinnovi-*.jsonl.gz",
  "src/data/generated/integrated/rows/salute-posti-*.jsonl.gz",
  "src/data/generated/integrated/rows/segnalazioni*.jsonl.gz",
  "src/data/generated/integrated/rows/siope-*.jsonl.gz",
  "src/data/generated/integrated/rows/staff-*.jsonl.gz",
  "src/data/generated/integrated/rows/ted-*.jsonl.gz",
  "src/data/generated/integrated/rows/trasparenza-*.jsonl.gz",
  "src/data/generated/integrated/rows/url-*.jsonl.gz",
  "src/data/generated/integrated/rows/vincitori*.jsonl.gz",
];

const integratedSourceRuntimeFiles = [
  ...integratedSourceRuntimeFilesWithoutRows,
  ...integratedRowRuntimeFiles,
];

const medicalDeviceRuntimeRows = [
  "src/data/generated/integrated/rows/salute-spesa-dispositivi-*.jsonl.gz",
  "src/data/generated/integrated/rows/salute-dispositivi-bdrdm.part-*.jsonl.gz",
  "src/data/generated/integrated/rows/salute-classificazione-cnd.part-*.jsonl.gz",
];

const medicalDeviceIndexRuntimeFiles = [
  "src/data/generated/medical-device-spending-index/**/*",
];

// Chat/MCP import the integrated loader and would otherwise NFT-trace every
// row shard (~650 MiB) plus other fat indexes, blowing the 250 MB Vercel limit.
// Non-medical row bytes stay on /dati and /api/dati. Medical row shards (~430 MiB)
// stay out of every serverless function: the dispositivi UI/API uses the index.
const routesWithoutIntegratedRows = [
  "/app/api/assistant/**",
  "/app/mcp",
];

// Without Fluid Compute, classic serverless caps at 250 MB uncompressed. Keeping
// medical rows in the shared [dataset] function pushed /api/dati to ~673 MB.
const corpusRoutesWithoutMedicalDeviceRows = [
  "/app/dati/**",
  "/app/api/dati/**",
];

// Next 16.3.4 evaluates exclusions against internal `app/...` entry names.
// Anchoring here prevents `/dati` from also matching routes such as `/api/.../dati`.
const routesWithoutMedicalDeviceRows = [
  "/app/api/comuni/**",
  "/app/api/enti/**",
  "/app/api/fonti/**",
  "/app/api/governi/**",
  "/app/api/opencup/**",
  "/app/api/patrimonio/**",
  "/app/api/pnrr/**",
  "/app/appalti/**",
  "/app/comuni",
  "/app/comuni/**",
  "/app/snapshot-pages/**",
  "/app/confronti/**",
  "/app/controlli/**",
  "/app/disuguaglianza",
  "/app/enti/**",
  "/app/fonti/**",
  "/app/incarichi/**",
  "/app/mcp",
  "/app/partecipazioni",
  "/app/patrimonio",
  "/app/pnrr",
  "/app/pnrr/**",
  "/app/progetti/**",
  "/app/spese/**",
  "/app/trasparenza",
  "/app/trasparenza/**",
];

const operatorCatalogRuntimeFiles = [
  "src/data/generated/anac-operator-awards-index/meta.json",
  "src/data/generated/anac-operator-awards-index/summaries.json",
  "src/data/generated/anac-operator-awards-index/search.jsonl.gz",
  "scripts/etl/specs/anac-operator-awards-index.source.json",
];

const operatorShardRuntimeFiles = [
  "src/data/generated/anac-operator-awards-index/operators/*",
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

const istatPovertaRegioniRuntimeFiles = [
  "src/data/generated/istat-poverta-regioni-2014-2024.data.json",
];

const eurostatAropeRuntimeFiles = [
  "src/data/generated/eurostat-arope-2015-2025.data.json",
];

const childcareRuntimeFiles = ["src/data/generated/pnrr-childcare.data.json"];
const pensionsRuntimeFiles = [
  "src/data/generated/istat-pensions-2012-2022.data.json",
  "src/data/generated/istat-pensions-2012-2022.meta.json",
];
const openCivitas2015RuntimeFiles = ["src/data/generated/opencivitas-2015.json"];
const openCivitas2016RuntimeFiles = ["src/data/generated/opencivitas-2016.json"];
const openCivitas2017RuntimeFiles = ["src/data/generated/opencivitas-2017.json"];
const openCivitas2019AmministrazioneRuntimeFiles = [
  "src/data/generated/opencivitas-2019-amministrazione.json",
];
const openCivitas2019IstruzioneRuntimeFiles = [
  "src/data/generated/opencivitas-2019-istruzione.json",
];
const openCivitas2019PoliziaRuntimeFiles = ["src/data/generated/opencivitas-2019-polizia.json"];
const openCivitas2019RifiutiRuntimeFiles = ["src/data/generated/opencivitas-2019-rifiuti.json"];
const openCivitas2019SocialeAsiliRuntimeFiles = [
  "src/data/generated/opencivitas-2019-sociale-asili.json",
];
const openCivitas2019ViabilitaRuntimeFiles = [
  "src/data/generated/opencivitas-2019-viabilita.json",
];
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
    "/*": ["data/source-ledger/elements/**/*"],
    // contains:true also matches descendants. !(/**) keeps each hub exact;
    // the procurement, structure and cached procurement routes do not read childcare.
    "/app/enti!(/**)": childcareRuntimeFiles,
    "/app/api/enti!(/**)": childcareRuntimeFiles,
    "/app/enti/*/appalti/**": childcareRuntimeFiles,
    "/app/api/enti/*/struttura": childcareRuntimeFiles,
    "/app/snapshot-pages/enti/**": childcareRuntimeFiles,
    ...Object.fromEntries(
      ["/app/fonti/catalogo/**", "/app/fonti/copertura/**", "/app/api/fonti/catalogo/**"].map(
        (route) => [route, ["src/data/generated/integrated/rows/*"]],
      ),
    ),
    ...Object.fromEntries(
      routesWithoutIntegratedRows.map((route) => [
        route,
        [
          ...allIntegratedRowRuntimeFiles,
          ...medicalDeviceIndexRuntimeFiles,
          ...operatorShardRuntimeFiles,
        ],
      ]),
    ),
    "/app/api/mcp": [
      ...allIntegratedRowRuntimeFiles,
      ...medicalDeviceIndexRuntimeFiles,
      ...operatorShardRuntimeFiles,
    ],
    "/app/snapshot-pages/operatori/**": [
      "src/data/generated/anac-operator-awards-index/operators/*",
      "src/data/generated/anac-operator-awards-index/search.jsonl.gz",
      "src/data/generated/anac-operator-awards-index/summaries.json",
      "src/data/generated/anac-operator-browse/*",
    ],
    ...Object.fromEntries(
      routesWithoutMedicalDeviceRows.map((route) => [route, medicalDeviceRuntimeRows]),
    ),
    ...Object.fromEntries(
      corpusRoutesWithoutMedicalDeviceRows.map((route) => [route, medicalDeviceRuntimeRows]),
    ),
    "/appalti/operatori": ["src/data/generated/anac-operator-awards-index/operators/*"],
    "/app/appalti/operatori/*/**": [
      "src/data/generated/anac-operator-awards-index/operators/*",
      "src/data/generated/anac-operator-awards-index/search.jsonl.gz",
      "src/data/generated/anac-operator-awards-index/summaries.json",
      "src/data/generated/anac-operator-browse/*",
    ],
    "/opere": ["docs/**/*", "tests/**/*", "research/**/*"],
  },
  outputFileTracingIncludes: {
    "/snapshot-pages/enti/*/*": entityProcurementRuntimeFiles,
    "/snapshot-pages/operatori/*": [
      "src/data/generated/anac-operator-history/*",
      "src/data/generated/anac-operator-awards-index/meta.json",
      "scripts/etl/specs/anac-operator-awards-index.source.json",
      "scripts/etl/specs/anac-cig-2007-2025.source.json",
    ],
    "/opere": [
      "src/data/generated/mop-comparable-browse.meta.json",
      "src/data/generated/mop-comparable-browse.data.jsonl.gz",
      ...childcareRuntimeFiles,
    ],
    "/coesione": childcareRuntimeFiles,
    "/coesione/asili": childcareRuntimeFiles,
    "/progetti/*": childcareRuntimeFiles,
    "/api/pnrr/asili": childcareRuntimeFiles,
    "/app/api/enti/\\[codice\\]!(/**)": childcareRuntimeFiles,
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
    "/api/spese/opencivitas-2019-amministrazione": openCivitas2019AmministrazioneRuntimeFiles,
    "/api/spese/opencivitas-2019-istruzione": openCivitas2019IstruzioneRuntimeFiles,
    "/api/spese/opencivitas-2019-polizia": openCivitas2019PoliziaRuntimeFiles,
    "/api/spese/opencivitas-2019-rifiuti": openCivitas2019RifiutiRuntimeFiles,
    "/api/spese/opencivitas-2019-sociale-asili": openCivitas2019SocialeAsiliRuntimeFiles,
    "/api/spese/opencivitas-2019-viabilita": openCivitas2019ViabilitaRuntimeFiles,

    // The hub's literal reads are traced automatically. A hub-wide include also
    // adds its search/ranking files to detail pages; runtime guards check both.
    "/appalti/operatori/\\[ref\\]": [
      "src/data/generated/anac-operator-history/*",
      "src/data/generated/anac-operator-awards-index/meta.json",
      "scripts/etl/specs/anac-operator-awards-index.source.json",
      "scripts/etl/specs/anac-cig-2007-2025.source.json",
    ],
    "/enti/*": entityProcurementRuntimeFiles,
    "/app/enti/\\[codice\\]!(/**)": childcareRuntimeFiles,
    // /comuni opens ANAC shards by IPA hash; without an include Vercel omits them
    // and the dossier surfaces "shard assente" for large cities such as Roma.
    "/comuni": [
      ...entityProcurementRuntimeFiles,
      "src/data/generated/mim-school-services-municipal.json",
      ...childcareRuntimeFiles,
    ],
    "/app/comuni": [
      ...entityProcurementRuntimeFiles,
      "src/data/generated/mim-school-services-municipal.json",
      ...childcareRuntimeFiles,
    ],
    "/snapshot-pages/comuni/*": [
      ...entityProcurementRuntimeFiles,
      "src/data/generated/mim-school-services-municipal.json",
      ...childcareRuntimeFiles,
    ],
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
    "/api/dati/\\[dataset\\]": integratedSourceRuntimeFiles,
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
    "/api/territori/poverta-regioni": istatPovertaRegioniRuntimeFiles,
    "/api/spese/arope": eurostatAropeRuntimeFiles,
    "/poverta": [
      ...istatPovertaSogliaAssolutaRuntimeFiles,
      ...istatPovertaSogliaRelativaRuntimeFiles,
      ...eurostatAropeRuntimeFiles,
    ],
    "/api/assistant/chat": [
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
      ...istatPovertaRegioniRuntimeFiles,
      ...eurostatAropeRuntimeFiles,
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
      ...openCivitas2019AmministrazioneRuntimeFiles,
      ...openCivitas2019IstruzioneRuntimeFiles,
      ...openCivitas2019PoliziaRuntimeFiles,
      ...openCivitas2019RifiutiRuntimeFiles,
      ...openCivitas2019SocialeAsiliRuntimeFiles,
      ...openCivitas2019ViabilitaRuntimeFiles,
    ],
    "/api/mcp": [
      ...integratedSourceRuntimeFilesWithoutRows,
      ...operatorCatalogRuntimeFiles,
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
      ...istatPovertaRegioniRuntimeFiles,
      ...eurostatAropeRuntimeFiles,
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
      ...openCivitas2019AmministrazioneRuntimeFiles,
      ...openCivitas2019IstruzioneRuntimeFiles,
      ...openCivitas2019PoliziaRuntimeFiles,
      ...openCivitas2019RifiutiRuntimeFiles,
      ...openCivitas2019SocialeAsiliRuntimeFiles,
      ...openCivitas2019ViabilitaRuntimeFiles,
    ],
  },
};

export default nextConfig;
