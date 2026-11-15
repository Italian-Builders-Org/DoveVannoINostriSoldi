import "server-only";
import { request as httpsRequest } from "node:https";

export const DVNS_SUPABASE_URL = "https://zvqhikeylxynsljwgosc.supabase.co";

type Config = { publishableKey: string; email: string; password: string };
type Headers = { apikey: string; Authorization: string };
type Options = {
  config?: () => Config;
  now?: () => number;
  request?: (config: Config) => Promise<unknown>;
};

function environmentConfig(): Config {
  return {
    publishableKey: process.env.DVNS_ARCHIVE_PUBLISHABLE_KEY ?? "",
    email: process.env.DVNS_ARCHIVE_EMAIL ?? "",
    password: process.env.DVNS_ARCHIVE_PASSWORD ?? "",
  };
}

async function signIn(config: Config): Promise<unknown> {
  // Native HTTPS avoids changing the containing page's Next fetch/ISR policy.
  // Only the small Auth response is buffered, with an independent shared deadline.
  return new Promise((resolve, reject) => {
    const request = httpsRequest(`${DVNS_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: config.publishableKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    }, async response => {
      try {
        if (response.statusCode !== 200) {
          response.destroy();
          throw new Error();
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of response) {
          bytes += chunk.length;
          if (bytes > 64 * 1024) {
            response.destroy();
            throw new Error();
          }
          chunks.push(Buffer.from(chunk));
        }
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Autenticazione archivio DVNS non disponibile."));
      }
    });
    request.on("error", () => reject(new Error("Autenticazione archivio DVNS non disponibile.")));
    request.end(JSON.stringify({ email: config.email, password: config.password }));
  });
}

export function createArchiveSession(options: Options = {}) {
  const now = options.now ?? Date.now;
  const readConfig = options.config ?? environmentConfig;
  const authenticate = options.request ?? signIn;
  let cached: { headers: Headers; renewAt: number } | undefined;
  let pending: Promise<Headers> | undefined;
  let retryAt = 0;

  async function login(): Promise<Headers> {
    try {
      const config = readConfig();
      if (!config.publishableKey.startsWith("sb_publishable_") ||
          !config.email.includes("@") || !config.password) throw new Error();
      const value = await authenticate(config) as Record<string, unknown> | null;
      if (!value || typeof value.access_token !== "string" ||
          !/^[A-Za-z0-9_.-]+$/.test(value.access_token) ||
          value.token_type !== "bearer" || typeof value.expires_in !== "number" ||
          !Number.isSafeInteger(value.expires_in) || value.expires_in < 120 ||
          value.expires_in > 86400) throw new Error();
      const headers = { apikey: config.publishableKey, Authorization: `Bearer ${value.access_token}` };
      cached = { headers, renewAt: now() + (value.expires_in - 60) * 1000 };
      retryAt = 0;
      return headers;
    } catch {
      cached = undefined;
      // Prevent a failing account/Auth endpoint from being hammered by visits.
      retryAt = now() + 5000;
      throw new Error("Autenticazione archivio DVNS non disponibile.");
    }
  }

  return {
    async headers(signal?: AbortSignal): Promise<Headers> {
      signal?.throwIfAborted();
      if (cached && now() < cached.renewAt) return cached.headers;
      if (now() < retryAt) throw new Error("Autenticazione archivio DVNS non disponibile.");
      // Each instance obtains its own session. No rotating refresh token is
      // persisted in env or shared between concurrent serverless instances.
      pending ??= login().finally(() => { pending = undefined; });
      const headers = await pending;
      signal?.throwIfAborted();
      return headers;
    },
    invalidate(authorization: string) {
      if (cached?.headers.Authorization === authorization) cached = undefined;
    },
  };
}

export const archiveSession = createArchiveSession();
