export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff",
};

function challengeToken(): string | null {
  const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN?.trim();
  if (!token || token.length > 1_024 || /[\u0000-\u001f\u007f]/.test(token)) return null;
  return token;
}

export function GET() {
  const token = challengeToken();
  if (!token) return new Response("Not found", { status: 404, headers: NO_STORE_HEADERS });
  return new Response(token, { status: 200, headers: NO_STORE_HEADERS });
}
