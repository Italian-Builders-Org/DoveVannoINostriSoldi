/** Public configuration only. Credentials and quota decisions stay on the server. */
export const FREE_DAILY_QUESTIONS = 10;
export const FREE_MODEL = "glm5.2";
export type FreeQuota = { available: boolean; remaining: number; resetAt: string };
export function isFreeQuota(value: unknown): value is FreeQuota {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.available === "boolean" && Number.isInteger(item.remaining) &&
    Number(item.remaining) >= 0 && Number(item.remaining) <= FREE_DAILY_QUESTIONS &&
    typeof item.resetAt === "string" && Number.isFinite(Date.parse(item.resetAt));
}
