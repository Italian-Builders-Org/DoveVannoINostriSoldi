import "server-only";
import { get } from "node:https";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { database } from "@/lib/integrated-supabase-reader";

const MAX_OBJECT_BYTES = 4 * 1024 * 1024;
const partsSchema = z.array(z.object({
  key: z.string().regex(/^sha256\/[0-9a-f]{64}$/),
  offset: z.number().int().min(0).default(0),
  bytes: z.number().int().positive().max(MAX_OBJECT_BYTES),
})).min(1).max(256);

export function usesSupabaseHeavyArchive() {
  return process.env.DVNS_BUILD_HEAVY_DATA_BACKEND === "supabase"
    || process.env.DVNS_HEAVY_DATA_BACKEND === "supabase";
}

/** The caller validates the complete file or requested block against its local manifest. */
export async function readSupabaseArchiveRange(
  file: { sha256: string; bytes: number }, offset: number, length: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
      offset < 0 || length <= 0 || offset + length > file.bytes || length > 64 * 1024 * 1024) {
    throw new Error("Intervallo archivio DVNS non valido.");
  }
  try {
    const base = "https://zvqhikeylxynsljwgosc.supabase.co";
    const key = process.env.DVNS_SUPABASE_SECRET_KEY;
    if (!key?.startsWith("sb_secret_")) throw new Error();
    const deadline = AbortSignal.timeout(15_000);
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const [blob] = await database().begin("read only", async (tx) => {
      await tx`set local statement_timeout = '5s'`;
      return tx`select parts from dvns_snapshots.blobs
        where source_sha256 = ${file.sha256} and source_bytes = ${file.bytes}
          and bucket = 'dvns-snapshots'`.signal(requestSignal);
    });
    const parts = partsSchema.parse(blob?.parts);
    if (parts.reduce((size, part) => size + part.bytes, 0) !== file.bytes
      || parts.some((part) => part.offset + part.bytes > MAX_OBJECT_BYTES)) throw new Error();
    const result = Buffer.alloc(length);
    let fileStart = 0;
    for (const part of parts) {
      const start = Math.max(offset, fileStart);
      const end = Math.min(offset + length, fileStart + part.bytes);
      if (start < end) {
        const objectStart = part.offset + start - fileStart;
        const objectEnd = objectStart + end - start - 1;
        // Native HTTPS keeps immutable archive reads outside Next's fetch cache
        // policy. ISR can cache the resulting page after the block hash is checked.
        const response = await new Promise<IncomingMessage>((resolve, reject) => {
          get(`${base}/storage/v1/object/authenticated/dvns-snapshots/${part.key}`, {
            headers: { apikey: key, Range: `bytes=${objectStart}-${objectEnd}` },
            signal: requestSignal,
          }, resolve).on("error", reject);
        });
        const range = response.headers["content-range"]?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        if (response.statusCode !== 206 || !range || Number(range[1]) !== objectStart ||
            Number(range[2]) !== objectEnd || Number(range[3]) > MAX_OBJECT_BYTES) {
          response.destroy();
          throw new Error();
        }
        let written = 0;
        for await (const value of response) {
          if (written + value.length > end - start) {
            response.destroy();
            throw new Error();
          }
          result.set(value, start - offset + written);
          written += value.length;
        }
        if (written !== end - start) throw new Error();
      }
      fileStart += part.bytes;
      if (fileStart >= offset + length) break;
    }
    return result;
  } catch {
    if (signal?.aborted) signal.throwIfAborted();
    throw new Error("Lettura dell'archivio Supabase DVNS non disponibile.");
  }
}
