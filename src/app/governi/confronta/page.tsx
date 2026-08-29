import type { Metadata } from "next";
import Link from "next/link";
import { getGovernmentScorecardView } from "@/lib/government-scorecard";
import {
  formatScore,
  rawChangeLabel,
} from "../government-scorecard-format";
import styles from "./confronta.module.css";

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: "Confronta due governi italiani",
  description: "Scegli due governi e confronta andamento economico, risultati per area, indicatori e affidabilità della pagella.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function GovernmentComparisonPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = getGovernmentScorecardView();
  const candidates = data.governments.filter((government) => government.calculation.status === "scored");
  const current = candidates.find((government) => government.status === "current") ?? candidates.at(-1)!;
  const historicalBest = candidates.find((government) => government.rank === 1) ?? candidates[0]!;

  const requestedLeft = candidates.find((government) => government.id === first(params.x));
  const requestedRight = candidates.find((government) => government.id === first(params.y));
  const left = requestedLeft ?? current;
  const rightFallback = historicalBest.id === left.id
    ? candidates.find((government) => government.id !== left.id)!
    : historicalBest;
  const right = requestedRight && requestedRight.id !== left.id ? requestedRight : rightFallback;

  if (left.calculation.status !== "scored" || right.calculation.status !== "scored") return null;

  const leftCalculation = left.calculation;
  const rightCalculation = right.calculation;
  const scoreDifference = leftCalculation.score - rightCalculation.score;
  const winner = Math.abs(scoreDifference) < 0.1 ? null : scoreDifference > 0 ? left : right;
  const loser = winner?.id === left.id ? right : left;
  const winnerCalculation = winner?.calculation.status === "scored" ? winner.calculation : null;
  const loserCalculation = loser.calculation.status === "scored" ? loser.calculation : null;
  const categoryComparisons = leftCalculation.categories.map((category) => {
    const other = rightCalculation.categories.find((item) => item.id === category.id)!;
    return { label: category.label, left: category.score, right: other.score, difference: category.score - other.score };
  });
  const decisiveCategories = winnerCalculation && loserCalculation
    ? winnerCalculation.categories.map((category) => {
      const other = loserCalculation.categories.find((item) => item.id === category.id)!;
      return { label: category.label, difference: category.score - other.score };
      }).filter((category) => category.difference > 0).sort((a, b) => b.difference - a.difference).slice(0, 3)
    : [];

  return (
    <main className="shell page">
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/governi">Pagella dei governi</Link>
        <span aria-hidden="true">/</span>
        <span>Confronta due governi</span>
      </nav>

      <header className={`page-intro ${styles.intro}`}>
        <span className={styles.kicker}>Confronto diretto</span>
        <h1>Scegli due governi</h1>
        <p>Stessa formula e stessi indicatori. Il confronto misura ciò che è cambiato nei rispettivi periodi, tenendo separata l’attribuzione politica.</p>
      </header>

      <form className={styles.selector} action="/governi/confronta" method="get">
        <label>
          <span>Governo X</span>
          <select name="x" defaultValue={left.id}>
            {candidates.map((government) => (
              <option value={government.id} key={government.id}>{government.name} · {government.startDate.slice(0, 4)}-{government.endDate?.slice(0, 4) ?? "oggi"}</option>
            ))}
          </select>
        </label>
        <span className={styles.versus} aria-hidden="true">VS</span>
        <label>
          <span>Governo Y</span>
          <select name="y" defaultValue={right.id}>
            {candidates.map((government) => (
              <option value={government.id} key={government.id}>{government.name} · {government.startDate.slice(0, 4)}-{government.endDate?.slice(0, 4) ?? "oggi"}</option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" type="submit">Confronta</button>
      </form>

      <section className={styles.verdict} aria-labelledby="esito-confronto">
        <div>
          <span>Esito del Core macro</span>
          <h2 id="esito-confronto">{winner ? `${winner.name} ha il risultato più alto` : "I due risultati sono equivalenti"}</h2>
          <p>
            {winner && winnerCalculation && loserCalculation
              ? `${formatScore(winnerCalculation.score)} contro ${formatScore(loserCalculation.score)}: ${formatScore(Math.abs(winnerCalculation.score - loserCalculation.score))} punti di differenza.`
              : "La differenza è inferiore a un decimo di punto."}
          </p>
        </div>
        {winner && decisiveCategories.length > 0 && (
          <div className={styles.whyWinner}>
            <strong>Perché è davanti</strong>
            <ul>
              {decisiveCategories.map((category) => (
                <li key={category.label}>
                  <span>{category.label}</span>
                  <b>{category.difference >= 0 ? "+" : ""}{formatScore(category.difference)} pt</b>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className={styles.scoreCards} aria-label="Risultati dei due governi">
        {[left, right].map((government) => {
          if (government.calculation.status !== "scored") return null;
          const isWinner = winner?.id === government.id;
          const strongest = [...government.calculation.indicators].sort((a, b) => b.contributionPoints - a.contributionPoints)[0]!;
          const weakest = [...government.calculation.indicators].sort((a, b) => a.contributionPoints - b.contributionPoints)[0]!;
          return (
            <article key={government.id} data-winner={isWinner || undefined}>
              <div className={styles.cardHeading}>
                <div><span>{isWinner ? "Risultato più alto" : government.status === "current" ? "In carica · provvisorio" : `Posizione ${government.rank}`}</span><h2>{government.name}</h2></div>
                <strong>{formatScore(government.calculation.score)}<small>/100</small></strong>
              </div>
              <dl>
                <div><dt>Periodo misurato</dt><dd>{government.calculation.baselineYear} → {government.calculation.endYear}</dd></div>
                <div><dt>Andamento Italia</dt><dd>{formatScore(government.calculation.observedScore)}</dd></div>
                <div><dt>Confronto con i peer</dt><dd>{formatScore(government.calculation.relativeScore)}</dd></div>
                <div><dt>Affidabilità</dt><dd>{government.reliability.grade}</dd></div>
              </dl>
              <div className={styles.extremes}>
                <p><span>Ha aiutato di più</span><strong>{strongest.label}</strong><small>{rawChangeLabel(strongest)}</small></p>
                <p><span>Ha frenato di più</span><strong>{weakest.label}</strong><small>{rawChangeLabel(weakest)}</small></p>
              </div>
              <Link className={styles.detailLink} href={`/governi/${government.id}`}>Apri la scheda completa →</Link>
            </article>
          );
        })}
      </section>

      <section className={`panel ${styles.areaSection}`} aria-labelledby="aree-confronto">
        <div className={styles.sectionHeading}>
          <div><span>Confronto per area</span><h2 id="aree-confronto">Dove nasce la differenza</h2></div>
          <p>Una barra più lunga indica un risultato migliore rispetto alla storia italiana e ai peer nello stesso periodo.</p>
        </div>
        <div className={styles.areaRows}>
          {categoryComparisons.map((category) => (
            <div className={styles.areaRow} key={category.label}>
              <strong>{category.label}</strong>
              <div><span>{left.name}</span><i><b style={{ width: `${category.left}%` }} /></i><em>{formatScore(category.left)}</em></div>
              <div><span>{right.name}</span><i><b style={{ width: `${category.right}%` }} /></i><em>{formatScore(category.right)}</em></div>
              <small>{Math.abs(category.difference) < 0.1 ? "pari" : `${category.difference > 0 ? left.name : right.name} +${formatScore(Math.abs(category.difference))}`}</small>
            </div>
          ))}
        </div>
      </section>

      <section className={`panel ${styles.indicatorSection}`} aria-labelledby="indicatori-confronto">
        <div className={styles.sectionHeading}>
          <div><span>Sei indicatori</span><h2 id="indicatori-confronto">I dati, uno per uno</h2></div>
          <p>La variazione grezza aiuta a capire il dato reale; l’indice /100 rende confrontabili periodi diversi.</p>
        </div>
        <div className={styles.tableWrap} role="region" aria-label="Confronto dei sei indicatori" tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">Indicatore</th><th scope="col" className="num">{left.name}</th><th scope="col" className="num">Indice</th><th scope="col" className="num">{right.name}</th><th scope="col" className="num">Indice</th><th scope="col">Risultato migliore</th></tr></thead>
            <tbody>
              {leftCalculation.indicators.map((indicator) => {
                const other = rightCalculation.indicators.find((item) => item.id === indicator.id)!;
                return (
                  <tr key={indicator.id}>
                    <th scope="row">{indicator.label}</th>
                    <td className="num">{rawChangeLabel(indicator)}</td>
                    <td className="num"><strong>{formatScore(indicator.score)}</strong></td>
                    <td className="num">{rawChangeLabel(other)}</td>
                    <td className="num"><strong>{formatScore(other.score)}</strong></td>
                    <td>{Math.abs(indicator.score - other.score) < 0.1 ? "Pari" : indicator.score > other.score ? left.name : right.name}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <aside className={styles.boundary}>
        <strong>Come leggere il risultato</strong>
        <p>“Migliore” significa punteggio Core macro più alto nei dati disponibili. Non significa automaticamente miglior governo in assoluto né prova che tutte le variazioni siano state causate dalle sue decisioni. Periodo, shock, situazione ereditata e misure sono documentati nelle schede individuali.</p>
        <span>Dati osservati fino al {data.sources.ameco.observedThrough} · peer: Francia, Germania e Spagna</span>
      </aside>
    </main>
  );
}
