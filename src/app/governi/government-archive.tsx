import Link from "next/link";
import { getGovernmentScorecardView } from "@/lib/government-scorecard";
import { formatScore } from "./government-scorecard-format";
import styles from "./governi.module.css";

export function GovernmentArchive({ id, selectedGovernmentId }: { id: string; selectedGovernmentId: string }) {
  const data = getGovernmentScorecardView();

  return (
    <details className={styles.explorer} id={id}>
      <summary>
        <span><small>Archivio dei governi</small><strong>Apri la scheda di un altro governo</strong></span>
        <b aria-hidden="true">Apri l’archivio</b>
      </summary>
      <div className={styles.explorerBody}>
        <p className={styles.explorerIntro}>Ogni nome apre la scheda completa del governo. Le barre usano lo stesso paniere; “ND” indica che la finestra annuale non è sufficiente.</p>
        <ol className={styles.governmentBars}>
          {[...data.governments].reverse().map((government) => (
            <li key={government.id} data-current={government.id === selectedGovernmentId || undefined}>
              <div className={styles.governmentBarLabel}>
                <Link href={`/governi/${government.id}`}>{government.name}</Link>
                <span>{government.startDate.slice(0, 4)}-{government.endDate?.slice(0, 4) ?? "oggi"}</span>
              </div>
              {government.calculation.status === "scored" ? (
                <>
                  <span className={styles.governmentBar} aria-hidden="true"><i style={{ width: `${government.calculation.score}%` }} /></span>
                  <strong>{formatScore(government.calculation.score)}</strong>
                  <small>Italia {formatScore(government.calculation.observedScore)} · rispetto ai peer {formatScore(government.calculation.relativeScore)}</small>
                </>
              ) : (
                <><span className={styles.governmentBar} aria-hidden="true" /><strong>ND</strong><small>{government.calculation.reason}</small></>
              )}
            </li>
          ))}
        </ol>
        <details className={styles.inlineDetails}>
          <summary>Vedi anche il contesto economico prima del 1995</summary>
          <div className={styles.timeline}>
            {data.historicalContexts.map((item) => (
              <article key={item.id}>
                <time>{item.startYear}-{item.endYear}</time>
                <div><h3>{item.label}</h3><p>{item.summary}</p><a href={item.sourceUrl} target="_blank" rel="noreferrer">Fonte <span aria-hidden="true">↗</span></a></div>
              </article>
            ))}
          </div>
        </details>
      </div>
    </details>
  );
}
