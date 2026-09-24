import {
  findRepublicPerson,
  getRepubblicaGraph,
  getRepubblicaLegislativeActs,
  getRepubblicaLegislativeSources,
} from "@/lib/politici-repubblica";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const person = findRepublicPerson(id);
  const acts = person ? getRepubblicaLegislativeActs(person.id) : null;
  if (!person || !acts) {
    return Response.json(
      { ok: false, error: "Atti legislativi non disponibili per questa persona." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const graph = getRepubblicaGraph();
  const sources = getRepubblicaLegislativeSources();
  return Response.json(
    {
      ok: true,
      personId: person.id,
      legislature: graph.legislature,
      updatedAt: graph.updatedAt,
      source: person.chamberId === "senato" ? sources.senato : sources.camera,
      firstSigned: acts.firstSigned,
      coSigned: acts.coSigned,
      voted: acts.voted,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
