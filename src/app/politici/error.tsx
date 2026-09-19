"use client";

import styles from "./politici.module.css";

export default function PoliticiError({ reset }: { error: Error & { digest?: string; }; reset: () => void; }) {
  return <div className={styles.immersivePage}>
    <div className={styles.routeStatus} role="alert">
      <span className={styles.eyebrow}>Atlante della politica</span>
      <h1>La mappa non è disponibile.</h1>
      <p>Non siamo riusciti a caricare i dati. Non mostriamo valori vuoti al posto di quelli mancanti.</p>
      <button type="button" className={styles.primaryButton} onClick={reset}>Riprova</button>
      <a className={styles.textButton} href="https://www.dovevannoinostrisoldi.com/">Torna al sito</a>
    </div>
  </div>;
}
