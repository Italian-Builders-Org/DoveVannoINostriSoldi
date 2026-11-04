import { closeSync, constants, fstatSync, lstatSync, openSync, type BigIntStats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";

// Windows has no O_NOFOLLOW: the lstat check and the dev/ino comparison below
// keep links out there too, without the race of checking after the open.
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

function linkError(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${path} è un link simbolico.`), { code: "ELOOP" });
}

function sameFile(before: BigIntStats, opened: BigIntStats): boolean {
  return before.dev === opened.dev && before.ino === opened.ino;
}

/** Open read-only, refusing symbolic links on every platform. */
export function openRegularFileSync(path: string, noFollow: number = NO_FOLLOW): number {
  const before = lstatSync(path, { bigint: true });
  if (before.isSymbolicLink()) throw linkError(path);
  const fd = openSync(path, constants.O_RDONLY | noFollow);
  try {
    if (!sameFile(before, fstatSync(fd, { bigint: true }))) throw linkError(path);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

/** Async twin of {@link openRegularFileSync}. */
export async function openRegularFile(path: string, noFollow: number = NO_FOLLOW): Promise<FileHandle> {
  const before = await lstat(path, { bigint: true });
  if (before.isSymbolicLink()) throw linkError(path);
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    if (!sameFile(before, await handle.stat({ bigint: true }))) throw linkError(path);
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}
