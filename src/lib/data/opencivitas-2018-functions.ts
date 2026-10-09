import amministrazioneSource from "../../../scripts/etl/specs/opencivitas-2018-amministrazione.source.json";
import istruzioneSource from "../../../scripts/etl/specs/opencivitas-2018-istruzione.source.json";
import poliziaSource from "../../../scripts/etl/specs/opencivitas-2018-polizia.source.json";
import rifiutiSource from "../../../scripts/etl/specs/opencivitas-2018-rifiuti.source.json";
import socialeAsiliSource from "../../../scripts/etl/specs/opencivitas-2018-sociale-asili.source.json";
import viabilitaSource from "../../../scripts/etl/specs/opencivitas-2018-viabilita.source.json";
import type { OpenCivitasFunctionDescriptor } from "@/lib/data/opencivitas-functions";

// Six FC50 per-function releases for 2018. Each keeps its own spec, digest and
// exclusions: this registry shares code, never data, across functions.
// The semantic digests are pinned here independently of the Python adapters.
export const OPENCIVITAS_2018_FUNCTIONS = {
  istruzione: {
    datasetId: "opencivitas_istruzione_2018",
    family: "FC50ISTRUZ",
    function: "ISTRUZIONE",
    referenceYear: 2018,
    totalFamily: "FC50TOT",
    totalDatasetId: "opencivitas_fabbisogni_2018",
    totalApiPath: "/api/spese/opencivitas-2018",
    label: "Istruzione",
    apiPath: "/api/spese/opencivitas-2018-istruzione",
    semanticSha256: "7d9e1c23654dfe808851aa6b6dc3c9d3273d9a5bad7ba544b8764f8b60148e43",
    source: istruzioneSource,
    exclusionNote: "14 Comuni con spesa storica vuota, 4 con spesa storica in notazione scientifica e 4 con servizio assente (fabbisogno zero) restano esclusi: nessuna imputazione a zero.",
  },
  polizia: {
    datasetId: "opencivitas_polizia_2018",
    family: "FC50POLIZIA",
    function: "POLIZIA",
    referenceYear: 2018,
    totalFamily: "FC50TOT",
    totalDatasetId: "opencivitas_fabbisogni_2018",
    totalApiPath: "/api/spese/opencivitas-2018",
    label: "Polizia locale",
    apiPath: "/api/spese/opencivitas-2018-polizia",
    semanticSha256: "ef262ebb908fc6256753d4e8f4b7dfcbfa91572a48cef4fa2cff7cbfb8cf2669",
    source: poliziaSource,
    exclusionNote: "12 Comuni con spesa storica vuota nella fonte restano esclusi: nessuna imputazione a zero.",
  },
  viabilita: {
    datasetId: "opencivitas_viabilita_2018",
    family: "FC50TERRVIAB",
    function: "TERR_VIAB",
    referenceYear: 2018,
    totalFamily: "FC50TOT",
    totalDatasetId: "opencivitas_fabbisogni_2018",
    totalApiPath: "/api/spese/opencivitas-2018",
    label: "Viabilità e territorio",
    apiPath: "/api/spese/opencivitas-2018-viabilita",
    semanticSha256: "bc5af979aacfde7eea49704f011c9c973a21568180e96a87a4a15a6503a312ed",
    source: viabilitaSource,
    exclusionNote: "12 Comuni con spesa storica vuota nella fonte restano esclusi: nessuna imputazione a zero.",
  },
  rifiuti: {
    datasetId: "opencivitas_rifiuti_2018",
    family: "FC50RIFIUTI",
    function: "RIFIUTI",
    referenceYear: 2018,
    totalFamily: "FC50TOT",
    totalDatasetId: "opencivitas_fabbisogni_2018",
    totalApiPath: "/api/spese/opencivitas-2018",
    label: "Rifiuti",
    apiPath: "/api/spese/opencivitas-2018-rifiuti",
    semanticSha256: "b9b45fa236165db4f910b08d8fbee299e461b1d8972345f7f7a75645ee14bfe8",
    source: rifiutiSource,
    exclusionNote: "Nessun Comune RSO escluso per valori monetari mancanti.",
  },
  "sociale-asili": {
    datasetId: "opencivitas_sociale_asili_2018",
    family: "FC50SOCNID",
    function: "SOCIALE E NIDO",
    referenceYear: 2018,
    totalFamily: "FC50TOT",
    totalDatasetId: "opencivitas_fabbisogni_2018",
    totalApiPath: "/api/spese/opencivitas-2018",
    label: "Sociale e asili nido",
    apiPath: "/api/spese/opencivitas-2018-sociale-asili",
    semanticSha256: "2cb0b2d0568980ac854695f68b72176de32c18528a71f893caa480fe2a727d98",
    source: socialeAsiliSource,
    exclusionNote: "12 Comuni con spesa storica vuota e 4 con spesa storica in notazione scientifica restano esclusi: nessuna imputazione a zero.",
  },
  amministrazione: {
    datasetId: "opencivitas_amministrazione_2018",
    family: "FC50AMMIN",
    function: "AMMINISTRAZIONE",
    referenceYear: 2018,
    totalFamily: "FC50TOT",
    totalDatasetId: "opencivitas_fabbisogni_2018",
    totalApiPath: "/api/spese/opencivitas-2018",
    label: "Amministrazione",
    apiPath: "/api/spese/opencivitas-2018-amministrazione",
    semanticSha256: "fafd7089b70411bdee79a0e786a4c2fc772f014458292378c6a1ed3a6c6ac56d",
    source: amministrazioneSource,
    exclusionNote: "20 Comuni con spesa storica vuota nella fonte restano esclusi: nessuna imputazione a zero.",
  },
} as const satisfies Record<string, OpenCivitasFunctionDescriptor>;

export type OpenCivitas2018FunctionKey = keyof typeof OPENCIVITAS_2018_FUNCTIONS;
