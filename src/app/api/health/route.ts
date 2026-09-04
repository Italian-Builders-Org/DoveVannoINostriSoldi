const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

const COMMIT_SHA = /^[0-9a-f]{40}$/iu;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 5;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function deployedRevision(): string | null {
  if (process.env.VERCEL !== "1") return "unknown";

  const revision = process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? "";
  return COMMIT_SHA.test(revision) ? revision.toLowerCase() : null;
}

export function GET(): Response {
  const revision = deployedRevision();
  if (revision === null) {
    return json({ ok: false, error: "revision_unavailable" }, 503);
  }

  return json({
    ok: true,
    service: "dvns-web",
    revision,
  });
}
