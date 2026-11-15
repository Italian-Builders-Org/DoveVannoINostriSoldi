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

function assertOpenedMatchesPath(path: string, opened: Stats): void {
  const link = lstatSync(path);
  if (
    link.isSymbolicLink() ||
    !link.isFile() ||
    !opened.isFile() ||
    link.dev !== opened.dev ||
    link.ino !== opened.ino
  ) {
    throw new Error(`Percorso non regolare o cambiato prima della lettura: ${path}`);
  }
}

async function assertOpenedMatchesPathAsync(path: string, opened: Stats): Promise<void> {
  const link = await lstat(path);
  if (
    link.isSymbolicLink() ||
    !link.isFile() ||
    !opened.isFile() ||
    link.dev !== opened.dev ||
    link.ino !== opened.ino
  ) {
    throw new Error(`Percorso non regolare o cambiato prima della lettura: ${path}`);
  }
}

/**
 * Open a regular file without following symlinks when the platform supports it.
 * Open first (with O_NOFOLLOW when available), then confirm the path is still the
 * same regular file via lstat identity — so Windows cannot keep a silently followed
 * symlink after the open.
 */
export function openRegularFileSync(path: string): number {
  const fd = openSync(path, readNoFollowFlags());
  try {
    assertOpenedMatchesPath(path, fstatSync(fd));
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

/** Async counterpart of {@link openRegularFileSync}. Caller must close the handle. */
export async function openRegularFile(path: string): Promise<FileHandle> {
  const handle = await open(path, readNoFollowFlags());
  try {
    await assertOpenedMatchesPathAsync(path, await handle.stat());
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}
