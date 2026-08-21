import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { APP_VERSION } from "@/lib/app-version";
import { DATASET_IDS, datasetCatalog } from "@/lib/mcp/catalog";
import { queryPublicDataset } from "@/lib/mcp/datasets";
import { relatedMcpServices } from "@/lib/mcp/related-services";

const querySchema = z.object({
  dataset: z.enum(DATASET_IDS).describe("Identificativo restituito da list_datasets."),
  year: z.number().int().min(2000).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional(),
  query: z.string().max(200).optional(),
  region: z.string().max(100).optional(),
  province: z.string().max(3).optional(),
  level: z.enum(["region", "province", "municipality"]).optional(),
  code: z.string().max(100).optional(),
  cup: z.string().max(15).optional(),
  area: z.string().max(100).optional(),
  chamber: z.enum(["camera", "senato"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(100_000).optional(),
}).strict();

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export function createDvnsMcpServer() {
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
    async (input) => {
      try {
        const data = await queryPublicDataset(input);
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
