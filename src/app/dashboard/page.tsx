import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readBoardsSession } from "@/lib/boards/session";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { BoardsHome } from "./boards-home";

export const metadata: Metadata = {
  title: "Le tue board",
  description:
    "Home DVNS Boards: crea, rinomina e categorizza più viste sui dati pubblici ufficiali.",
  robots: { index: false, follow: true },
};

function siteHomeHref(host: string | null): string {
  if (!host || host === "localhost" || host.startsWith("127.") || host.endsWith(".local")) {
    return "/";
  }
  return PUBLIC_SITE_URL;
}

export default async function DashboardPage() {
  const session = await readBoardsSession();
  if (!session) redirect("/accedi");

  const headerStore = await headers();
  const host = (headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "")
    .split(":")[0]
    ?.toLowerCase() ?? null;

  return (
    <BoardsHome
      email={session.email}
      userId={session.userId}
      siteHref={siteHomeHref(host)}
    />
  );
}
