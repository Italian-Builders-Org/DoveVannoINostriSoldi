export type CompositionRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  areaShare: number;
};

type WeightedItem = { id: string; value: number };

function sum(items: readonly WeightedItem[]): number {
  return items.reduce((total, item) => total + item.value, 0);
}

function balancedSplitIndex(items: readonly WeightedItem[]): number {
  const target = sum(items) / 2;
  let running = 0;
  let bestIndex = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < items.length; index += 1) {
    running += items[index - 1].value;
    const distance = Math.abs(target - running);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/** Deterministic binary treemap: proportional area without DOM measurement. */
export function layoutComposition(
  items: readonly WeightedItem[],
  width = 100,
  height = 62,
): CompositionRect[] {
  if (width <= 0 || height <= 0) throw new Error("Composition bounds must be positive");
  if (items.some((item) => !Number.isFinite(item.value) || item.value < 0)) {
    throw new Error("Composition values must be finite and non-negative");
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("Composition ids must be unique");
  }

  const positive = items.filter((item) => item.value > 0);
  const total = sum(positive);
  if (total <= 0) return [];
  const rectangles: CompositionRect[] = [];

  function place(group: readonly WeightedItem[], x: number, y: number, w: number, h: number) {
    const groupTotal = sum(group);
    if (group.length === 1) {
      rectangles.push({ id: group[0].id, x, y, width: w, height: h, areaShare: group[0].value / total });
      return;
    }
    const splitAt = balancedSplitIndex(group);
    const first = group.slice(0, splitAt);
    const second = group.slice(splitAt);
    const firstShare = sum(first) / groupTotal;
    if (w >= h) {
      const firstWidth = w * firstShare;
      place(first, x, y, firstWidth, h);
      place(second, x + firstWidth, y, w - firstWidth, h);
    } else {
      const firstHeight = h * firstShare;
      place(first, x, y, w, firstHeight);
      place(second, x, y + firstHeight, w, h - firstHeight);
    }
  }

  place(positive, 0, 0, width, height);
  return rectangles;
}
