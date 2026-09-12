import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { isLoopbackHost } from "@/lib/http/public-post-guard";
import { AI_KEY_PATTERN } from "@/lib/assistant/byok-contracts";
import { FREE_DAILY_QUESTIONS, type FreeQuota } from "@/lib/assistant/free-contracts";

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
const offsetFormat = new Intl.DateTimeFormat("en", { timeZone: "Europe/Rome", timeZoneName: "longOffset" });
export function quotaDay(now = Date.now()) {
  const parts = dayFormat.formatToParts(now);
  const day = ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
  const midnight = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
  let end = midnight;
  for (let i = 0; i < 2; i++) {
    const offset = offsetFormat.formatToParts(end).find((part) => part.type === "timeZoneName")!.value.match(/GMT([+-])(\d{2}):(\d{2})/u)!;
    end = midnight - (offset[1] === "+" ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60_000;
  }
  return { day, end, resetAt: new Date(end).toISOString() };
}

/** IPv6 uses a /64 network; alternate spellings and IPv4-mapped addresses share a quota. */
export function quotaNetwork(address: string): string | null {
  if (isIP(address) === 4) return address;
  if (isIP(address) !== 6 || address.includes("%")) return null;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split("::");
  const head = left ? left.split(":") : [];
  const tail = right ? right.split(":") : [];
  const words = right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  const values = words.map((word) => parseInt(word, 16));
  if (values.slice(0, 5).every((n) => n === 0) && values[5] === 0xffff) {
    return [values[6] >> 8, values[6] & 255, values[7] >> 8, values[7] & 255].join(".");
  }
  return values.slice(0, 4).map((n) => n.toString(16).padStart(4, "0")).join(":") + "::/64";
}

export class FreeQuotaError extends Error {
  readonly code: "free_unavailable" | "free_limit" | "free_busy" | "free_identity";
  constructor(code: FreeQuotaError["code"]) { super(code); this.code = code; }
}

function configuration() {
  const apiKey = process.env.REGOLO_API_KEY ?? "";
  const secret = process.env.ASSISTANT_QUOTA_SECRET ?? "";
  const endpoint = process.env.UPSTASH_REDIS_REST_URL ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  if (!AI_KEY_PATTERN.test(apiKey) || secret.length < 32 || !AI_KEY_PATTERN.test(token)) throw new FreeQuotaError("free_unavailable");
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new FreeQuotaError("free_unavailable"); }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".upstash.io") || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new FreeQuotaError("free_unavailable");
  return { apiKey, secret, endpoint: url.href, token };
}

function identity(request: Request, secret: string, create: boolean, now: number) {
  const { day, end, resetAt } = quotaDay(now);
  const local = !process.env.VERCEL && isLoopbackHost(new URL(request.url).host);
  // On Vercel this header is set by the trusted ingress, not supplied by the browser.
  const address = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for") : local ? "127.0.0.1" : null;
  const network = address ? quotaNetwork(address.trim()) : null;
  if (!network) throw new FreeQuotaError("free_unavailable");
  const sign = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
  const name = local ? "dvns-assistant" : "__Host-dvns-assistant";
  const cookies = (request.headers.get("cookie") ?? "").split(";").map((v) => v.trim()).filter((v) => v.startsWith(`${name}=`));
  const value = cookies.length === 1 ? cookies[0].slice(name.length + 1) : "";
  const match = value.match(/^(\d{4}-\d{2}-\d{2})\.([a-f0-9]{32})\.([a-f0-9]{64})$/u);
  const valid = match?.[1] === day && timingSafeEqual(Buffer.from(match[3], "hex"), Buffer.from(sign(`cookie:${day}:${match[2]}`), "hex"));
  if (!valid && !create) throw new FreeQuotaError("free_identity");
  const id = valid ? match![2] : randomBytes(16).toString("hex");
  const cookie = valid ? undefined : `${name}=${day}.${id}.${sign(`cookie:${day}:${id}`)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.ceil((end - now) / 1000)}${local ? "" : "; Secure"}`;
  const scope = process.env.VERCEL_ENV === "production" ? "production" : process.env.VERCEL ? "preview" : "local";
  const prefix = `dvns:assistant:v1:${scope}:${day}`;
  const browser = `${prefix}:browser:${sign(`browser:${day}:${id}`)}`;
  const ip = `${prefix}:network:${sign(`network:${day}:${network}`)}`;
  return { keys: [browser, ip, `${browser}:active`, `${ip}:active`, `${ip}:burst`], cookie, end, resetAt };
}

// One atomic primary-store operation: status reads never reserve a question.
// Counts are bounded independently by browser and network; no process-local fallback.
export const QUOTA_SCRIPT = `
local a = tonumber(redis.call('GET', KEYS[1]) or '0')
local b = tonumber(redis.call('GET', KEYS[2]) or '0')
local used = math.max(a, b)
local burst = redis.call('INCR', KEYS[5])
if burst == 1 then redis.call('PEXPIRE', KEYS[5], 60000) end
if burst > 60 then return {-2, used} end
if ARGV[1] == 'status' then return {1, used} end
if used >= tonumber(ARGV[2]) then return {0, used} end
if redis.call('EXISTS', KEYS[3]) == 1 or redis.call('EXISTS', KEYS[4]) == 1 then return {-1, used} end
redis.call('SET', KEYS[3], ARGV[4], 'PX', 90000)
redis.call('SET', KEYS[4], ARGV[4], 'PX', 90000)
for i = 1, 2 do
  redis.call('INCR', KEYS[i])
  redis.call('PEXPIREAT', KEYS[i], ARGV[3])
end
return {1, used + 1}
`;
const RELEASE_SCRIPT = `for i = 1, 2 do if redis.call('GET', KEYS[i]) == ARGV[1] then redis.call('DEL', KEYS[i]) end end return 1`;

async function command(config: ReturnType<typeof configuration>, body: unknown[], signal: AbortSignal): Promise<unknown> {
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(2500)]);
  try {
    boundedSignal.throwIfAborted();
    const response = await fetch(config.endpoint, { method: "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: boundedSignal, cache: "no-store", redirect: "error", credentials: "omit" });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(); }
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    boundedSignal.addEventListener("abort", cancel, { once: true });
    let text = "", size = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      boundedSignal.throwIfAborted();
      while (true) { const next = await reader.read(); boundedSignal.throwIfAborted(); if (next.done) break; size += next.value.byteLength; if (size > 4096) throw new Error(); text += decoder.decode(next.value, { stream: true }); }
      const payload = JSON.parse(text + decoder.decode());
      if (!payload || Object.hasOwn(payload, "error")) throw new Error();
      return payload.result;
    } finally { boundedSignal.removeEventListener("abort", cancel); await reader.cancel().catch(() => undefined); }
  } catch { throw new FreeQuotaError("free_unavailable"); }
}

export async function freeQuota(request: Request, reserve = false, now = Date.now()) {
  const config = configuration();
  const owner = identity(request, config.secret, !reserve, now);
  const lease = randomBytes(16).toString("hex");
  const result = await command(config, ["EVAL", QUOTA_SCRIPT, 5, ...owner.keys, reserve ? "reserve" : "status", FREE_DAILY_QUESTIONS, owner.end + 120_000, lease], request.signal);
  if (!Array.isArray(result) || result.length !== 2 || !Number.isInteger(result[0]) || !Number.isInteger(result[1]) || result[1] < 0 || result[1] > FREE_DAILY_QUESTIONS) throw new FreeQuotaError("free_unavailable");
  if (result[0] === 0) throw new FreeQuotaError("free_limit");
  if (result[0] === -1 || result[0] === -2) throw new FreeQuotaError("free_busy");
  if (result[0] !== 1) throw new FreeQuotaError("free_unavailable");
  let released = false;
  return {
    quota: { available: true, remaining: FREE_DAILY_QUESTIONS - result[1], resetAt: owner.resetAt } satisfies FreeQuota,
    cookie: owner.cookie, apiKey: config.apiKey,
    async release() {
      if (!reserve || released) return;
      released = true;
      // Independent cancellation: clean up a disconnected caller's lease, or let its TTL expire.
      await command(config, ["EVAL", RELEASE_SCRIPT, 2, ...owner.keys.slice(2, 4), lease], AbortSignal.timeout(2500)).catch(() => undefined);
    },
  };
}
