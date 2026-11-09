import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { database } from "@/lib/integrated-supabase-reader";
import {
  assertManovraSnapshot,
  type ManovraSnapshot,
} from "@/lib/manovra-bilancio-breve";

type ManovraReceipt = {
  schemaVersion: number;
  documentPath: string;
  codeSha: string;
  sourceSha256: string;
  sourceBytes: number;
};

const RECEIPT_PATH = "src/data/generated/rgs-bilancio-in-breve.receipt.json";

function assertReceipt(value: unknown): ManovraReceipt {
  if (!value || typeof value !== "object") {
    throw new Error("Receipt manovra assente o non valido.");
  }
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1) {
    throw new Error("Receipt manovra: schemaVersion inattesa.");
  }
  if (typeof row.documentPath !== "string" || !row.documentPath.endsWith(".json")) {
    throw new Error("Receipt manovra: documentPath non valido.");
  }
  if (typeof row.codeSha !== "string" || !/^[0-9a-f]{40}$/.test(row.codeSha)) {
    throw new Error("Receipt manovra: codeSha non valido.");
  }
  if (typeof row.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.sourceSha256)) {
    throw new Error("Receipt manovra: sourceSha256 non valido.");
  }
  if (typeof row.sourceBytes !== "number" || !Number.isInteger(row.sourceBytes) || row.sourceBytes <= 0) {
    throw new Error("Receipt manovra: sourceBytes non valido.");
  }
  return {
    schemaVersion: 1,
    documentPath: row.documentPath,
    codeSha: row.codeSha,
    sourceSha256: row.sourceSha256,
    sourceBytes: row.sourceBytes,
  };
}

let cached: Promise<ManovraSnapshot> | undefined;

/** Load the pinned Bilancio in Breve snapshot from dvns_snapshots. Fail-closed. */
export function loadManovraSnapshot(): Promise<ManovraSnapshot> {
  cached ??= (async () => {
    const receipt = assertReceipt(
      JSON.parse(await readFile(join(process.cwd(), RECEIPT_PATH), "utf8")),
    );
    try {
      const sql = database();
      const rows = await sql.begin("read only", async (tx) => {
        await tx`set local statement_timeout = '10s'`;
        await tx`set local lock_timeout = '2s'`;
        return tx<{
          payload: unknown;
          source_sha256: string;
          source_bytes: number | string;
        }[]>`
          select d.payload, f.source_sha256, f.source_bytes
          from dvns_snapshots.documents d
          join dvns_snapshots.files f using (code_sha, path)
          where d.code_sha = ${receipt.codeSha}
            and d.path = ${receipt.documentPath}
          limit 1`;
      });
      const row = rows[0];
      const sourceBytes = Number(row?.source_bytes);
      if (
        !row ||
        row.source_sha256 !== receipt.sourceSha256 ||
        !Number.isInteger(sourceBytes) ||
        sourceBytes !== receipt.sourceBytes
      ) {
        throw new Error("Snapshot manovra assente o divergente dal receipt.");
      }
      return assertManovraSnapshot(row.payload);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.startsWith("Snapshot Bilancio") ||
          error.message.startsWith("Snapshot manovra"))
      ) {
        throw error;
      }
      throw new Error("Lettura manovra da Supabase non disponibile o non verificata.");
    }
  })();
  return cached;
}
