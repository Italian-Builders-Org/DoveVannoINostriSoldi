import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { MOBILITA_MAP_EXPLORER_PATH } from "@/lib/site";
import styles from "./mobilita.module.css";

export const metadata: Metadata = {
  title: "Mappa della mobilità",
  description:
    "Velocità programmate di bus, tram, metro e treni nelle grandi città italiane, dai feed GTFS ufficiali.",
};

export default function MobilitaMapPage() {
  return (
    <main className={styles.immersivePage} data-immersive-page="mobilita">
      <a className={styles.skipLink} href="#mobilita-viewer">
        Vai alla mappa
      </a>
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
        <div className={styles.immersiveActions}>
          <details className={styles.sourcesDisclosure}>
            <summary>Fonti</summary>
            <div className={styles.sourcesPanel}>
              <h2>Cosa misura questa mappa</h2>
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
            </div>
          </details>
          <ThemeToggle />
          <Link className={styles.immersiveHomeLink} href="/#maps-title" scroll>
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
      <iframe
        id="mobilita-viewer"
        className={styles.viewerFrame}
        title="Esplora velocità programmate GTFS per città e rete"
        src={MOBILITA_MAP_EXPLORER_PATH}
      />
    </main>
  );
}
