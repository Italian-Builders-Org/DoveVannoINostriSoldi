import { timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import {
  SOURCE_IDS,
  SOURCE_POLICIES,
  type SourceId,
} from "@/lib/data/source-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_ID_SET = new Set<string>(SOURCE_IDS);
const DEFAULT_REFRESH_SOURCES: readonly SourceId[] = ["ipa", "openbdap", "siope"];

const SOURCE_PATHS: Readonly<Partial<Record<SourceId, readonly string[]>>> = {
  ipa: ["/enti", "/territori"],
  "ipa-struttura": ["/enti"],
  openbdap: ["/stato", "/api/spese/stato", "/api/opere"],
  siope: ["/", "/spese", "/entrate", "/api/entrate/comuni", "/territori"],
  cpt: ["/territori", "/territori/fisco", "/api/territori/fisco"],
  opencoesione: ["/", "/coesione"],
  opencivitas: ["/territori", "/territori/confronto", "/api/spese/comuni/fabbisogni"],
  "partecipazioni-pubbliche": ["/partecipazioni"],
  consulenti: ["/enti"],
  camera: ["/parlamento", "/api/parlamento"],
};

type RefreshBody = {
  sources?: unknown;
};

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorised(request: Request, expectedSecret: string): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  return secureEqual(header.slice("Bearer ".length), expectedSecret);
}

function parseSources(value: unknown): SourceId[] {
  if (value === undefined) return [...DEFAULT_REFRESH_SOURCES];
  if (!Array.isArray(value)) throw new Error("Il campo sources deve essere un array");

  const unique = new Set<SourceId>();
  for (const candidate of value) {
    if (typeof candidate !== "string" || !SOURCE_ID_SET.has(candidate)) {
      throw new Error(`Fonte non valida: ${String(candidate)}`);
    }
    unique.add(candidate as SourceId);
  }

  if (unique.size === 0) throw new Error("Specificare almeno una fonte");
  return [...unique];
}

export async function POST(request: Request) {
  const secret = process.env.SOURCE_REFRESH_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: "Refresh automatico non configurato sul deployment",
      },
      { status: 503 },
    );
  }

  if (!authorised(request, secret)) {
    return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
  }

  let body: RefreshBody = {};
  try {
    const raw = await request.text();
    body = raw ? (JSON.parse(raw) as RefreshBody) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "JSON non valido" }, { status: 400 });
  }

  let sources: SourceId[];
  try {
    sources = parseSources(body.sources);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Richiesta non valida",
      },
      { status: 400 },
    );
  }

  const tags = new Set<string>();
  const paths = new Set<string>();

  for (const sourceId of sources) {
    for (const tag of SOURCE_POLICIES[sourceId].tags) {
      revalidateTag(tag, "max");
      tags.add(tag);
    }

    for (const path of SOURCE_PATHS[sourceId] ?? []) {
      revalidatePath(path, "layout");
      paths.add(path);
    }
  }

  return NextResponse.json({
    ok: true,
    refreshedAt: new Date().toISOString(),
    sources,
    tags: [...tags],
    paths: [...paths],
  });
}
