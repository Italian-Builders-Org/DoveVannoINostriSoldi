import { McpServer, type McpRequestContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { APP_VERSION } from "@/lib/app-version";
import { DATASET_IDS, datasetCatalog } from "@/lib/mcp/catalog";
import { queryPublicDataset } from "@/lib/mcp/datasets";
import { relatedMcpServices } from "@/lib/mcp/related-services";

export const MAX_MCP_TOOL_RESPONSE_BYTES = 750_000;
const MCP_WIRE_OVERHEAD_RESERVE_BYTES = 1_024;

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
      structuredContent: {
        ok: false,
        error: "response_too_large",
        maxBytes: MAX_MCP_TOOL_RESPONSE_BYTES,
      },
    };
  }
  return result;
}

export function createDvnsMcpServer(factoryContext?: McpRequestContext) {
  const server = new McpServer({
    name: "dove-vanno-i-nostri-soldi",
    version: APP_VERSION,
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

  server.registerTool(
    "list_datasets",
    {
      title: "Elenca i dataset",
      description: "Elenca tutti i dataset disponibili, i filtri ammessi, la freschezza e le cautele interpretative.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => toolResult({ datasets: datasetCatalog, relatedMcpServices }),
  );

  server.registerTool(
    "query_dataset",
    {
      title: "Interroga un dataset",
      description: "Interroga un dataset del portale. Usa prima list_datasets per conoscere filtri e limiti. Le fonti live possono essere temporaneamente indisponibili.",
      inputSchema: querySchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
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

  return server;
}
