import { getThemeVoteHistory, VOTE_THEMES } from "@/lib/politici-voti-tema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const themeId = url.searchParams.get("tema");
  const query = url.searchParams.get("q");
  const personQuery = url.searchParams.get("persona");
  const ramo = url.searchParams.get("ramo");
  const espressi = url.searchParams.get("espressi");
  const knownKeys = new Set(["tema", "q", "persona", "ramo", "espressi"]);
  for (const key of url.searchParams.keys()) {
    if (!knownKeys.has(key) || url.searchParams.getAll(key).length !== 1) {
      return Response.json(
        { ok: false, error: `Parametro sconosciuto o ripetuto: ${key}.` },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  if (themeId === null && (query === null || query.trim().length === 0)) {
    return Response.json(
      { ok: false, error: "Indica un tema oppure una ricerca libera di almeno 3 caratteri." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (themeId !== null && !VOTE_THEMES.some((theme) => theme.id === themeId)) {
    return Response.json(
      { ok: false, error: "Tema non riconosciuto." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (query !== null && query.trim().length > 0 && query.trim().length < 3) {
    return Response.json(
      { ok: false, error: "La ricerca libera richiede almeno 3 caratteri." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (query !== null && query.length > 120) {
    return Response.json(
      { ok: false, error: "La ricerca libera può avere al massimo 120 caratteri." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (personQuery !== null && personQuery.length > 120) {
    return Response.json(
      { ok: false, error: "La ricerca persona può avere al massimo 120 caratteri." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (ramo !== null && ramo !== "camera" && ramo !== "senato") {
    return Response.json(
      { ok: false, error: "Il filtro ramo accetta solo camera o senato." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (espressi !== null && espressi !== "0" && espressi !== "1") {
    return Response.json(
      { ok: false, error: "Il parametro espressi accetta solo 0 o 1." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = getThemeVoteHistory({
    themeId,
    query,
    personQuery,
    chamber: ramo === "camera" || ramo === "senato" ? ramo : "tutti",
    expressedOnly: espressi === null ? null : espressi === "1",
  });
  if (!result) {
    return Response.json(
      { ok: false, error: "Storico voti per tema non disponibile." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { ok: true, ...result },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
