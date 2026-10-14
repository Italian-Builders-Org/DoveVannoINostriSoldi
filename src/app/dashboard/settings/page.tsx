import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readBoardsSession } from "@/lib/boards/session";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { DeleteAccountPanel } from "./delete-account-panel";
import { SettingsPanel } from "./settings-panel";
import styles from "../settings.module.css";

export const metadata: Metadata = {
  title: "Impostazioni account",
  description: "Cambia email o elimina l'account DVNS Boards.",
  robots: { index: false, follow: true },
};

function siteHomeHref(host: string | null): string {
  if (!host || host === "localhost" || host.startsWith("127.") || host.endsWith(".local")) {
    return "/";
  }
  return PUBLIC_SITE_URL;
}

export default async function DashboardSettingsPage() {
  const session = await readBoardsSession();
  if (!session) redirect("/accedi?next=/dashboard/settings");

  const headerStore = await headers();
  const host = (headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "")
    .split(":")[0]
    ?.toLowerCase() ?? null;

  return (
    <main className={styles.page} data-immersive-page="boards" data-testid="boards-settings">
      <header className={styles.chrome}>
        <a className={styles.siteLink} href={siteHomeHref(host)}>
          ← Torna al sito
        </a>
        <nav className={styles.nav}>
          <a href="/dashboard">Dashboard</a>
          <strong>Impostazioni</strong>
        </nav>
      </header>
      <div className={styles.stage}>
        <h1>Impostazioni</h1>
        <p className={styles.lead}>
          Account <strong>{session.email}</strong>. Puoi aggiornare l&apos;email o eliminare
          l&apos;account e le board salvate. Dettagli in{" "}
          <a href="/privacy">Privacy</a>.
        </p>
        <SettingsPanel currentEmail={session.email} />
        <DeleteAccountPanel email={session.email} />
      </div>
    </main>
  );
}
