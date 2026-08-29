import { GOVERNMENT_CITIZEN_INDICATORS, GOVERNMENT_CONTEXT_GUARDRAILS } from "@/lib/government-citizen-model";
import styles from "./governi.module.css";

export function CitizenScoreModel() {
  const scored = GOVERNMENT_CITIZEN_INDICATORS.filter((indicator) => indicator.role === "score");
  const diagnostics = GOVERNMENT_CITIZEN_INDICATORS.filter((indicator) => indicator.role === "diagnostic");

  return (
    <section className={`panel ${styles.section}`} aria-labelledby="paniere-cittadino">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>Il voto che stiamo costruendo</span>
          <h2 id="paniere-cittadino">Dieci dati utili, con ruoli diversi</h2>
        </div>
        <p>{scored.length} possono entrare nel risultato del cittadino; {diagnostics.length} restano diagnostici perché non hanno causalità, copertura o verso abbastanza solidi.</p>
      </div>

      <div className={styles.citizenModelGrid}>
        <div>
          <h3>Candidati al voto di benessere</h3>
          <ol className={styles.citizenIndicators}>
            {scored.map((indicator, index) => (
              <li key={indicator.id}>
                <span>{index + 1} · {indicator.area}</span>
                <strong>{indicator.label}</strong>
                <p>{indicator.question}</p>
                <small className={styles.exclusionReason}><b>Perché è fuori oggi:</b> {indicator.exclusionReason}</small>
                <a href={indicator.sourceUrl} target="_blank" rel="noreferrer">{indicator.source} <span aria-hidden="true">↗</span></a>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3>Da valutare, senza forzare il voto</h3>
          <ol className={styles.citizenIndicators} start={scored.length + 1}>
            {diagnostics.map((indicator, index) => (
              <li key={indicator.id}>
                <span>{scored.length + index + 1} · {indicator.area} · diagnostico</span>
                <strong>{indicator.label}</strong>
                <p>{indicator.question}</p>
                <small className={styles.exclusionReason}><b>Perché resta diagnostico:</b> {indicator.exclusionReason}</small>
                <a href={indicator.sourceUrl} target="_blank" rel="noreferrer">{indicator.source} <span aria-hidden="true">↗</span></a>
              </li>
            ))}
          </ol>
          <div className={styles.guardrails}>
            <h4>Contesto e sostenibilità, sempre visibili</h4>
            <ul>{GOVERNMENT_CONTEXT_GUARDRAILS.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </div>
      </div>

      <p className={styles.causalBoundary}>
        Il numero attuale usa ancora soltanto i sei indicatori macro del Core. Un dato entrerà nel nuovo paniere solo con una serie confrontabile tra governi, una regola contro il doppio conteggio e test pubblici su pesi, revisioni e shock eccezionali.
      </p>
    </section>
  );
}
