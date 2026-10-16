import "server-only";

import * as z from "zod/v4";
import { PUBLIC_SITE_URL } from "@/lib/site";

type CorpusQuery = {
  code: string;
  query?: string;
  limit: number;
  offset?: number;
  cursor?: string;
};

const MAX_RESPONSE_BYTES = 750_000;

export async function queryIntegratedMcpDataset(query: CorpusQuery, signal?: AbortSignal): Promise<unknown> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(query.code)) {
    throw new Error("Identificativo del dataset non valido.");
  }
  if (process.env.VERCEL !== "1") {
    const { selectIntegratedDataset } = await import("@/lib/integrated-public-view");
    return selectIntegratedDataset({
      datasetId: query.code, q: query.query, limit: query.limit,
      offset: query.offset, cursor: query.cursor, signal,
    });
  }

  // Vercel esclude gli shard da MCP: l'API del corpus resta il confine di integrità.
  // L'host è fisso; nessun cookie, credenziale o URL del chiamante viene inoltrato.
  const url = new URL(`/api/dati/${query.code}`, PUBLIC_SITE_URL);
  for (const [key, value] of Object.entries({ q: query.query, limit: query.limit, offset: query.offset, cursor: query.cursor })) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const deadline = AbortSignal.timeout(15_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  combined.throwIfAborted();
  const response = await fetch(url, { headers: { Accept: "application/json" }, redirect: "error", signal: combined });
  if (!response.body) throw new Error(`API del corpus non disponibile (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      combined.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("Risposta del corpus oltre il budget di dimensione.");
      chunks.push(value);
    }
    combined.throwIfAborted();
    const body = Buffer.concat(chunks, bytes);
    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    if (!response.ok) {
      const error = z.object({ error: z.string().max(500) }).safeParse(payload);
      throw new Error(`API del corpus non disponibile (HTTP ${response.status}): ${error.success ? error.data.error : "risposta non valida"}`);
    }
    const result = z.object({
      dataset: z.object({ id: z.literal(query.code) }).loose(),
      rows: z.array(z.unknown()).max(query.limit),
      pagination: z.object({ returned: z.number().int().nonnegative(), exhausted: z.boolean() }).loose(),
    }).loose().safeParse(payload);
    if (!result.success || result.data.pagination.returned !== result.data.rows.length) {
      throw new Error("Risposta del corpus non conforme al contratto del dataset.");
    }
    return result.data;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
