import { symbolResponse } from "@/lib/politici-symbol-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 8;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return symbolResponse(id, request.signal);
}
