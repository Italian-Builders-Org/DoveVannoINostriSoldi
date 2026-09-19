export type PreviewRect = { left: number; top: number; width: number; height: number };
export type PreviewPlacement = {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  side: "above" | "below";
};

const GUTTER = 8;
const GAP = 8;

/** Measured content, not a guessed tooltip height. Coordinates use the layout viewport. */
export function placePreview(anchor: PreviewRect, content: Pick<PreviewRect, "width" | "height">, viewport: PreviewRect): PreviewPlacement {
  for (const rect of [anchor, content, viewport]) {
    if (Object.values(rect).some((value) => !Number.isFinite(value)) || rect.width < 0 || rect.height < 0) {
      throw new RangeError("Dimensioni dell’anteprima non valide");
    }
  }
  const insetX = Math.min(GUTTER, viewport.width / 2);
  const insetY = Math.min(GUTTER, viewport.height / 2);
  const maxWidth = Math.max(0, viewport.width - insetX * 2);
  const maxHeight = Math.max(0, viewport.height - insetY * 2);
  const width = Math.min(content.width, maxWidth);
  const height = Math.min(content.height, maxHeight);
  const xMin = viewport.left + insetX;
  const yMin = viewport.top + insetY;
  const xMax = xMin + maxWidth - width;
  const yMax = yMin + maxHeight - height;
  const below = anchor.top + anchor.height + GAP;
  const above = anchor.top - GAP - height;
  const roomBelow = viewport.top + viewport.height - insetY - below;
  const roomAbove = anchor.top - GAP - yMin;
  const side = roomAbove >= height ? "above" : roomBelow >= height || roomBelow >= roomAbove ? "below" : "above";
  return {
    left: Math.max(xMin, Math.min(xMax, anchor.left + anchor.width / 2 - width / 2)),
    top: Math.max(yMin, Math.min(yMax, side === "above" ? above : below)),
    maxWidth, maxHeight, side,
  };
}
