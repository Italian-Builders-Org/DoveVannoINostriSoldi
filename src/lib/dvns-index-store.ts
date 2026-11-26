import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { database, databaseConnectionUrl } from "@/lib/integrated-supabase-reader";
import { assertIndexSnapshot, distribution, dotLayout, regionalRanks, type IndexEntry, type IndexSnapshot, type RegionalRank } from "@/lib/dvns-index";

/**
 * Same pattern as the amendments and Bilancio in Breve snapshots: only the
 * receipt is versioned, the payload (about 1,5 MB) lives in dvns_snapshots. A
 * payload is accepted only when bytes and SHA-256 match the receipt, from the
 * database first and from the local ETL output otherwise.
 */
type Receipt = { documentPath: string; codeSha: string; sourceSha256: string; sourceBytes: number };

const RECEIPT_PATH = "src/data/generated/dvns-index.receipt.json";
const PAYLOAD_PATH = "src/data/generated/dvns-index.json";

export class IndexSnapshotUnavailableError extends Error {
  constructor() {
    super("DVNS Index non disponibile in questo ambiente.");
    this.name = "IndexSnapshotUnavailableError";
  }
}

/** A payload that exists but does not match the receipt or the contract: never shown. */
class IndexSnapshotInvalidError extends Error {}

function assertReceipt(value: unknown): Receipt {
  const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  if (
    row.schemaVersion !== 1 ||
    row.documentPath !== PAYLOAD_PATH ||
    typeof row.codeSha !== "string" ||
    !/^[0-9a-f]{40}$/u.test(row.codeSha) ||
    typeof row.sourceSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(row.sourceSha256) ||
    !Number.isSafeInteger(row.sourceBytes) ||
    (row.sourceBytes as number) <= 0
  ) {
    throw new IndexSnapshotInvalidError("Receipt DVNS Index non valido.");
  }
  return { documentPath: PAYLOAD_PATH, codeSha: row.codeSha, sourceSha256: row.sourceSha256, sourceBytes: row.sourceBytes as number };
}

function parse(payload: unknown): IndexSnapshot {
  try {
    return assertIndexSnapshot(payload);
  } catch (error) {
    throw new IndexSnapshotInvalidError(error instanceof Error ? error.message : "Snapshot DVNS Index non valido.");
  }
}

function databaseConfigured(): boolean {
  try {
    databaseConnectionUrl();
    return true;
  } catch {
    return false;
  }
}

async function readDatabasePayload(receipt: Receipt): Promise<IndexSnapshot> {
  const sql = database();
  const rows = await sql.begin("read only", async (tx) => {
    await tx`set local statement_timeout = '10s'`;
    await tx`set local lock_timeout = '2s'`;
    return tx<{ payload: unknown; source_sha256: string; source_bytes: number | string }[]>`
      select d.payload, f.source_sha256, f.source_bytes
      from dvns_snapshots.documents d
      join dvns_snapshots.files f using (code_sha, path)
      where d.code_sha = ${receipt.codeSha}
        and d.path = ${receipt.documentPath}
      limit 1`;
  });
  const row = rows[0];
  if (!row || row.source_sha256 !== receipt.sourceSha256 || Number(row.source_bytes) !== receipt.sourceBytes) {
    throw new IndexSnapshotInvalidError("Snapshot DVNS Index assente o divergente dal receipt.");
  }
  return parse(row.payload);
}

async function readLocalPayload(receipt: Receipt): Promise<IndexSnapshot> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(process.cwd(), PAYLOAD_PATH));
  } catch {
    throw new IndexSnapshotUnavailableError();
  }
  if (bytes.length !== receipt.sourceBytes || createHash("sha256").update(bytes).digest("hex") !== receipt.sourceSha256) {
    throw new IndexSnapshotInvalidError("Snapshot DVNS Index locale divergente dal receipt.");
  }
  return parse(JSON.parse(bytes.toString("utf8")));
}

export type IndexData = {
  snapshot: IndexSnapshot;
  byIstat: Map<string, IndexEntry>;
  byTaxCode: Map<string, IndexEntry>;
  bins: number[];
  /** Columns of dots, each dot the Comuni it stands for (about 5.400 references, no copies). */
  dots: IndexEntry[][][];
  /** Position among the ranked Comuni of the same region. */
  regional: Map<string, RegionalRank>;
};

async function resolveView(): Promise<IndexData> {
  let snapshot: IndexSnapshot;
  try {
    const receipt = assertReceipt(JSON.parse(await readFile(join(process.cwd(), RECEIPT_PATH), "utf8")));
    if (databaseConfigured()) {
      try {
        snapshot = await readDatabasePayload(receipt);
      } catch (error) {
        if (error instanceof IndexSnapshotInvalidError) throw error;
        // Connection or timeout: the receipt-pinned local file is an equivalent source.
        snapshot = await readLocalPayload(receipt);
      }
    } else {
      snapshot = await readLocalPayload(receipt);
    }
  } catch (error) {
    if (error instanceof IndexSnapshotUnavailableError) throw error;
    console.error("dvns-index: snapshot rifiutato", error instanceof Error ? error.message : error);
    throw new IndexSnapshotUnavailableError();
  }
  return {
    snapshot,
    byIstat: new Map(snapshot.entries.map((entry) => [entry.istat, entry])),
    byTaxCode: new Map(snapshot.entries.flatMap((entry) => (entry.taxCode ? [[entry.taxCode, entry] as const] : []))),
    bins: distribution(snapshot.entries),
    dots: dotLayout(snapshot.entries),
    regional: regionalRanks(snapshot.entries),
  };
}

let cached: IndexData | undefined;
let inflight: Promise<IndexData> | undefined;

/** One read per instance. A failure is not cached: the next request tries again. */
export function loadDvnsIndex(): Promise<IndexData> {
  if (cached) return Promise.resolve(cached);
  inflight ??= resolveView()
    .then((result) => {
      cached = result;
      return result;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}
