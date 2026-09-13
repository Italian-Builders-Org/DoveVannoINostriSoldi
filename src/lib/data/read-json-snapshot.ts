import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

/** Read server snapshots without asking TypeScript to infer every JSON row. */
export function readJsonSnapshot(filePath: string, maxBytes: number): unknown {
  const fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
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
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } finally {
    closeSync(fd);
  }
}
