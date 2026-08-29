import { GOVERNMENT_CITIZEN_INDICATORS, GOVERNMENT_CONTEXT_GUARDRAILS } from "@/lib/government-citizen-model";
import styles from "./governi.module.css";

export function CitizenScoreModel() {
  const scored = GOVERNMENT_CITIZEN_INDICATORS.filter((indicator) => indicator.role === "score");
  const diagnostics = GOVERNMENT_CITIZEN_INDICATORS.filter((indicator) => indicator.role === "diagnostic");

  return (
    <section className={`panel ${styles.section}`} aria-labelledby="paniere-cittadino">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>Il voto che dobbiamo costruire</span>
          <h2 id="paniere-cittadino">Dieci dati che parlano alla vita del cittadino</h2>
        </div>
        <p>Sette risultati possono entrare nel voto moderno; tre restano diagnostici finché copertura e ritardi non consentono confronti equi fra governi.</p>
      </div>

      <div className={styles.citizenModelGrid}>
        <div>
          <h3>Nel voto di benessere</h3>
          <ol className={styles.citizenIndicators}>
            {scored.map((indicator, index) => (
              <li key={indicator.id}>
                <span>{index + 1} · {indicator.area}</span>
                <strong>{indicator.label}</strong>
                <p>{indicator.question}</p>
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
        Questi dieci dati <strong>non sono ancora nel numero mostrato sotto</strong>. Il Core attuale resta pubblicato come prototipo macro separato finché il nuovo paniere non supera audit, copertura e test di robustezza.
      </p>
    </section>
  );
}
