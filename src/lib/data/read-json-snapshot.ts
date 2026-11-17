import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { closeSync, fstatSync, readSync } from "node:fs";
import { openRegularFileSync } from "@/lib/safe-fs";

/** Read server snapshots without asking TypeScript to infer every JSON row. */
export function readJsonSnapshot(filePath: string, maxBytes: number, gzip?: { sha256: string; maxOutputLength: number }): unknown {
  const fd = openRegularFileSync(filePath);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size <= 0 || before.size > maxBytes) {
      throw new Error("Snapshot assente o troppo grande.");
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error("Snapshot incompleto.");
      offset += count;
    }
    const after = fstatSync(fd);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
      throw new Error("Snapshot cambiato durante la lettura.");
    }
    if (gzip && createHash("sha256").update(bytes).digest("hex") !== gzip.sha256) {
      throw new Error("Hash dello snapshot divergente.");
    }
    const json = gzip ? gunzipSync(bytes, { maxOutputLength: gzip.maxOutputLength }) : bytes;
    return JSON.parse(json.toString("utf8")) as unknown;
  } finally {
    closeSync(fd);
  }
}
