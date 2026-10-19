import { getDocumentiDeclassificati, listDocumentiDeclassificati } from "@/lib/documenti-declassificati";

export const runtime = "nodejs";
export const dynamic = "force-static";

/**
 * Curated declassified-document pilot: list + optional filters.
 * Official portals remain authoritative; this returns verified cards only.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const theme = url.searchParams.get("tema") ?? undefined;
  const issuingBody = url.searchParams.get("ente") ?? undefined;
  const accessStatus = url.searchParams.get("accesso") ?? undefined;
  const snapshot = getDocumentiDeclassificati();
  const documents = listDocumentiDeclassificati({ theme, issuingBody, accessStatus });

  return Response.json(
    {
      ok: true,
      dataset: snapshot.dataset,
      coverage: snapshot.coverage,
      source: snapshot.source,
      semantics: snapshot.semantics,
      caveats: snapshot.caveats,
      documents,
    },
    {
      headers: {
        "cache-control": "public, max-age=300, stale-while-revalidate=86400",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
