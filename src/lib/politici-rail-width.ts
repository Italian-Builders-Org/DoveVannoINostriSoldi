export const RAIL_WIDTH_MIN = 280;
export const RAIL_WIDTH_DEFAULT = 320;
export const RAIL_WIDTH_STORAGE_KEY = "dvns-politici-rail-width";

export function maxRailWidth(viewportWidth: number): number {
  return Math.max(RAIL_WIDTH_MIN, Math.min(640, Math.floor(viewportWidth / 2)));
}

export function clampRailWidth(value: number, viewportWidth: number): number {
  return Math.min(maxRailWidth(viewportWidth), Math.max(RAIL_WIDTH_MIN, Math.round(value)));
}

export function parseStoredRailWidth(raw: string | null, viewportWidth: number): number | null {
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < RAIL_WIDTH_MIN || parsed > maxRailWidth(viewportWidth)) return null;
  return Math.round(parsed);
}
