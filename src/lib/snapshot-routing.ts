export const SNAPSHOT_PREFIX = "/snapshot-pages/";
export const IPA_CODE = /^[A-Za-z0-9_]{1,100}$/;
export const DATASET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const OPERATOR_REF = /^op-[0-9]{8}$/;
/** Conto Annuale institution codes in the committed occupation index. */
export const OCCUPAZIONE_INSTITUTION_CODE = /^\d{1,10}$/;
export const CACHED_ENTITY_VIEWS = new Set(["summary", "operators", "procedures", "awards"]);

export function publicSnapshotPath(path: string): string | null {
  const parts = path.slice(SNAPSHOT_PREFIX.length).split("/");
  if (parts[0] === "enti" && parts.length === 3 && IPA_CODE.test(parts[1]!) && CACHED_ENTITY_VIEWS.has(parts[2]!)) {
    return `/enti/${parts[1]}/appalti`;
  }
  if (parts[0] === "dati" && parts.length === 2 && parts[1]!.length <= 200 && DATASET_ID.test(parts[1]!)) return `/dati/${parts[1]}`;
  if (parts[0] === "operatori" && parts.length === 2 && OPERATOR_REF.test(parts[1]!)) return `/appalti/operatori/${parts[1]}`;
  if (parts[0] === "comuni" && parts.length === 2 && IPA_CODE.test(parts[1]!)) return "/comuni";
  if (
    parts[0] === "personale-pa"
    && parts[1] === "conto-annuale"
    && parts.length === 2
  ) {
    return "/personale-pa/conto-annuale";
  }
  if (
    parts[0] === "personale-pa"
    && parts[1] === "conto-annuale"
    && parts.length === 3
    && OCCUPAZIONE_INSTITUTION_CODE.test(parts[2]!)
  ) {
    return `/personale-pa/conto-annuale/${parts[2]}`;
  }
  return null;
}

/** Server rewrites and client URL bars must select the same navigation. */
export function publicSurfacePath(path: string): string {
  return path.startsWith(SNAPSHOT_PREFIX) ? publicSnapshotPath(path) ?? path : path;
}
