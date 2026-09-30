export const SNAPSHOT_PREFIX = "/snapshot-pages/";
export const IPA_CODE = /^[A-Za-z0-9_]{1,100}$/;
export const OPERATOR_REF = /^op-[0-9]{8}$/;
export const CACHED_ENTITY_VIEWS = new Set(["summary", "operators", "procedures", "awards"]);

export function publicSnapshotPath(path: string): string | null {
  const parts = path.slice(SNAPSHOT_PREFIX.length).split("/");
  if (parts[0] === "enti" && parts.length === 3 && IPA_CODE.test(parts[1]!) && CACHED_ENTITY_VIEWS.has(parts[2]!)) {
    return `/enti/${parts[1]}/appalti`;
  }
  if (parts[0] === "operatori" && parts.length === 2 && OPERATOR_REF.test(parts[1]!)) return `/appalti/operatori/${parts[1]}`;
  if (parts[0] === "comuni" && parts.length === 2 && IPA_CODE.test(parts[1]!)) return "/comuni";
  return null;
}

/** Server rewrites and client URL bars must select the same navigation. */
export function publicSurfacePath(path: string): string {
  return path.startsWith(SNAPSHOT_PREFIX) ? publicSnapshotPath(path) ?? path : path;
}
