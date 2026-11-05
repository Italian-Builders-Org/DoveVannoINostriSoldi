import "server-only";
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertIntegratedDatasetChunk, canonicalJson, sha256Hex,
  INTEGRATED_ROW_CHUNK_MAX_RAW_BYTES,
  type IntegratedDatasetCatalogEntry,
} from "@/lib/integrated-source-contract";
import type { IntegratedSourceBundle } from "@/lib/integrated-sources";

type ChunkProofs = Record<string, readonly [rawSha256: string, compressedBytes: number]>;
let chunkProofs: Promise<ChunkProofs> | undefined;
type DatabaseRow = { ordinal: string; payload: unknown };
let pool: ReturnType<typeof postgres> | undefined;
let snapshot: Promise<string> | undefined;

export function databaseConnectionUrl(value = process.env.DVNS_DATABASE_URL): string {
  try {
    const url = new URL(value ?? "");
    const project = "zvqhikeylxynsljwgosc";
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.password ||
      url.pathname !== "/postgres" ||
      url.searchParams.getAll("sslmode").length !== 1 ||
      !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "") ||
      !((url.hostname === `db.${project}.supabase.co` && url.username === "postgres") ||
        (url.hostname === "aws-0-eu-west-1.pooler.supabase.com" && url.username === `postgres.${project}`))) throw new Error();
    return value!;
  } catch {
    throw new Error("Configurazione PostgreSQL DVNS mancante o non valida per il progetto selezionato.");
  }
}

function database() {
  // One small pool per server module, not per request. No credentials in errors/debug.
  pool ??= postgres(databaseConnectionUrl(), {
    max: 2, max_pipeline: 1, prepare: false, fetch_types: false,
    idle_timeout: 20, connect_timeout: 10, queue_timeout: 10,
    connection: { application_name: "dvns-local-reader" },
    onnotice: () => {},
  });
  return pool;
}

export async function validateDatabaseChunk(
  dataset: IntegratedDatasetCatalogEntry, ordinal: number,
  records: readonly DatabaseRow[], expectedHash: string,
) {
  if (records.some((row, index) => Number(row.ordinal) !== ordinal * 1000 + index + 1)) {
    throw new Error("Ordinali PostgreSQL DVNS divergenti.");
  }
  const rows = assertIntegratedDatasetChunk(dataset, ordinal, records.map((row) => row.payload));
  const raw = Buffer.from(rows.map((row) => `${canonicalJson(row)}\n`).join(""));
  if (raw.length > INTEGRATED_ROW_CHUNK_MAX_RAW_BYTES) throw new Error("Chunk PostgreSQL DVNS oltre il limite byte.");
  // The committed proof links the published gzip hash to its decompressed bytes.
  // Recompressing here would depend on the runtime's zlib implementation.
  chunkProofs ??= readFile(join(process.cwd(), "src/data/supabase-chunk-digests.json"), "utf8")
    .then((manifest): ChunkProofs => JSON.parse(manifest));
  const proof = (await chunkProofs)[expectedHash];
  if (!proof || sha256Hex(raw) !== proof[0]) throw new Error("Payload PostgreSQL DVNS divergente dalla prova di rilascio.");
  return { ordinal, rows, compressedBytes: proof[1], uncompressedBytes: raw.length };
}

export async function readDatabaseChunk(
  bundle: IntegratedSourceBundle, dataset: IntegratedDatasetCatalogEntry,
  ordinal: number, expectedHash: string, signal?: AbortSignal,
) {
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
  try {
    snapshot ??= readFile(join(process.cwd(), "data/source-ledger/release-proof.json")).then(sha256Hex);
    const sid = await snapshot;
    const sql = database();
    return await sql.begin("read only", async (tx) => {
      await tx`set local statement_timeout = '10s'`;
      await tx`set local lock_timeout = '2s'`;
      const receipt = await tx`
        select d.metadata, c.compressed_sha256, c.rows_count, i.verified_rows,
               i.rows_sha256, d.receipt->>'rowsSha256' as expected_rows_sha256
        from dvns_metadata.datasets d
        join dvns_metadata.chunks c on c.snapshot_id=d.snapshot_id and c.dataset_id=d.id
        join dvns_metadata.imports i on i.snapshot_id=d.snapshot_id and i.dataset_id=d.id
        where d.snapshot_id=${sid} and d.id=${dataset.id} and c.chunk_index=${ordinal}
        limit 1`.signal(boundedSignal);
      const proof = receipt[0];
      if (!proof || canonicalJson(proof.metadata) !== canonicalJson(dataset) ||
        proof.compressed_sha256 !== expectedHash || Number(proof.verified_rows) !== dataset.publicRows ||
        proof.rows_sha256 !== proof.expected_rows_sha256) throw new Error("Ricevuta PostgreSQL DVNS assente o divergente.");
      const records = await tx<DatabaseRow[]>`
        select r.ordinal::text, r.payload from dvns_corpus.rows r
        where snapshot_id=${sid} and dataset_id=${dataset.id}
          and ordinal>${ordinal * 1000} and ordinal<=${(ordinal + 1) * 1000}
        order by r.ordinal limit 1000`.signal(boundedSignal);
      if (records.length !== Number(proof.rows_count)) throw new Error("Chunk PostgreSQL DVNS incompleto.");
      return await validateDatabaseChunk(dataset, ordinal, records, expectedHash);
    });
  } catch {
    if (signal?.aborted) { const error = new Error("Caricamento dei dati integrati annullato."); error.name = "AbortError"; throw error; }
    // Drivers may attach SQL, connection details or credentials to errors.
    throw new Error("Lettura del corpus Supabase non disponibile o non verificata.");
  }
}
