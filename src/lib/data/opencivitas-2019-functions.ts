import amministrazioneSource from "../../../scripts/etl/specs/opencivitas-2019-amministrazione.source.json";
import istruzioneSource from "../../../scripts/etl/specs/opencivitas-2019-istruzione.source.json";
import poliziaSource from "../../../scripts/etl/specs/opencivitas-2019-polizia.source.json";
import rifiutiSource from "../../../scripts/etl/specs/opencivitas-2019-rifiuti.source.json";
import socialeAsiliSource from "../../../scripts/etl/specs/opencivitas-2019-sociale-asili.source.json";
import viabilitaSource from "../../../scripts/etl/specs/opencivitas-2019-viabilita.source.json";

// Six FC60 per-function releases for 2019. Each keeps its own spec, digest and
// exclusions: this registry shares code, never data, across functions.
// The semantic digests are pinned here independently of the Python adapters.
export const OPENCIVITAS_2019_FUNCTIONS = {
  istruzione: {
    datasetId: "opencivitas_istruzione_2019",
    family: "FC60ISTRUZ",
    function: "ISTRUZIONE",
    label: "Istruzione",
    apiPath: "/api/spese/opencivitas-2019-istruzione",
    semanticSha256: "043a06ed2526a8639a37368d286ed5f03f424b56aad00e4c5f8d40d07c8072f3",
    source: istruzioneSource,
    exclusionNote: "10 Comuni con spesa storica vuota e 2 con spesa storica in notazione scientifica restano esclusi: nessuna imputazione a zero.",
  },
  polizia: {
    datasetId: "opencivitas_polizia_2019",
    family: "FC60POLIZIA",
    function: "POLIZIA",
    label: "Polizia locale",
    apiPath: "/api/spese/opencivitas-2019-polizia",
    semanticSha256: "44b9fbf5d3f3a0aa272c5cb5268180a1a973a87bc712110c1319938ec4619531",
    source: poliziaSource,
    exclusionNote: "3 Comuni con spesa storica vuota nella fonte restano esclusi: nessuna imputazione a zero.",
  },
  viabilita: {
    datasetId: "opencivitas_viabilita_2019",
    family: "FC60TERRVIAB",
    function: "TERR_VIAB",
    label: "Viabilità e territorio",
    apiPath: "/api/spese/opencivitas-2019-viabilita",
    semanticSha256: "75a18b66e17f4cf12726fb0a09edb4d91f36ca83c8534ebbe03beb618b48f841",
    source: viabilitaSource,
    exclusionNote: "1 Comune con spesa storica vuota nella fonte resta escluso: nessuna imputazione a zero.",
  },
  rifiuti: {
    datasetId: "opencivitas_rifiuti_2019",
    family: "FC60RIFIUTI",
    function: "RIFIUTI",
    label: "Rifiuti",
    apiPath: "/api/spese/opencivitas-2019-rifiuti",
    semanticSha256: "fcf7459c57a688b9ccb9a6027e0f3fb45d19a3b7b373b96b66d13a9cd6d3aa9c",
    source: rifiutiSource,
    exclusionNote: "Nessun Comune RSO escluso per valori monetari mancanti.",
  },
  "sociale-asili": {
    datasetId: "opencivitas_sociale_asili_2019",
    family: "FC60SOCNID",
    function: "SOCIALE E NIDO",
    label: "Sociale e asili nido",
    apiPath: "/api/spese/opencivitas-2019-sociale-asili",
    semanticSha256: "7db8d7a8d4cad001593c465b181346f7227637c14b9b66afe9adbf2cb3239c32",
    source: socialeAsiliSource,
    exclusionNote: "Pallagorio (101016) resta escluso: la fonte pubblica la spesa storica in notazione scientifica, non come importo.",
  },
  amministrazione: {
    datasetId: "opencivitas_amministrazione_2019",
    family: "FC60AMMIN",
    function: "AMMINISTRAZIONE",
    label: "Amministrazione",
    apiPath: "/api/spese/opencivitas-2019-amministrazione",
    semanticSha256: "8f10c17c5b1ac0400e9693a10a1a757562eb8dfe1a29639ea6bf2d731e5fbe61",
    source: amministrazioneSource,
    exclusionNote: "73 Comuni con spesa storica vuota nella fonte restano esclusi: nessuna imputazione a zero.",
  },
} as const;

export type OpenCivitas2019FunctionKey = keyof typeof OPENCIVITAS_2019_FUNCTIONS;
