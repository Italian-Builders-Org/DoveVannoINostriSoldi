import styles from "./politici.module.css";

export default function LoadingPolitici() {
  return <div className={styles.immersivePage}>
    <div className={styles.routeStatus} role="status" aria-live="polite">
      <span className={styles.eyebrow}>DoveVannoINostriSoldi</span>
      <h1>Caricamento dell’atlante…</h1>
      <p>Stiamo preparando persone, istituzioni e fonti.</p>
      <div className={styles.loadingLines} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  </div>;
}
