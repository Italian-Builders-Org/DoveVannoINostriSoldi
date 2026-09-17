/**
 * Page arithmetic for the shared pagination control.
 *
 * The public views paginate by offset, so the page number is derived rather
 * than stored: it is always `offset / limit + 1`. Keeping the arithmetic here
 * means a page and its API route can never disagree on which page a URL is.
 */

export type PaginationStep = number | "gap";

/** Pages kept on either side of the current one before the list is elided. */
export const PAGINATION_RADIUS = 2;

export function pageCountFromTotal(total: number, limit: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(limit) || limit <= 0 || total <= 0) return 0;
  return Math.ceil(total / limit);
}

export function pageFromOffset(offset: number, limit: number): number {
  if (!Number.isFinite(offset) || !Number.isFinite(limit) || limit <= 0) return 1;
  return Math.floor(Math.max(0, offset) / limit) + 1;
}

export function offsetFromPage(page: number, limit: number): number {
  if (!Number.isFinite(page) || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(0, Math.trunc(page) - 1) * limit;
}

/**
 * The page numbers to render, with `"gap"` where the run is elided.
 *
 * A gap never stands in for a single page: eliding one number to draw an
 * ellipsis of the same width costs the reader a destination and saves nothing.
 */
export function paginationWindow(
  page: number,
  pageCount: number,
  radius = PAGINATION_RADIUS,
): readonly PaginationStep[] {
  if (!Number.isFinite(pageCount) || pageCount <= 1) return [];
  const current = Math.min(Math.max(Math.trunc(page), 1), pageCount);
  const wanted = new Set<number>([1, pageCount]);
  for (let offset = -radius; offset <= radius; offset += 1) {
    const candidate = current + offset;
    if (candidate >= 1 && candidate <= pageCount) wanted.add(candidate);
  }
  const numbers = [...wanted].sort((left, right) => left - right);

  const steps: PaginationStep[] = [];
  let previous = 0;
  for (const number of numbers) {
    const missing = number - previous - 1;
    if (previous !== 0 && missing === 1) steps.push(previous + 1);
    else if (missing > 1) steps.push("gap");
    steps.push(number);
    previous = number;
  }
  return steps;
}
