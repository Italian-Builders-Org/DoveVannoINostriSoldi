import { McpServer, type McpRequestContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { APP_VERSION } from "@/lib/app-version";
import { DATASET_IDS, datasetCatalog } from "@/lib/mcp/catalog";
import { queryPublicDataset } from "@/lib/mcp/datasets";
import { relatedMcpServices } from "@/lib/mcp/related-services";

export const MAX_MCP_TOOL_RESPONSE_BYTES = 750_000;
const MCP_WIRE_OVERHEAD_RESERVE_BYTES = 1_024;
const noAuthSecuritySchemes = [{ type: "noauth" }] as const;

const listDatasetsOutputSchema = z.object({
  datasets: z.array(z.unknown()),
  relatedMcpServices: z.array(z.unknown()),
});

const queryDatasetOutputSchema = z.object({
  ok: z.boolean(),
  dataset: z.string(),
  query: z.unknown().optional(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

/**
 * Starter prompt della distribuzione (docs/MCP_DISTRIBUTION.md), esposti anche come
 * capability `prompts` MCP così che client e reviewer leggano la fonte unica invece
 * di copiare i testi dal documento. Le aggiunte future restano allineate a quella lista.
 */
export const dvnsStarterPrompts = [
  {
    name: "confronta_pagamenti_comuni",
    title: "Pagamenti pro capite dei Comuni",
    description: "Confronto dei pagamenti comunali disponibili con fonte, anno e limiti dichiarati.",
    message:
      "Confronta i pagamenti pro capite dei Comuni disponibili e mostrami fonte, anno e limiti.",
  },
  {
    name: "catalogo_territoriale",
    title: "Catalogo territoriale",
    description: "Panoramica dei dataset territoriali interrogabili, senza eseguire query.",
    message: "Quali dataset territoriali posso interrogare? Non eseguire ancora una query.",
  },
  {
    name: "irpef_netta_regionale",
    title: "Imposta netta dichiarata",
    description: "Imposta netta dichiarata 2024 per Regioni, distinta dal gettito totale.",
    message:
      "Mostrami l'imposta netta dichiarata 2024 per le Regioni, distinguendola dal gettito totale.",
  },
  {
    name: "consuntivo_statale_missione",
    title: "Consuntivo statale per missione",
    description: "Riepilogo dei pagamenti statali per missione sull'ultimo consuntivo disponibile.",
    message: "Riassumi i pagamenti statali per missione usando l'ultimo consuntivo disponibile.",
  },
  {
    name: "dati_calabria_limiti",
    title: "Calabria e limiti comparativi",
    description: "Dati disponibili per la Calabria e ciò che non è confrontabile con altre aree.",
    message: "Cerca i dati disponibili per la Calabria e dimmi che cosa non è confrontabile.",
  },
] as const;

const querySchema = z.object({
  dataset: z.enum(DATASET_IDS).describe("Identificativo restituito da list_datasets."),
  year: z.number().int().min(2000).max(2100)
    .describe("Anno di riferimento a quattro cifre, solo se dichiarato tra i filtri del dataset.")
    .optional(),
  month: z.number().int().min(1).max(12)
    .describe("Mese di riferimento da 1 a 12; richiede anche year e un dataset che supporti month.")
    .optional(),
  query: z.string().max(200)
    .describe("Testo libero da cercare nel dataset, con significato e copertura indicati nel catalogo.")
    .optional(),
  region: z.string().max(200)
    .describe("Nome o codice della Regione accettato dal dataset selezionato, massimo 200 caratteri.")
    .optional(),
  province: z.string().max(200)
    .describe("Nome, sigla o codice provinciale accettato dal dataset selezionato, massimo 200 caratteri.")
    .optional(),
  level: z.enum(["region", "province", "municipality"])
    .describe("Livello territoriale della risposta: region, province oppure municipality.")
    .optional(),
  detail: z.enum(["summary", "income-sources", "income-bands", "all"])
    .describe("Dettaglio IRPEF: summary, income-sources, income-bands oppure all.")
    .optional(),
  code: z.string().max(100)
    .describe("Codice identificativo richiesto dal dataset, per esempio codice IPA o ISTAT.")
    .optional(),
  cup: z.string().max(15)
    .describe("Codice Unico di Progetto dell'opera pubblica da cercare, massimo 15 caratteri.")
    .optional(),
  area: z.string().max(100)
    .describe("Area tematica usata dai dataset che espongono classificazioni o segnali di controllo.")
    .optional(),
  chamber: z.enum(["camera", "senato"])
    .describe("Ramo del Parlamento: camera oppure senato.")
    .optional(),
  channel: z.enum(["convenzioni", "mepa"])
    .describe("Canale di acquisto Consip: convenzioni oppure mepa.")
    .optional(),
  country: z.string().max(12)
    .describe("Codice paese o aggregato Eurostat, per esempio IT, DE oppure EU27_2020.")
    .optional(),
  territory: z.string().max(8)
    .describe("Codice territoriale ISTAT, per esempio IT, ITF3 oppure ITCDE.")
    .optional(),
  table: z.string().max(40)
    .describe("Id della tabella pubblicata dal dataset selezionato, per esempio beneficiari_02.")
    .optional(),
  measure: z.string().max(20)
    .describe("Misura richiesta dal dataset selezionato, per esempio beneficiari oppure trattamenti.")
    .optional(),
  cofog: z.string().max(8)
    .describe("Funzione COFOG: per Eurostat TOTAL o GF01…GF10; per ISTAT il totale G oppure una divisione da G010 a G100.")
    .optional(),
  period: z.string().max(20)
    .describe("Periodo dichiarato dal dataset, per esempio 2026-07-31 o 2026-Q2.")
    .optional(),
  sector: z.string().max(20)
    .describe("Codice della sezione ATECO accettato dal dataset selezionato.")
    .optional(),
  band: z.string().max(30)
    .describe("Codice della fascia di valore della produzione, solo per il dataset che la dichiara.")
    .optional(),
  years: z.number().int().min(2).max(20)
    .describe("Numero di Leggi di Bilancio più recenti da restituire, da 2 a 20, solo per il dataset che lo dichiara.")
    .optional(),
  schoolType: z.string().max(30)
    .describe("Tipo di scuola del dataset istruzione: state, paritaria oppure all.")
    .optional(),
  pathway: z.string().max(80)
    .describe("Codice o etichetta del percorso di studio del dataset istruzione.")
    .optional(),
  limit: z.number().int().min(1).max(100)
    .describe("Numero massimo di record da restituire, da 1 a 100, solo per dataset che supportano limit.")
    .optional(),
  offset: z.number().int().min(0).max(100_000)
    .describe("Numero di record da saltare, da 0 a 100000, solo per dataset che supportano offset.")
    .optional(),
  cursor: z.string().max(512)
    .describe("Cursore opaco restituito dalla pagina precedente, solo per dataset che dichiarano cursor.")
    .optional(),
}).strict();

const listDatasetsToolConfig = {
  title: "Elenca i dataset",
  description: "Elenca tutti i dataset disponibili, i filtri ammessi, la freschezza e le cautele interpretative.",
  inputSchema: z.object({}).strict(),
  outputSchema: listDatasetsOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { securitySchemes: noAuthSecuritySchemes },
};

const queryDatasetToolConfig = {
  title: "Interroga un dataset",
  description: "Interroga un dataset del portale. Usa prima list_datasets per conoscere filtri e limiti. Le fonti live possono essere temporaneamente indisponibili.",
  inputSchema: querySchema,
  outputSchema: queryDatasetOutputSchema,
  // Tool di sola lettura su fonti interne: openWorldHint resta false perché non
  // modifichiamo stato visibile su internet né inviamo dati a terze parti
  // (checklist Manufact tool-hints-present: readOnlyHint true richiede openWorldHint false).
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { securitySchemes: noAuthSecuritySchemes },
};

type PublicToolConfig = typeof listDatasetsToolConfig | typeof queryDatasetToolConfig;

function publicToolDescriptor(name: string, config: PublicToolConfig) {
  return {
    name,
    title: config.title,
    description: config.description,
    inputSchema: z.toJSONSchema(config.inputSchema),
    outputSchema: z.toJSONSchema(config.outputSchema),
    annotations: config.annotations,
    securitySchemes: noAuthSecuritySchemes,
    _meta: config._meta,
  };
}

function toolResult(value: unknown) {
  const text = JSON.stringify(value);
  const result = {
    content: [{ type: "text" as const, text }],
    structuredContent: value as Record<string, unknown>,
  };
  const projectedWireResponse = JSON.stringify({ jsonrpc: "2.0", id: 0, result });
  if (new TextEncoder().encode(projectedWireResponse).byteLength > MAX_MCP_TOOL_RESPONSE_BYTES - MCP_WIRE_OVERHEAD_RESERVE_BYTES) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: "La risposta supera il limite di dimensione MCP." }],
    };
  }
  return result;
}

export function createDvnsMcpServer(factoryContext?: McpRequestContext) {
  const server = new McpServer({
    name: "dove-vanno-i-nostri-soldi",
    title: "DoveVannoINostriSoldi",
    version: APP_VERSION,
    websiteUrl: "https://www.dovevannoinostrisoldi.com",
    description:
      "Accesso read-only a dati pubblici italiani verificati, con fonti, periodi, copertura e caveat espliciti.",
    icons: [
      {
        src: "https://www.dovevannoinostrisoldi.com/brand/icon-192.png",
        mimeType: "image/png",
        sizes: ["192x192"],
      },
      {
        src: "https://www.dovevannoinostrisoldi.com/brand/icon-512.png",
        mimeType: "image/png",
        sizes: ["512x512"],
      },
      {
        src: "https://www.dovevannoinostrisoldi.com/brand/icon-1024.png",
        mimeType: "image/png",
        sizes: ["1024x1024"],
      },
    ],
  }, {
    instructions:
      "Usa list_datasets prima di query_dataset. Mantieni unità, periodo, provenienza e caveat nelle risposte. I servizi MCP correlati sono esterni e non vengono proxyati da DVNS.",
  });

  server.registerResource(
    "dataset-catalog",
    "dvns://datasets",
    {
      title: "Catalogo dei dataset pubblici",
      description: "Dataset interrogabili, filtri, fonti e avvertenze semantiche.",
      mimeType: "application/json",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(datasetCatalog) }] }),
  );

  server.registerResource(
    "related-mcp-services",
    "dvns://related-mcp-services",
    {
      title: "Servizi MCP pubblici complementari",
      description:
        "Endpoint MCP esterni utili per domini non duplicati dal portale, con proprietà e limiti espliciti.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(relatedMcpServices),
        },
      ],
    }),
  );

  // I prompt starter sono parte del materiale di submission: la lista MCP replica
  // esattamente docs/MCP_DISTRIBUTION.md, che resta la fonte autoritativa.
  // Nessun argomento: argsSchema resta assente così prompts/get accetta anche i
  // client che, come previsto dallo standard, omettono del tutto `arguments`.
  for (const spec of dvnsStarterPrompts) {
    server.registerPrompt(
      spec.name,
      { title: spec.title, description: spec.description },
      () => ({
        messages: [{ role: "user" as const, content: { type: "text" as const, text: spec.message } }],
      }),
    );
  }

  server.registerTool(
    "list_datasets",
    listDatasetsToolConfig,
    async () => toolResult({ datasets: datasetCatalog, relatedMcpServices }),
  );

  server.registerTool(
    "query_dataset",
    queryDatasetToolConfig,
    async (input, context) => {
      try {
        const requestSignal = factoryContext?.requestInfo?.signal;
        const signal = requestSignal
          ? AbortSignal.any([requestSignal, context.mcpReq.signal])
          : context.mcpReq.signal;
        const data = await queryPublicDataset(input, { signal });
        return toolResult({ ok: true, dataset: input.dataset, query: input, data });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Errore sconosciuto";
        return {
          isError: true,
          content: [{ type: "text", text: message }],
          structuredContent: { ok: false, dataset: input.dataset, error: message },
        };
      }
    },
  );

  // @modelcontextprotocol/server@2 serializes only its core Tool fields. ChatGPT
  // requires the canonical per-tool securitySchemes field as well as its _meta
  // compatibility mirror, so replace only tools/list with descriptors derived
  // from the exact schemas and metadata registered above.
  server.server.setRequestHandler(
    "tools/list",
    { params: z.object({}).passthrough() },
    () => ({
      tools: [
        publicToolDescriptor("list_datasets", listDatasetsToolConfig),
        publicToolDescriptor("query_dataset", queryDatasetToolConfig),
      ],
    }),
  );

  return server;
}
