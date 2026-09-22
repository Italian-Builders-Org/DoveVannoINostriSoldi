import { getRepubblicaThemeVotes, VOTE_THEMES } from "@/lib/politici-voti-tema";
import { findRepublicPerson } from "@/lib/politici-repubblica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const person = findRepublicPerson(id);
  if (!person || (person.chamberId !== "camera" && person.chamberId !== "senato")) {
    return Response.json(
      { ok: false, error: "Voti per tema disponibili solo per deputati e senatori del perimetro pubblicato." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const url = new URL(request.url);
  const themeId = url.searchParams.get("tema");
  const query = url.searchParams.get("q");
  const knownKeys = new Set(["tema", "q"]);
  for (const key of url.searchParams.keys()) {
    if (!knownKeys.has(key) || url.searchParams.getAll(key).length !== 1) {
      return Response.json(
        { ok: false, error: `Parametro sconosciuto o ripetuto: ${key}.` },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
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

  const result = getRepubblicaThemeVotes({
    personId: person.id,
    themeId,
    query,
  });
  if (!result) {
    return Response.json(
      { ok: false, error: "Voti per tema non disponibili per questa persona." },
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
