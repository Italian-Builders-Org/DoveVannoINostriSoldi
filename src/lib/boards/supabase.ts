import "server-only";

export type BoardsSupabaseConfig = {
  url: string;
  anonKey: string;
  secretKey: string;
};

export function boardsSupabaseConfig(): BoardsSupabaseConfig | null {
  const urlRaw = (process.env.BOARDS_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.BOARDS_SUPABASE_ANON_KEY ?? "").trim();
  const secretKey = (process.env.BOARDS_SUPABASE_SECRET_KEY ?? "").trim();
  if (!urlRaw.startsWith("https://") || anonKey.length < 20 || secretKey.length < 20) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(urlRaw);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== "/"
  ) {
    return null;
  }
  return { url: url.href.replace(/\/$/u, ""), anonKey, secretKey };
}

export function boardsCloudStorageAvailable(): boolean {
  return boardsSupabaseConfig() !== null && Boolean(process.env.BOARDS_AUTH_SECRET?.trim());
}

async function readJson(response: Response, maxBytes = 1_000_000): Promise<unknown> {
  if (!response.body) throw new Error("Risposta Supabase vuota");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Risposta Supabase troppo grande");
    }
    text += decoder.decode(next.value, { stream: true });
  }
  text += decoder.decode();
  if (!text) return null;
  return JSON.parse(text);
}

/**
 * Magic link senza password (anon key). `redirect_to` deve essere in
 * Authentication → URL Configuration → Redirect URLs (es. /accedi/callback).
 * I template Supabase devono usare `{{ .ConfirmationURL }}`, non solo `{{ .Token }}`.
 */
export async function supabaseRequestEmailOtp(
  email: string,
  redirectTo?: string,
): Promise<void> {
  const config = boardsSupabaseConfig();
  if (!config) throw new Error("Supabase Boards non configurato");
  const body: Record<string, unknown> = {
    email,
    create_user: true,
  };
  if (redirectTo) body.redirect_to = redirectTo;
  const response = await fetch(`${config.url}/auth/v1/otp`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Invio email di accesso non riuscito. Riprova tra poco.");
  }
  await response.body?.cancel().catch(() => undefined);
}

/** Valida access_token Supabase e restituisce user id + email. */
export async function supabaseUserFromAccessToken(
  accessToken: string,
): Promise<{ userId: string; email: string }> {
  const config = boardsSupabaseConfig();
  if (!config) throw new Error("Supabase Boards non configurato");
  const response = await fetch(`${config.url}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await readJson(response, 64_000);
  if (!response.ok) {
    throw new Error("Sessione Supabase non valida o scaduta.");
  }
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const userId = typeof record.id === "string" ? record.id : "";
  const email = typeof record.email === "string" ? record.email.toLowerCase() : "";
  if (!/^[0-9a-f-]{8,64}$/iu.test(userId) || !email.includes("@")) {
    throw new Error("Profilo Supabase incompleto.");
  }
  return { userId: userId.toLowerCase(), email };
}

/**
 * Completa il click sul link email (token_hash + type dalla query).
 * Prova più type GoTrue perché Confirm signup / Magic Link usano etichette diverse.
 */
export async function supabaseVerifyTokenHash(
  tokenHash: string,
  type: string,
): Promise<{ userId: string; email: string; accessToken: string | null }> {
  const config = boardsSupabaseConfig();
  if (!config) throw new Error("Supabase Boards non configurato");

  const preferred = type.trim() || "email";
  const types = [...new Set([preferred, "email", "magiclink", "signup"])];

  for (const candidate of types) {
    const response = await fetch(`${config.url}/auth/v1/verify`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: candidate, token_hash: tokenHash }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await readJson(response, 64_000);
    if (!response.ok) continue;
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const user = record.user && typeof record.user === "object"
      ? (record.user as Record<string, unknown>)
      : null;
    const userId = typeof user?.id === "string" ? user.id : "";
    const email = typeof user?.email === "string" ? user.email.toLowerCase() : "";
    const accessToken = typeof record.access_token === "string" ? record.access_token : null;
    if (!/^[0-9a-f-]{8,64}$/iu.test(userId) || !email.includes("@")) {
      throw new Error("Sessione Supabase incompleta dopo il link.");
    }
    return { userId: userId.toLowerCase(), email, accessToken };
  }

  throw new Error("Link di accesso non valido o scaduto. Richiedine uno nuovo.");
}

export async function supabaseVerifyEmailOtp(
  email: string,
  token: string,
): Promise<{ userId: string; email: string }> {
  const config = boardsSupabaseConfig();
  if (!config) throw new Error("Supabase Boards non configurato");

  // GoTrue usa tipi diversi a seconda del template / primo signup.
  const types = ["email", "magiclink", "signup"] as const;
  let lastMessage = "Codice non valido o scaduto.";

  for (const type of types) {
    const response = await fetch(`${config.url}/auth/v1/verify`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type, email, token }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await readJson(response, 64_000);
    if (!response.ok) {
      const record = payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
      const msg =
        typeof record.msg === "string"
          ? record.msg
          : typeof record.error_description === "string"
            ? record.error_description
            : typeof record.error === "string"
              ? record.error
              : lastMessage;
      lastMessage = msg;
      continue;
    }
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const user = record.user && typeof record.user === "object"
      ? (record.user as Record<string, unknown>)
      : null;
    const userId = typeof user?.id === "string" ? user.id : "";
    const verifiedEmail = typeof user?.email === "string" ? user.email.toLowerCase() : email;
    if (!/^[0-9a-f-]{8,64}$/iu.test(userId)) {
      throw new Error("Sessione Supabase incompleta.");
    }
    return { userId: userId.toLowerCase(), email: verifiedEmail };
  }

  throw new Error(lastMessage);
}

type RestMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Cancella l'utente Auth GoTrue (service role). Irreversibile. */
export async function supabaseAdminDeleteUser(userId: string): Promise<void> {
  const config = boardsSupabaseConfig();
  if (!config) throw new Error("Supabase Boards non configurato");
  if (!/^[0-9a-f-]{8,64}$/iu.test(userId)) {
    throw new Error("userId Auth non valido");
  }
  const response = await fetch(
    `${config.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: {
        apikey: config.secretKey,
        Authorization: `Bearer ${config.secretKey}`,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Cancellazione utente Auth non riuscita.");
  }
  await response.body?.cancel().catch(() => undefined);
}

/** PostgREST su schema boards_private (service role). */
export async function boardsRest<T = unknown>(
  pathAndQuery: string,
  init: {
    method?: RestMethod;
    body?: unknown;
    prefer?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; data: T | null }> {
  const config = boardsSupabaseConfig();
  if (!config) throw new Error("Supabase Boards non configurato");
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  const response = await fetch(`${config.url}/rest/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Profile": "boards_private",
      "Content-Profile": "boards_private",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 204) {
    await response.body?.cancel().catch(() => undefined);
    return { status: 204, data: null };
  }
  const data = (await readJson(response)) as T;
  if (!response.ok) {
    throw new Error(`PostgREST boards ${response.status}`);
  }
  return { status: response.status, data };
}
