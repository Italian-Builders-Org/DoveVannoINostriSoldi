import { jsonResponse, readBoundedBody, rejectPublicPost } from "@/lib/http/public-post-guard";
import {
  buildIssueDraft,
  githubComposerUrl,
  parseReportRequest,
  REPORT_LIMITS,
  timingRejection,
  type IssueDraft,
  type ReportResponse,
} from "@/lib/report/contract";
import {
  GitHubUnavailableError,
  hashedLimiterKey,
  readGitHubAppConfig,
  ReportGitHubClient,
  type GitHubAppConfig,
  type GitHubIssueRef,
} from "@/lib/report/github";
import { clientAddress, SlidingWindowLimiter } from "@/lib/report/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const GUARD = { maxRequestBytes: REPORT_LIMITS.requestBytesMax } as const;
const TEN_MINUTES = 10 * 60 * 1_000;
const DUPLICATE_LOOKBACK_MS = 24 * 60 * 60 * 1_000;
const RECENT_ISSUES_MAX = 500;

// Per warm instance: a person rarely files more than a few reports in a row,
// and the whole site should not push GitHub harder than this even under load.
const perAddress = new SlidingWindowLimiter({ windowMs: TEN_MINUTES, max: 3 });
const perInstance = new SlidingWindowLimiter({ windowMs: TEN_MINUTES, max: 30 });

// Idempotency memory for the fast path (double click, immediate retry). The
// durable check is the marker lookup on GitHub itself.
const recentIssues = new Map<string, GitHubIssueRef>();

let cachedClient: { config: GitHubAppConfig; client: ReportGitHubClient } | null = null;

function githubClient(): ReportGitHubClient | null {
  const config = readGitHubAppConfig();
  if (!config) return null;
  const same = cachedClient &&
    cachedClient.config.appId === config.appId &&
    cachedClient.config.installationId === config.installationId &&
    cachedClient.config.privateKeyPem === config.privateKeyPem;
  if (!same) {
    cachedClient = {
      config,
      client: new ReportGitHubClient(config, {
        // Resolved per call so a test double installed on globalThis is honoured.
        fetch: (input, init) => globalThis.fetch(input, init),
      }),
    };
  }
  return cachedClient!.client;
}

function remember(clientKey: string, issue: GitHubIssueRef): void {
  recentIssues.set(clientKey, issue);
  if (recentIssues.size > RECENT_ISSUES_MAX) {
    const oldest = recentIssues.keys().next().value;
    if (oldest !== undefined) recentIssues.delete(oldest);
  }
}

function failure(
  status: number,
  code: Extract<ReportResponse, { ok: false }>["code"],
  message: string,
  draft?: IssueDraft,
  headers?: HeadersInit,
): Response {
  const body: ReportResponse = draft
    ? { ok: false, code, message, fallbackUrl: githubComposerUrl(draft) }
    : { ok: false, code, message };
  return jsonResponse(body, status, headers);
}

export async function POST(request: Request) {
  const rejected = rejectPublicPost(request, GUARD);
  if (rejected) return rejected;

  let rawBody: string | Response;
  try {
    rawBody = await readBoundedBody(request, GUARD);
  } catch {
    return jsonResponse({ ok: false, error: "Richiesta interrotta o non leggibile" }, 400);
  }
  if (rawBody instanceof Response) return rawBody;

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return failure(400, "invalid_request", "Richiesta JSON non valida");
  }

  const parsed = parseReportRequest(payload);
  if (!parsed.ok) return failure(400, "invalid_request", parsed.message);
  const report = parsed.value;

  const now = Date.now();
  const timing = timingRejection(report.context, now);
  if (timing) return failure(400, "invalid_request", timing);

  const draft = buildIssueDraft(report);

  const address = clientAddress(request);
  const addressAllowed = address ? perAddress.consume(hashedLimiterKey(address), now) : true;
  if (!addressAllowed || !perInstance.consume("instance", now)) {
    return failure(
      429,
      "rate_limited",
      "Troppe segnalazioni in poco tempo. Riprova più tardi oppure usa il modulo GitHub.",
      draft,
      { "retry-after": "600" },
    );
  }

  const client = githubClient();
  if (!client) {
    return failure(
      503,
      "unavailable",
      "L’invio automatico non è configurato su questo ambiente. Puoi aprire la segnalazione su GitHub con i dati già compilati.",
      draft,
    );
  }

  const remembered = recentIssues.get(report.clientKey);
  if (remembered) {
    const body: ReportResponse = { ok: true, issue: remembered, duplicate: true };
    return jsonResponse(body, 200);
  }

  try {
    const existing = await client.findIssueByKey(report.clientKey, now - DUPLICATE_LOOKBACK_MS);
    if (existing) {
      remember(report.clientKey, existing);
      const body: ReportResponse = { ok: true, issue: existing, duplicate: true };
      return jsonResponse(body, 200);
    }
    const issue = await client.createIssue(draft);
    remember(report.clientKey, issue);
    const body: ReportResponse = { ok: true, issue, duplicate: false };
    return jsonResponse(body, 201);
  } catch (error) {
    // Only the failure class and the upstream status are logged: never the report.
    const status = error instanceof GitHubUnavailableError ? error.status : null;
    console.error(`[segnalazioni] GitHub non disponibile${status ? ` (HTTP ${status})` : ""}`);
    return failure(
      503,
      "unavailable",
      "GitHub non ha risposto. La segnalazione non è andata persa: puoi inviarla dal modulo GitHub precompilato o riprovare fra poco.",
      draft,
    );
  }
}
