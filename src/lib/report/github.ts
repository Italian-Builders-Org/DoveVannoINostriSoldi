import "server-only";
import { createHash, createSign } from "node:crypto";
import { REPO_URL } from "@/lib/site";
import { REPORT_ISSUE_LABEL, REPORT_KEY_MARKER, type IssueDraft } from "@/lib/report/contract";

/**
 * Minimal GitHub App client for the report endpoint.
 *
 * The App must be installed on the repository with the single permission
 * `issues: write`. The installation token is requested with that permission
 * and that repository only, so even a leaked token cannot reach anything else.
 * No SDK: two REST calls, a JWT signed with node:crypto, and explicit timeouts.
 */

const GITHUB_API = "https://api.github.com";
const REPO_PATH = new URL(REPO_URL).pathname.replace(/^\/+|\/+$/gu, "");
const TOKEN_SAFETY_MARGIN_MS = 60_000;

export type GitHubIssueRef = Readonly<{ number: number; url: string }>;

export type GitHubAppConfig = Readonly<{
  appId: string;
  installationId: string;
  privateKeyPem: string;
}>;

export type ReportGitHubOptions = Readonly<{
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}>;

export class GitHubUnavailableError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "GitHubUnavailableError";
    this.status = status;
  }
}

export function readGitHubAppConfig(env: NodeJS.ProcessEnv = process.env): GitHubAppConfig | null {
  const appId = env.REPORT_GITHUB_APP_ID?.trim();
  const installationId = env.REPORT_GITHUB_INSTALLATION_ID?.trim();
  const rawKey = env.REPORT_GITHUB_APP_PRIVATE_KEY?.trim();
  if (!appId || !installationId || !rawKey) return null;
  if (!/^\d+$/u.test(appId) || !/^\d+$/u.test(installationId)) return null;
  // Vercel stores multi-line secrets either verbatim or with escaped newlines.
  const privateKeyPem = `${(rawKey.includes("\\n") ? rawKey.replace(/\\n/gu, "\n") : rawKey).trim()}\n`;
  if (!/^-----BEGIN [A-Z ]*PRIVATE KEY-----\n[\s\S]+\n-----END [A-Z ]*PRIVATE KEY-----\n$/u.test(privateKeyPem)) return null;
  return { appId, installationId, privateKeyPem };
}

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

/** RS256 JWT authenticating the App itself (not an installation). */
export function signAppJwt(config: GitHubAppConfig, nowMs: number): string {
  const nowSeconds = Math.floor(nowMs / 1_000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iat: nowSeconds - 30,
    exp: nowSeconds + 5 * 60,
    iss: config.appId,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(config.privateKeyPem);
  return `${header}.${payload}.${base64Url(signature)}`;
}

type InstallationToken = Readonly<{ token: string; expiresAt: number }>;

/** Structural check on GitHub responses: we never trust the shape blindly. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ReportGitHubClient {
  readonly #config: GitHubAppConfig;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #now: () => number;
  #token: InstallationToken | null = null;

  constructor(config: GitHubAppConfig, options: ReportGitHubOptions = {}) {
    this.#config = config;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 8_000;
    this.#now = options.now ?? Date.now;
  }

  async #request(path: string, init: RequestInit & { auth: string }): Promise<Response> {
    const { auth, ...rest } = init;
    let response: Response;
    try {
      response = await this.#fetch(`${GITHUB_API}${path}`, {
        ...rest,
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "DoveVannoINostriSoldi-segnalazioni",
          authorization: auth,
          ...(rest.body ? { "content-type": "application/json" } : {}),
        },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new GitHubUnavailableError("GitHub non raggiungibile");
    }
    return response;
  }

  async #installationToken(): Promise<string> {
    const now = this.#now();
    if (this.#token && this.#token.expiresAt - TOKEN_SAFETY_MARGIN_MS > now) return this.#token.token;

    const response = await this.#request(
      `/app/installations/${this.#config.installationId}/access_tokens`,
      {
        method: "POST",
        auth: `Bearer ${signAppJwt(this.#config, now)}`,
        body: JSON.stringify({
          repositories: [REPO_PATH.split("/")[1]],
          permissions: { issues: "write" },
        }),
      },
    );
    if (!response.ok) {
      throw new GitHubUnavailableError("Autenticazione GitHub App rifiutata", response.status);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload) || typeof payload.token !== "string" || typeof payload.expires_at !== "string") {
      throw new GitHubUnavailableError("Risposta token GitHub inattesa");
    }
    const expiresAt = Date.parse(payload.expires_at);
    this.#token = { token: payload.token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : now };
    return payload.token;
  }

  /**
   * Looks for an issue already created for this client key. GitHub's list
   * endpoint (unlike search) is strongly consistent, so a retry seconds after
   * a timed-out first attempt finds the issue the first attempt created.
   */
  async findIssueByKey(clientKey: string, sinceMs: number): Promise<GitHubIssueRef | null> {
    const token = await this.#installationToken();
    const since = new Date(sinceMs).toISOString();
    const query = new URLSearchParams({
      labels: REPORT_ISSUE_LABEL,
      state: "all",
      since,
      sort: "created",
      direction: "desc",
      per_page: "50",
    });
    const response = await this.#request(`/repos/${REPO_PATH}/issues?${query}`, {
      method: "GET",
      auth: `Bearer ${token}`,
    });
    if (!response.ok) throw new GitHubUnavailableError("Lettura issue GitHub fallita", response.status);
    const payload: unknown = await response.json().catch(() => null);
    if (!Array.isArray(payload)) throw new GitHubUnavailableError("Risposta issue GitHub inattesa");
    const marker = `<!-- ${REPORT_KEY_MARKER}: ${clientKey} -->`;
    for (const item of payload) {
      if (!isRecord(item) || typeof item.body !== "string") continue;
      if (item.body.startsWith(marker) && typeof item.number === "number" && typeof item.html_url === "string") {
        return { number: item.number, url: item.html_url };
      }
    }
    return null;
  }

  async createIssue(draft: IssueDraft): Promise<GitHubIssueRef> {
    const token = await this.#installationToken();
    const response = await this.#request(`/repos/${REPO_PATH}/issues`, {
      method: "POST",
      auth: `Bearer ${token}`,
      body: JSON.stringify({ title: draft.title, body: draft.body, labels: [...draft.labels] }),
    });
    if (!response.ok) throw new GitHubUnavailableError("Creazione issue GitHub fallita", response.status);
    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload) || typeof payload.number !== "number" || typeof payload.html_url !== "string") {
      throw new GitHubUnavailableError("Risposta creazione issue inattesa");
    }
    if (!payload.html_url.startsWith(`${REPO_URL}/issues/`)) {
      throw new GitHubUnavailableError("URL issue fuori dal repository atteso");
    }
    return { number: payload.number, url: payload.html_url };
  }
}

/** Stable, non-reversible key for the per-address limiter. */
export function hashedLimiterKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
