import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSharedBoard, isCloudBoardsEnabled } from "@/lib/boards/cloud-store";
import { SharedBoardView } from "./shared-board-view";

type Props = {
  params: Promise<{ token: string }>;
};

export const metadata: Metadata = {
  title: "Board condivisa",
  description: "Vista sola lettura di una board DVNS sui dati pubblici ufficiali.",
  robots: { index: false, follow: false },
};

export default async function SharedBoardPage({ params }: Props) {
  if (!isCloudBoardsEnabled()) notFound();
  const { token } = await params;
  if (!/^[a-zA-Z0-9_-]{24,64}$/u.test(token)) notFound();

  let board: Awaited<ReturnType<typeof getSharedBoard>> = null;
  try {
    board = await getSharedBoard(token);
  } catch {
    notFound();
  }
  if (!board) notFound();

  return (
    <SharedBoardView
      token={token}
      title={board.meta.title}
      category={board.meta.category}
      updatedAt={board.meta.updatedAt}
      document={board.document}
    />
  );
}
