import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { boardsAuthMode } from "@/lib/boards/auth-mode";
import { readBoardsSession } from "@/lib/boards/session";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccediForm } from "./accedi-form";
import styles from "./accedi.module.css";

export const metadata: Metadata = {
  title: "Accedi alla dashboard",
  description:
    "DVNS Boards: lavagna personale sui dataset pubblici del sito. Editor disponibile solo da web desktop.",
};

function siteHomeHref(host: string | null): string {
  if (!host || host === "localhost" || host.startsWith("127.") || host.endsWith(".local")) {
    return "/";
  }
  return PUBLIC_SITE_URL;
}

export default async function AccediPage() {
  const session = await readBoardsSession();
  if (session) redirect("/dashboard");

  const mode = boardsAuthMode();
  const headerStore = await headers();
  const host = (headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "")
    .split(":")[0]
    ?.toLowerCase() ?? null;
  const home = siteHomeHref(host);

  return (
    <main className={styles.immersive} data-immersive-page="boards" data-testid="accedi-page">
      <div className={styles.heroBleed} aria-hidden="true" />

      <header className={styles.chrome}>
        <a className={styles.siteLink} href={home}>
          ← Torna al sito
        </a>
        <div className={styles.chromeRight}>
          <ThemeToggle />
          <strong className={styles.product}>
            <Image
              className={styles.mark}
              src="/brand/dvns-mark-transparent.png"
              alt=""
              width={22}
              height={22}
            />
            DVNS Boards
          </strong>
        </div>
      </header>

      <div className={styles.stage}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>DVNS Boards</p>
          <h1>Componi le tue viste sui dati pubblici</h1>
          <p>
            Boards è la lavagna personale di DVNS: affianchi grafici, tabelle e KPI dai
            dataset ufficiali del sito, con filtri e note tue.
          </p>
          <ul className={styles.featureList}>
            <li>Più board private, rinominabili e categorizzabili</li>
            <li>Tile sui dataset del sito (spesa, appalti, territori…)</li>
            <li>Link in sola lettura per condividere una lettura</li>
          </ul>
          <p className={styles.webOnly} role="note">
            <strong>Utilizzabile solo da web (computer o laptop).</strong> L&apos;editor
            delle board non è supportato su smartphone o tablet: per creare e modificare
            le viste apri questa pagina da un browser desktop.
          </p>
        </div>

        {mode === "unavailable" ? (
          <div className={styles.alert} role="alert">
            <strong>Accesso non disponibile</strong>
            <p>
              Su questo ambiente manca la configurazione Auth (Supabase Boards o secret di
              anteprima locale).
            </p>
          </div>
        ) : (
          <>
            {mode === "local_preview" ? (
              <div className={styles.alert}>
                <strong>Anteprima locale</strong>
                <p>
                  Senza Supabase il link non parte: dopo &quot;Invia link di accesso&quot; compare
                  un codice a sei cifre in pagina.
                </p>
              </div>
            ) : null}
            <AccediForm />
          </>
        )}

        <p className={styles.footerLinks}>
          <Link href={home}>Sito DVNS</Link>
          {" · "}
          <Link href="/privacy">Privacy</Link>
        </p>
      </div>
    </main>
  );
}
