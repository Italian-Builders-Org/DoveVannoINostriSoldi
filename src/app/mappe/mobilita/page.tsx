import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { ROMA_NETWORK_ASSET } from "@/lib/mobilita/roma-network-asset";
import { MOBILITA_MAP_EXPLORER_PATH } from "@/lib/site";
import { MobilitaSkipLink, MobilitaViewBody, MobilitaViewTabs } from "./mobilita-views";
import styles from "./mobilita.module.css";

export const metadata: Metadata = {
  title: "Mappa della mobilità",
  description:
    "Velocità programmate di bus, tram, metro e treni nelle grandi città italiane e autobus di Roma in tempo reale, dai feed GTFS ufficiali.",
};

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString("it-IT", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Rome",
      });
}

export default function MobilitaMapPage() {
  const gtfsDate = formatDate(ROMA_NETWORK_ASSET.gtfs.lastModified ?? ROMA_NETWORK_ASSET.gtfs.acquiredAt);
  return (
    <main className={styles.immersivePage} data-immersive-page="mobilita">
      <MobilitaSkipLink className={styles.skipLink} />
      <header className={styles.immersiveChrome}>
        <div className={styles.brandLockup}>
          <Link
            className={styles.immersiveBrand}
            href="/"
            aria-label="DoveVannoINostriSoldi, pagina iniziale"
          >
            DVNS
          </Link>
          <span className={styles.brandSeparator} aria-hidden="true" />
          <p className={styles.brandTitle}>Mobilità</p>
        </div>
        <MobilitaViewTabs />
        <div className={styles.immersiveActions}>
          <details className={styles.sourcesDisclosure}>
            <summary>Fonti</summary>
            <div className={styles.sourcesPanel}>
              <h2>Cosa misura questa mappa</h2>
              <h3>Velocità programmate</h3>
              <p>
                Minuti programmati per chilometro tra fermate consecutive, calcolati dagli orari
                GTFS ufficiali. Non sono ritardi osservati, traffico o sprechi: solo la velocità
                di corsa prevista dal servizio.
              </p>
              <p>
                Ogni rete elenca titolare, data di servizio, licenza e hash del file acquisito.
                Geometrie mancanti nel GTFS possono essere ricostruite da OpenStreetMap solo dove
                il registro lo consente.
              </p>
              <h3>Bus Roma in tempo reale</h3>
              <p>
                Posizioni dal feed GTFS-Realtime «VehiclePositions» di{" "}
                <a href="https://romamobilita.it/sistemi-e-tecnologie/open-data/" rel="noopener">
                  Roma Servizi per la Mobilità
                </a>
                , trasmesse dai sistemi AVM degli autobus ATAC e Roma TPL. Le rileggiamo al massimo
                ogni 15 secondi e non le conserviamo. Tram e metro non sono nel feed.
              </p>
              <p>
                Linee, percorsi e fermate dal GTFS statico dello stesso titolare
                {gtfsDate ? ` (file del ${gtfsDate})` : ""}, SHA-256{" "}
                <code>{ROMA_NETWORK_ASSET.gtfs.sha256.slice(0, 12)}</code>. Le posizioni aiutano
                il viaggio, non misurano la puntualità: possono arrivare in ritardo o mancare.
              </p>
              <p>Cartografia live © OpenStreetMap, tile OpenFreeMap.</p>
            </div>
          </details>
          <ThemeToggle />
          <Link className={`${styles.immersiveHomeLink} ${styles.hideOnPhone}`} href="/#maps-title" scroll>
            Mappe
          </Link>
          <Link
            className={styles.immersiveHomeLink}
            href="/"
            aria-label="Torna al sito DoveVannoINostriSoldi"
          >
            <span className={styles.homeLinkLabel}>Torna al sito</span>
          </Link>
        </div>
      </header>
      <MobilitaViewBody explorerSrc={MOBILITA_MAP_EXPLORER_PATH} />
    </main>
  );
}
