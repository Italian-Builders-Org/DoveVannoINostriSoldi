import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { database, databaseConnectionUrl } from "@/lib/integrated-supabase-reader";
import {
  assertEmendamentiSnapshot,
  buildEmendamentiView,
  buildExplorerRows,
  shortGroupLabel,
  type ExplorerRow,
  type EmendamentiSnapshot,
  type EmendamentiView,
} from "@/lib/manovra-emendamenti";

/**
 * Same pattern as the Bilancio in Breve snapshot: only the receipt is
 * versioned, the payload lives in dvns_snapshots. The reader accepts a payload
 * only when bytes and SHA-256 match the receipt, from the database first and
 * from the local ETL output otherwise.
 */
type Receipt = { documentPath: string; codeSha: string; sourceSha256: string; sourceBytes: number };

const RECEIPT_PATH = "src/data/generated/camera-emendamenti-bilancio-2027.receipt.json";
const PAYLOAD_PATH = "src/data/generated/camera-emendamenti-bilancio-2027.json";

export class EmendamentiSnapshotUnavailableError extends Error {
  constructor() {
    super("Emendamenti alla manovra non disponibili in questo ambiente.");
    this.name = "EmendamentiSnapshotUnavailableError";
  }
}

/** A payload that exists but does not match the receipt or the contract: never shown, never retried as missing. */
class EmendamentiSnapshotInvalidError extends Error {}

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
    throw new EmendamentiSnapshotInvalidError("Receipt emendamenti non valido.");
  }
  return { documentPath: PAYLOAD_PATH, codeSha: row.codeSha, sourceSha256: row.sourceSha256, sourceBytes: row.sourceBytes as number };
}

function parse(payload: unknown): EmendamentiSnapshot {
  try {
    return assertEmendamentiSnapshot(payload);
  } catch (error) {
    throw new EmendamentiSnapshotInvalidError(error instanceof Error ? error.message : "Snapshot emendamenti non valido.");
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

async function readDatabasePayload(receipt: Receipt): Promise<EmendamentiSnapshot> {
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
    throw new EmendamentiSnapshotInvalidError("Snapshot emendamenti assente o divergente dal receipt.");
  }
  return parse(row.payload);
}

async function readLocalPayload(receipt: Receipt): Promise<EmendamentiSnapshot> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(process.cwd(), PAYLOAD_PATH));
  } catch {
    throw new EmendamentiSnapshotUnavailableError();
  }
  if (bytes.length !== receipt.sourceBytes || createHash("sha256").update(bytes).digest("hex") !== receipt.sourceSha256) {
    throw new EmendamentiSnapshotInvalidError("Snapshot emendamenti locale divergente dal receipt.");
  }
  return parse(JSON.parse(bytes.toString("utf8")));
}

export type EmendamentiPageData = Pick<EmendamentiSnapshot, "act" | "source" | "deputiesSource" | "municipalitiesSource"> & {
  view: EmendamentiView;
  /** Compact rows for the searchable list: about 6.500 small objects per instance. */
  rows: ExplorerRow[];
  groups: { id: string; label: string }[];
};

async function resolveView(): Promise<EmendamentiPageData> {
  let snapshot: EmendamentiSnapshot;
  try {
    const receipt = assertReceipt(JSON.parse(await readFile(join(process.cwd(), RECEIPT_PATH), "utf8")));
    if (databaseConfigured()) {
      try {
        snapshot = await readDatabasePayload(receipt);
      } catch (error) {
        if (error instanceof EmendamentiSnapshotInvalidError) throw error;
        // Connection or timeout: the receipt-pinned local file is an equivalent source.
        snapshot = await readLocalPayload(receipt);
      }
    } else {
      snapshot = await readLocalPayload(receipt);
    }
  } catch (error) {
    if (error instanceof EmendamentiSnapshotUnavailableError) throw error;
    console.error("manovra-emendamenti: snapshot rifiutato", error instanceof Error ? error.message : error);
    throw new EmendamentiSnapshotUnavailableError();
  }
  // Aggregates and compact list rows stay in memory; texts and evidence of the full payload do not.
  const view = buildEmendamentiView(snapshot);
  return {
    act: snapshot.act,
    source: snapshot.source,
    deputiesSource: snapshot.deputiesSource,
    municipalitiesSource: snapshot.municipalitiesSource,
    view,
    rows: buildExplorerRows(snapshot),
    groups: view.groups.map((group) => ({ id: group.id, label: shortGroupLabel(group.label) })),
  };
}

let cached: EmendamentiPageData | undefined;
let inflight: Promise<EmendamentiPageData> | undefined;

/**
 * One read and one aggregation per instance. A failure is not cached: the
 * next request tries again instead of serving the error as if it were data.
 */
export function loadEmendamentiView(): Promise<EmendamentiPageData> {
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
