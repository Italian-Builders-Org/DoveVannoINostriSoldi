import Link from "next/link";
import type { Metadata } from "next";
import { PeriodSelector } from "@/components/period-selector";
import { billions, compactEuro, exactEuro, integer, percent, longDate } from "@/lib/format";
import { PASS_THROUGH_TITLE_CODE, siopeTitleCopy } from "@/lib/siope-titles";
import {
  availableSiopeYears,
  completedMonths,
  getSiopeMunicipalSnapshot,
  partialMonth,
  siopeTitleShare,
} from "@/lib/siope-snapshot";
import styles from "./spese.module.css";

export const metadata: Metadata = {
  title: "Soldi",
  description:
    "Per cosa vengono spesi i soldi dei Comuni: le voci di uscita dei pagamenti di cassa SIOPE, mese per mese.",
};

function selectedYear(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] ?? "" : value ?? "";
  const parsed = /^\d{4}$/.test(raw) ? Number(raw) : Number.NaN;
  return availableSiopeYears.includes(parsed) ? parsed : availableSiopeYears[0];
}

export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ anno?: string | string[] }>;
}) {
  const year = selectedYear((await searchParams).anno);
  const data = getSiopeMunicipalSnapshot(year);

  const monthLabel = data.latestMonthLabel.toLocaleLowerCase("it-IT");
  const passThrough =
    data.titles.find((title) => title.code === PASS_THROUGH_TITLE_CODE)?.value ?? 0;
  const netPayments = data.totalPaid - passThrough;

  /* The running month is still filling up, so it would drag the average down.
     A closed year has no running month and counts all twelve. */
  const runningMonth = partialMonth(data);
  const settledMonths = completedMonths(data);
  const completedAverage =
    settledMonths.length > 0
      ? settledMonths.reduce((sum, point) => sum + point.flow, 0) / settledMonths.length
      : 0;
  const completedRange =
    settledMonths.length > 0
      ? `da ${settledMonths[0].label.toLocaleLowerCase("it-IT")} a ${settledMonths[settledMonths.length - 1].label.toLocaleLowerCase("it-IT")} ${data.year}`
      : "nessun mese completo";

  const maxFlow = Math.max(...data.monthly.map((point) => point.flow), 0);
  const titles = data.titles.map((title) => ({
    ...title,
    copy: siopeTitleCopy(title.code),
    share: data.totalPaid > 0 ? (title.value / data.totalPaid) * 100 : 0,
  }));
  const titleOneShare = siopeTitleShare(data, "1");
  const titleOneShareLabel =
    titleOneShare === null ? "non disponibile" : percent(titleOneShare * 100);
  const comparison = [...availableSiopeYears].sort((left, right) => left - right).map((comparisonYear) => {
    const comparisonData = getSiopeMunicipalSnapshot(comparisonYear);
    const share = siopeTitleShare(comparisonData, "1");
    const isPartial = partialMonth(comparisonData) !== null;
    return {
      year: comparisonYear,
      share: share === null ? "n.d." : percent(share * 100),
      isPartial,
      period: isPartial
        ? `gennaio-${comparisonData.latestMonthLabel.toLocaleLowerCase("it-IT")} · parziale`
        : "anno chiuso",
    };
  });
  const partialComparisonYears = comparison
    .filter((row) => row.isPartial)
    .map((row) => row.year);

  return (
    <main className="shell page">
      <div className={styles.intro}>
        <div className="page-intro">
          <h1>Per cosa vengono spesi i soldi</h1>
          <p>
            Pagamenti dei Comuni nel periodo gennaio–{monthLabel} {data.year}, divisi per tipo di
            uscita. Fonte SIOPE, file del {longDate(data.source.siopeMovementsLastModified)}.
          </p>
          <Link className={styles.mobileDataJump} href="#voci-spesa">
            Vedi le {data.titles.length} voci di uscita ↓
          </Link>
        </div>
        <PeriodSelector activeYear={year} years={availableSiopeYears} pathname="/spese" />
      </div>

      <div className="stat-strip">
        <div>
          <span className="stat-label">Totale pagato</span>
          <span className="stat-value">{compactEuro(data.totalPaid)}</span>
          <span className="stat-note">{exactEuro(data.totalPaid)} esatti</span>
        </div>
        <div>
          <span className="stat-label">Pagamenti al netto delle partite di giro</span>
          <span className="stat-value">{compactEuro(netPayments)}</span>
          <span className="stat-note">totale meno le uscite per conto terzi</span>
        </div>
        <div>
          <span className="stat-label">Media dei mesi completi</span>
          <span className="stat-value">{compactEuro(completedAverage)}</span>
          <span className="stat-note">{completedRange}</span>
        </div>
        <div>
          <span className="stat-label">Per abitante</span>
          <span className="stat-value">
            {data.nationalPerCapita === null ? "Non disponibile" : exactEuro(data.nationalPerCapita)}
          </span>
          <span className="stat-note">su {integer(data.populationCovered)} abitanti</span>
        </div>
      </div>

      <section
        className="notice scope-notice"
        aria-labelledby="spese-scope-title"
      >
        <h2 id="spese-scope-title">Quali spese vuoi vedere?</h2>
        <p>
          Questa pagina mostra uscite di cassa dei Comuni, non le tasse pagate dai residenti. Le
          contabilità degli altri enti restano separate.
        </p>
        <div className="scope-notice__section">
          <h3>Comuni · dettaglio territoriale</h3>
          <p>
            Apri i <Link href={`/territori?anno=${year}`}>pagamenti per regione e le classifiche
            comunali pubblicate</Link>. Il dataset attuale non contiene una ripartizione
            provinciale né ogni voce di spesa per singolo Comune.
          </p>
        </div>
        <div className="scope-notice__section">
          <h3>Invalidità civile INPS · contabilità separata</h3>
          <p>
            È una contabilità diversa da SIOPE e resta separata. Abbiamo verificato spesa
            nazionale, prestazioni vigenti e nuove pensioni per regione nei documenti ufficiali
            INPS. <Link href="/spese/invalidita">Apri i dati sull&apos;invalidità civile →</Link>
          </p>
        </div>
        <div className="scope-notice__section">
          <h3>Enti SSN · Conto Economico consuntivo 2024</h3>
          <p>
            Il Conto Economico OpenBDAP misura costi di competenza economica, non pagamenti di
            cassa e non si somma a SIOPE o alla contabilità INPS. <Link href="/spese/sanita">Apri
            personale e servizi degli enti SSN →</Link>
          </p>
        </div>
        <div className="scope-notice__section">
          <h3>Altri livelli della spesa pubblica</h3>
          <p>
            Per gli altri livelli apri le <Link href="/stato">spese delle amministrazioni
            centrali</Link> oppure le <Link href="/parlamento">spese del Parlamento</Link>.
          </p>
        </div>
      </section>

      <div className={styles.split}>
        <section className="panel" id="voci-spesa">
          <h2 className="panel-title">Le {data.titles.length} voci di uscita</h2>

          <section className={styles.analysis} aria-labelledby="spese-analysis-title">
            <h3 id="spese-analysis-title">Il {titleOneShareLabel} è tanto o poco?</h3>
            <p className={styles.analysisLead}>
              È la quota dei pagamenti registrati nel <strong>Titolo 1 · spese correnti</strong>{" "}
              sul totale delle uscite SIOPE dei Comuni nel periodo selezionato. È una misura di
              cassa e di classificazione contabile: da sola non dice se una spesa sia utile,
              efficiente o di buona qualità.
            </p>

            <div className={styles.analysisComparison}>
              <h4>Confronto descrittivo</h4>
              <div
                className="table-scroll"
                role="region"
                aria-label="Quota delle spese correnti per periodo"
                tabIndex={0}
              >
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Periodo</th>
                      <th scope="col" className="num">Quota</th>
                      <th scope="col">Stato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.map((row) => (
                      <tr key={row.year}>
                        <th scope="row">{row.year}</th>
                        <td className="num">{row.share}</td>
                        <td>{row.period}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles.note}>
                {partialComparisonYears.length > 0 ? (
                  <>
                    Il confronto non è un trend: {partialComparisonYears.join(", ")}{" "}
                    {partialComparisonYears.length === 1 ? "è ancora parziale" : "sono ancora parziali"}
                    {" "}e gli snapshot non contengono una serie mensile per Titolo 1. Per un
                    confronto omogeneo servono gli stessi mesi e lo stesso denominatore per ogni anno.
                  </>
                ) : (
                  <>
                    Il confronto è descrittivo: gli snapshot annuali non misurano qualità o
                    efficienza e il denominatore demografico deve restare omogeneo tra gli anni.
                  </>
                )}
              </p>
            </div>

            <div className={styles.analysisDistribution}>
              <h4>Quanto cambia tra i Comuni</h4>
              <p>
                La distribuzione completa usa tutti i Comuni con popolazione valida. Nel periodo
                selezionato, almeno metà dei residenti vive in Comuni che registrano non più di <strong>
                  {data.distribution.perCapita.residentWeighted.p50 === null
                    ? "un valore non disponibile"
                    : exactEuro(data.distribution.perCapita.residentWeighted.p50)}
                </strong> per abitante nel Titolo 1, e almeno metà vive in Comuni che registrano
                quel valore o più.
              </p>
              <dl className={styles.quantiles}>
                <div>
                  <dt>Soglia al 25% dei residenti</dt>
                  <dd>
                    {data.distribution.perCapita.residentWeighted.p25 === null
                      ? "n.d."
                      : exactEuro(data.distribution.perCapita.residentWeighted.p25)}
                  </dd>
                </div>
                <div>
                  <dt>Mediana residenti</dt>
                  <dd>
                    {data.distribution.perCapita.residentWeighted.p50 === null
                      ? "n.d."
                      : exactEuro(data.distribution.perCapita.residentWeighted.p50)}
                  </dd>
                </div>
                <div>
                  <dt>Soglia al 75% dei residenti</dt>
                  <dd>
                    {data.distribution.perCapita.residentWeighted.p75 === null
                      ? "n.d."
                      : exactEuro(data.distribution.perCapita.residentWeighted.p75)}
                  </dd>
                </div>
                <div>
                  <dt>Mediana dei Comuni</dt>
                  <dd>
                    {data.distribution.perCapita.municipalityWeighted.p50 === null
                      ? "n.d."
                      : exactEuro(data.distribution.perCapita.municipalityWeighted.p50)}
                  </dd>
                </div>
              </dl>
              <p className={styles.note}>
                {integer(data.distribution.coverage.municipalitiesWithValidPopulation)} Comuni ·{" "}
                {integer(data.distribution.coverage.populationCovered)} residenti · periodo{" "}
                {data.distribution.period.completeness === "partial" ? "parziale" : "chiuso"}.
                La fonte non dichiara l&apos;anno di riferimento della popolazione SIOPE. Il totale
                nazionale include anche{" "}
                {integer(data.distribution.coverage.municipalitiesWithoutRegion)} Comuni senza un
                abbinamento regionale IPA, pari a{" "}
                {exactEuro(data.distribution.coverage.paymentsWithoutRegion)} di pagamenti. Le fasce
                includono soltanto i Comuni con popolazione valida; i riepiloghi regionali escludono
                quelli senza abbinamento, senza distribuirli artificialmente.
              </p>
            </div>
          </section>

          <ol className={styles.titleList}>
            {titles.map((title) => (
              <li key={title.code}>
                <div className={styles.titleHead}>
                  <h3>
                    {title.copy.name}
                    <small> · {title.copy.official}</small>
                  </h3>
                  <b>
                    {compactEuro(title.value)} · {percent(title.share)}
                  </b>
                </div>
                <div className={styles.titleTrack} aria-hidden="true">
                  <i style={{ width: `${title.share}%` }} />
                </div>
                <p>{title.copy.explanation}</p>
                <small>Valore esatto: {exactEuro(title.value)}.</small>
              </li>
            ))}
          </ol>
        </section>

        <div className={styles.aside}>
          <section className="panel">
            <h2 className="panel-title">Mese per mese · mld €</h2>
            <ul className={styles.monthList}>
              {data.monthly.map((point) => {
                const running = point.month === runningMonth;
                return (
                  <li key={point.month}>
                    <span>
                      {point.label}
                      {running ? "*" : ""}
                    </span>
                    <i aria-hidden="true">
                      <b
                        className={running ? styles.running : undefined}
                        style={{ width: maxFlow > 0 ? `${(point.flow / maxFlow) * 100}%` : "0%" }}
                      />
                    </i>
                    <b className="num-tabular">{billions(point.flow)}</b>
                  </li>
                );
              })}
            </ul>
            {runningMonth === null ? (
              <p className={styles.note}>Anno chiuso: tutti i mesi sono definitivi.</p>
            ) : (
              <p className={styles.note}>
                *{data.latestMonthLabel} è ancora in corso: il numero salirà.
              </p>
            )}
          </section>

          <section className="panel">
            <h2 className="panel-title">Flusso e cumulato · mld €</h2>
            <div className="table-scroll" role="region" aria-label="Flusso mensile e cumulato delle spese" tabIndex={0}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Mese</th>
                    <th scope="col" className="num">Pagato</th>
                    <th scope="col" className="num">Cumulato</th>
                  </tr>
                </thead>
                <tbody>
                  {data.monthly.map((point) => (
                    <tr key={point.month}>
                      <th scope="row">
                        {point.label}
                        {point.month === runningMonth ? "*" : ""}
                      </th>
                      <td className="num">{billions(point.flow)}</td>
                      <td className="num">{billions(point.cumulative)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      <details className={styles.method}>
        <summary>Come sono raccolti questi dati</summary>
        <p>
          Misura: {data.methodology.measure}. {data.methodology.periodicity}. Righe lette:{" "}
          {integer(data.coverage.movementRows)} · incluse:{" "}
          {integer(data.coverage.includedMovementRows)} · malformate:{" "}
          {integer(data.coverage.malformedRows)}. I totali nazionali includono i Comuni riconosciuti
          dall&apos;anagrafica SIOPE; le aggregazioni territoriali includono soltanto quelli collegati
          a una Regione tramite {data.methodology.territorialJoin}.
        </p>
        <p>
          Fonte:{" "}
          <a href={data.source.siopeMovementsUrl} target="_blank" rel="noreferrer">
            SIOPE
          </a>{" "}
          · {data.source.siopeOwner} · scaricato il {longDate(data.source.observedAt)}.{" "}
          <Link href="/metodologia">Come leggiamo i dati →</Link>
        </p>
      </details>
    </main>
  );
}
