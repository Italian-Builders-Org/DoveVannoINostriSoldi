import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { database, databaseConnectionUrl } from "@/lib/integrated-supabase-reader";
import { assertLicenzeSnapshot, buildLicenzeView, type LicenzeSnapshot, type LicenzeView } from "@/lib/pa-licenze-software";

/**
 * Same pattern as the amendments and Bilancio in Breve snapshots: only the
 * receipt is versioned, the payload (about 23 KB) lives in dvns_snapshots. A
 * payload is accepted only when bytes and SHA-256 match the receipt, from the
 * database first and from the local ETL output otherwise.
 */
type Receipt = { documentPath: string; codeSha: string; sourceSha256: string; sourceBytes: number };

const RECEIPT_PATH = "src/data/generated/pa-licenze-software.receipt.json";
const PAYLOAD_PATH = "src/data/generated/pa-licenze-software.json";

export class LicenzeSnapshotUnavailableError extends Error {
  constructor() {
    super("Dati sulle licenze software non disponibili in questo ambiente.");
    this.name = "LicenzeSnapshotUnavailableError";
  }
}

/** A payload that exists but does not match the receipt or the contract: never shown. */
class LicenzeSnapshotInvalidError extends Error {}

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
    throw new LicenzeSnapshotInvalidError("Receipt licenze software non valido.");
  }
  return { documentPath: PAYLOAD_PATH, codeSha: row.codeSha, sourceSha256: row.sourceSha256, sourceBytes: row.sourceBytes as number };
}

function parse(payload: unknown): LicenzeSnapshot {
  try {
    return assertLicenzeSnapshot(payload);
  } catch (error) {
    throw new LicenzeSnapshotInvalidError(error instanceof Error ? error.message : "Snapshot licenze software non valido.");
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

async function readDatabasePayload(receipt: Receipt): Promise<LicenzeSnapshot> {
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
    throw new LicenzeSnapshotInvalidError("Snapshot licenze software assente o divergente dal receipt.");
  }
  return parse(row.payload);
}

async function readLocalPayload(receipt: Receipt): Promise<LicenzeSnapshot> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(process.cwd(), PAYLOAD_PATH));
  } catch {
    throw new LicenzeSnapshotUnavailableError();
  }
  if (bytes.length !== receipt.sourceBytes || createHash("sha256").update(bytes).digest("hex") !== receipt.sourceSha256) {
    throw new LicenzeSnapshotInvalidError("Snapshot licenze software locale divergente dal receipt.");
  }
  return parse(JSON.parse(bytes.toString("utf8")));
}

export type LicenzePageData = { snapshot: LicenzeSnapshot; view: LicenzeView };

async function resolveView(): Promise<LicenzePageData> {
  let snapshot: LicenzeSnapshot;
  try {
    const receipt = assertReceipt(JSON.parse(await readFile(join(process.cwd(), RECEIPT_PATH), "utf8")));
    if (databaseConfigured()) {
      try {
        snapshot = await readDatabasePayload(receipt);
      } catch (error) {
        if (error instanceof LicenzeSnapshotInvalidError) throw error;
        // Connection or timeout: the receipt-pinned local file is an equivalent source.
        snapshot = await readLocalPayload(receipt);
      }
    } else {
      snapshot = await readLocalPayload(receipt);
    }
  } catch (error) {
    if (error instanceof LicenzeSnapshotUnavailableError) throw error;
    console.error("pa-licenze-software: snapshot rifiutato", error instanceof Error ? error.message : error);
    throw new LicenzeSnapshotUnavailableError();
  }
  return { snapshot, view: buildLicenzeView(snapshot) };
}

let cached: LicenzePageData | undefined;
let inflight: Promise<LicenzePageData> | undefined;

/** One read per instance. A failure is not cached: the next request tries again. */
export function loadLicenzeView(): Promise<LicenzePageData> {
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
