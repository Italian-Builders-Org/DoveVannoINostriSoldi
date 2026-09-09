import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export const MCP_RATE_LIMIT_WINDOW_MS = 60_000;
export const MCP_RATE_LIMIT_SAFETY_MS = 100;

function requireFiniteNonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite, non-negative number`);
  }
}

export function remainingMcpRateLimitWaitMs({
  windowOpenedAtMs,
  nowMs,
  windowMs = MCP_RATE_LIMIT_WINDOW_MS,
  safetyMs = MCP_RATE_LIMIT_SAFETY_MS,
}) {
  requireFiniteNonNegative(windowOpenedAtMs, "windowOpenedAtMs");
  requireFiniteNonNegative(nowMs, "nowMs");
  requireFiniteNonNegative(windowMs, "windowMs");
  requireFiniteNonNegative(safetyMs, "safetyMs");

  if (windowMs === 0) {
    throw new RangeError("windowMs must be greater than zero");
  }

  return Math.max(0, windowOpenedAtMs + windowMs + safetyMs - nowMs);
}

async function main() {
  const windowOpenedAtMs = Number(process.argv[2]);
  const waitMs = remainingMcpRateLimitWaitMs({
    windowOpenedAtMs,
    nowMs: Date.now(),
  });

  if (waitMs === 0) {
    console.log("MCP rate-limit window already elapsed; continuing immediately.");
    return;
  }

  console.log(`Waiting ${waitMs}ms for the MCP rate-limit window to elapse.`);
  await delay(waitMs);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  await main();
}
