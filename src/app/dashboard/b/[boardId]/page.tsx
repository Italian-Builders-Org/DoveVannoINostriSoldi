import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildBoardTileCatalog } from "@/lib/boards/build-tile-catalog";
import { readBoardsSession } from "@/lib/boards/session";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { BoardStudio } from "../../board-studio";

type Props = {
  params: Promise<{ boardId: string }>;
};

export const metadata: Metadata = {
  title: "Board",
  description: "Composer DVNS Boards su una board personale.",
  robots: { index: false, follow: true },
};

function siteHomeHref(host: string | null): string {
  if (!host || host === "localhost" || host.startsWith("127.") || host.endsWith(".local")) {
    return "/";
  }
  return PUBLIC_SITE_URL;
}

export default async function BoardEditorPage({ params }: Props) {
  const session = await readBoardsSession();
  if (!session) redirect("/accedi");

  const { boardId } = await params;
  if (!/^board_[a-z0-9_]+$/u.test(boardId)) {
    redirect("/dashboard");
  }

  const headerStore = await headers();
  const host = (headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "")
    .split(":")[0]
    ?.toLowerCase() ?? null;

  return (
    <BoardStudio
      userId={session.userId}
      boardId={boardId}
      siteHref={siteHomeHref(host)}
      catalog={buildBoardTileCatalog()}
    />
  );
}
