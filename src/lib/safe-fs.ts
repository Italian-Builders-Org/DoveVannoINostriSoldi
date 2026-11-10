import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  type Stats,
} from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";

/** O_NOFOLLOW is missing on Windows; never let `| undefined` collapse the flags to 0 alone. */
function readNoFollowFlags(): number {
  return constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
}

function assertSameRegularFile(before: Stats, opened: Stats, path: string): void {
  if (
    !opened.isFile() ||
    opened.dev !== before.dev ||
    opened.ino !== before.ino
  ) {
    throw new Error(`Percorso non regolare o cambiato prima della lettura: ${path}`);
  }
}

/**
 * Open a regular file without following symlinks when the platform supports it.
 * Always lstat first and re-check identity via fstat so Windows cannot silently
 * follow a link when `O_NOFOLLOW` is undefined.
 */
export function openRegularFileSync(path: string): number {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`Percorso non regolare: ${path}`);
  }
  const fd = openSync(path, readNoFollowFlags());
  try {
    assertSameRegularFile(before, fstatSync(fd), path);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

/** Async counterpart of {@link openRegularFileSync}. Caller must close the handle. */
export async function openRegularFile(path: string): Promise<FileHandle> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`Percorso non regolare: ${path}`);
  }
  const handle = await open(path, readNoFollowFlags());
  try {
    assertSameRegularFile(before, await handle.stat(), path);
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}
