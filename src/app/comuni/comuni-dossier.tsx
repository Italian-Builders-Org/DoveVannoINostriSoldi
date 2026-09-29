import type { CSSProperties } from "react";
import { compactEuro, integer, longDate } from "@/lib/format";
import type { ComuniFootprint, FootprintStatus } from "@/lib/comuni-footprint";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { ChangeComuneButton } from "./change-comune-button";
import { ComuniRadar } from "./comuni-radar";
import styles from "./comuni.module.css";

function monthName(month: number): string {
  return new Intl.DateTimeFormat("it-IT", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, month - 1, 1)),
  );
}

function periodLabel(footprint: ComuniFootprint): string {
  if (footprint.completeness === "partial") {
    const name = monthName(footprint.latestMonth);
    return `Da gennaio ${/^[aeiou]/i.test(name) ? "ad" : "a"} ${name} ${footprint.year}`;
  }
  return `Anno ${footprint.year}`;
}

function statusLabel(status: FootprintStatus): string {
  if (status === "notevole") return "Molto lontano";
  if (status === "da_osservare") return "Lontano";
  if (status === "in_linea") return "In linea";
  return "n.d.";
}

function statusClass(status: FootprintStatus): string {
  if (status === "notevole") return styles.statusFar;
  if (status === "da_osservare") return styles.statusAway;
  if (status === "in_linea") return styles.statusNear;
  return styles.statusMissing;
}

export function ComuniDossier({ footprint }: { footprint: ComuniFootprint }) {
  const peer = footprint.peer;
  const openCivitas = footprint.openCivitas.status === "available" ? footprint.openCivitas.data : null;
  const irpef = footprint.irpef.status === "available" ? footprint.irpef.data : null;
  const pnrr = footprint.pnrrChildcare.data;
  const trendMax = Math.max(1, ...footprint.trend.map((row) => row.totalCents ?? 0));
  const hasPeerMedian = Boolean(
    peer && footprint.indicators.some((item) => item.id !== "opencivitas-vs-standard" && item.index !== null),
  );
  const placeParts = [footprint.displayName];
  if (footprint.province && footprint.province.toLocaleLowerCase("it-IT") !== footprint.displayName.toLocaleLowerCase("it-IT")) {
    placeParts.push(footprint.province);
  }
  if (footprint.region?.trim()) placeParts.push(footprint.region.trim());
  const place = placeParts.join(" · ");

  return (
    <div className={styles.dossierShell}>
      <header className={styles.pageHead}>
        <div className={styles.pageHeadText}>
          <p className={styles.kicker}>Comuni · confronto SIOPE</p>
          <h1 id="comuni-dossier-title" className={styles.pageTitle}>{footprint.displayName}</h1>
          <p className={styles.pageMeta}>
            {place}
            {footprint.population === null ? "" : ` · ${integer(footprint.population)} abitanti`}
            {" · "}
            {periodLabel(footprint)}
            {footprint.completeness === "partial" ? " (parziale)" : ""}
          </p>
        </div>
        <div className={styles.headActions}>
          <a className={styles.textLink} href={`${PUBLIC_SITE_URL}${footprint.entityHref}`}>
            Scheda ente
          </a>
          <ChangeComuneButton />
        </div>
      </header>

      <section className={styles.radarHero} aria-labelledby="comuni-dossier-title">
        <p className={styles.radarHeroKicker}>
          Impronta vs mediana dei pari (= 100)
          {peer ? ` · ${peer.peers} enti confrontabili` : ""}
        </p>
        <ComuniRadar
          indicators={footprint.indicators}
          municipalityLabel={footprint.displayName}
          hasPeerMedian={hasPeerMedian}
        />
        <p className={styles.readingGuide}>
          Non è un voto né un rischio: solo distanza dal gruppo
          {peer ? ` (${peer.criteria.join(", ")})` : ""}.
          Due numeri su ogni punta: <strong>questo Comune</strong>
          {" · "}
          <strong>{hasPeerMedian ? "mediana" : "riferimento"}</strong>.
        </p>
      </section>

      <dl className={styles.heroMetrics} aria-label="Sintesi dei flussi">
        <div>
          <dt>Pagato</dt>
          <dd>{footprint.totalCents === null ? "n.d." : compactEuro(footprint.totalCents / 100)}</dd>
          <small>{periodLabel(footprint)}</small>
        </div>
        <div>
          <dt>Incassato</dt>
          <dd>
            {footprint.receiptsTotalCents === null
              ? "n.d."
              : compactEuro(footprint.receiptsTotalCents / 100)}
          </dd>
          <small>
            {footprint.receiptsPerCapitaCents === null
              ? "Incassi SIOPE"
              : `${integer(Math.round(footprint.receiptsPerCapitaCents / 100))} € / ab.`}
          </small>
        </div>
        <div>
          <dt>Per abitante</dt>
          <dd>
            {footprint.perCapitaCents === null
              ? "n.d."
              : `${integer(Math.round(footprint.perCapitaCents / 100))} €`}
          </dd>
          <small>Pagamenti di cassa</small>
        </div>
        <div>
          <dt>Per km²</dt>
          <dd>
            {footprint.perSquareKmCents === null
              ? "n.d."
              : compactEuro(footprint.perSquareKmCents / 100)}
          </dd>
          <small>Superficie ISTAT</small>
        </div>
      </dl>

      <section className={styles.axisGlossary} aria-labelledby="assi-title">
        <div className={styles.axisGlossaryHead}>
          <h2 id="assi-title" className={styles.sectionLabel}>
            Cosa misurano gli assi
          </h2>
          <p className={styles.axisGlossaryHint}>
            Indice &gt; 100 = sopra la mediana; &lt; 100 = sotto.
            I numeri da 1 a {footprint.indicators.length} coincidono con il grafico.
          </p>
        </div>
        <ol className={styles.indicatorList}>
          {footprint.indicators.map((item, index) => (
            <li key={item.id} className={styles.indicatorRow} id={`asse-${index + 1}`}>
              <div className={styles.indicatorHead}>
                <span className={styles.indicatorIndex} aria-hidden="true">{index + 1}</span>
                <div className={styles.indicatorTitle}>
                  <strong>{item.label}</strong>
                  {item.index !== null ? (
                    <span className={styles.indexValue}>indice {item.index}</span>
                  ) : null}
                </div>
                <span className={`${styles.statusTag} ${statusClass(item.status)}`}>
                  {statusLabel(item.status)}
                </span>
              </div>
              <p className={styles.indicatorValues}>
                <span className={styles.valueThis}>{item.valueLabel}</span>
                {item.medianLabel ? (
                  <>
                    <span className={styles.valueSep} aria-hidden="true"> · </span>
                    <span className={styles.valuePeer}>
                      {item.id === "opencivitas-vs-standard" ? "standard " : "mediana "}
                      {item.medianLabel}
                    </span>
                  </>
                ) : null}
              </p>
              <p className={styles.indicatorMeaning}>{item.meaning}</p>
              {item.note ? <p className={styles.indicatorNote}>{item.note}</p> : null}
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.deepDossier} aria-labelledby="dossier-deep-title">
        <h2 id="dossier-deep-title" className={styles.sectionTitle}>Dettaglio</h2>

        <div className={styles.dossierGrid}>
          <section className={styles.panel} aria-labelledby="voci-title">
            <h3 id="voci-title">Voci di pagamento</h3>
            <ul className={styles.spendingList}>
              {footprint.spendingRows.map((row) => {
                const share = footprint.totalCents && footprint.totalCents > 0
                  ? row.amountCents / footprint.totalCents
                  : 0;
                return (
                  <li key={row.key}>
                    <div className={styles.spendingRow}>
                      <strong>{row.label}</strong>
                      <span>{compactEuro(row.amountCents / 100)}</span>
                    </div>
                    <div
                      className={styles.spendingBar}
                      style={{ "--share": `${Math.min(100, share * 100)}%` } as CSSProperties}
                      aria-hidden="true"
                    />
                    <p>{row.explanation}</p>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className={styles.panel} aria-labelledby="trend-title">
            <h3 id="trend-title">Andamento recente</h3>
            <ul className={styles.trendList}>
              {footprint.trend.map((row) => (
                <li key={row.year}>
                  <div className={styles.trendMeta}>
                    <strong>{row.year}</strong>
                    <span>{row.totalCents === null ? "n.d." : compactEuro(row.totalCents / 100)}</span>
                  </div>
                  <div
                    className={styles.trendBar}
                    style={{ "--share": `${Math.min(100, ((row.totalCents ?? 0) / trendMax) * 100)}%` } as CSSProperties}
                    aria-hidden="true"
                  />
                  <small>
                    {row.completeness === "partial" ? "Dati parziali" : "Anno completo"}
                    {row.perCapitaCents === null
                      ? ""
                      : ` · ${integer(Math.round(row.perCapitaCents / 100))} € / abitante`}
                  </small>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className={styles.extraGrid} aria-label="Altre fonti ufficiali collegate">
          <article className={styles.panel}>
            <h3>OpenCivitas</h3>
            {openCivitas ? (
              <>
                <p className={styles.extraValue}>
                  {compactEuro(openCivitas.record.historicalSpendingCents / 100)}
                </p>
                <p>
                  Spesa storica {openCivitas.referenceYear} · standard{" "}
                  {compactEuro(openCivitas.record.standardSpendingCents / 100)}.
                </p>
              </>
            ) : (
              <p>{footprint.openCivitas.status === "available" ? null : footprint.openCivitas.message}</p>
            )}
          </article>
          <article className={styles.panel}>
            <h3>IRPEF comunale</h3>
            {irpef ? (
              <>
                <p className={styles.extraValue}>{integer(irpef.record.taxpayers)}</p>
                <p>Contribuenti nel rilascio MEF {irpef.period.taxYear}.</p>
              </>
            ) : (
              <p>{footprint.irpef.status === "available" ? null : footprint.irpef.message}</p>
            )}
          </article>
          <article className={styles.panel}>
            <h3>PNRR asili</h3>
            <p className={styles.extraValue}>{integer(pnrr.totalProjects)}</p>
            <p>
              Progetti {pnrr.submeasure.code}
              {pnrr.knownTotalFundingCents > 0
                ? ` · ${compactEuro(pnrr.knownTotalFundingCents / 100)}`
                : ""}.
            </p>
          </article>
        </section>

        <details className={styles.sourcesDetails}>
          <summary>Fonti e limiti</summary>
          <div>
            <p>{footprint.methodology.measure}. {footprint.methodology.warning}</p>
            <ul>
              {footprint.sources.map((source) => (
                <li key={`${source.year}-${source.url}`}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    SIOPE {source.year}
                  </a>
                  {" · osservato il "}
                  {longDate(source.observedAt)}
                </li>
              ))}
            </ul>
            <p>
              Indice 100 = mediana dei pari, oppure spesa standard OpenCivitas. Autonomia, FCDE e
              rigidità di bilancio non sono calcolate qui: richiedono fonti BDAP di competenza.
            </p>
          </div>
        </details>
      </section>
    </div>
  );
}
