import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import data from '@/content/reports/state-budget-reader.json';
import { PUBLIC_SITE_URL } from '@/lib/site';
import { queryEurostatCofog } from '@/lib/eurostat-cofog-snapshot';
import {
  validateReader, validateReaderSnapshot, readerValue, readerNumber, readerBillions,
  readerShare, readerCalculationText, type ReaderReport, type ReaderChart,
} from '@/lib/reports/state-budget-reader';
import styles from './report.module.css';

const report = validateReader(data as ReaderReport);
export const metadata: Metadata = {
  title: report.title, description: report.summary,
  alternates: { canonical: `${PUBLIC_SITE_URL}${report.route}` },
  openGraph: { type: 'article', title: report.title, description: report.summary,
    publishedTime: report.publishedOn, modifiedTime: report.modifiedOn, url: `${PUBLIC_SITE_URL}${report.route}` },
};
const sourceMap = new Map(report.sources.map((source, i) => [source.id, { ...source, number: i + 1 }]));
function Sources({ ids }: { ids: string[] }) {
  return <span className={styles.sourceLinks}>Fonti {ids.map((id, i) => <span key={id}>{i > 0 ? ', ' : ''}<a href={`#source-${id}`} aria-label={`Fonte ${sourceMap.get(id)!.number}: ${sourceMap.get(id)!.publisher}`}>[{sourceMap.get(id)!.number}]</a></span>)}</span>;
}
function Chart({ chart, id }: { chart: ReaderChart; id: string }) {
  const values = chart.rows.map(row => Number(readerValue(report, row.metric)));
  const max = Math.max(...values, 1);
  return <figure className={styles.figure} aria-labelledby={`${id}-caption`}>
    <figcaption id={`${id}-caption`}><strong>{chart.title}</strong><span>{chart.unit}</span></figcaption>
    <div className={styles.bars}>{chart.rows.map((row, i) => <div className={styles.barRow} key={row.metric}>
      <span>{row.label}</span><strong>{readerNumber(values[i], chart.unit.includes('€') && values[i] >= 1000 ? 0 : values[i] % 1 === 0 ? 0 : 2)}</strong>
      <span className={styles.track} aria-hidden="true"><span style={{ width: `${values[i] / max * 100}%` }} /></span>
    </div>)}</div>
    <p className={styles.figureNote}>{chart.note}</p>
  </figure>;
}
export default function StateBudgetReport() {
  const snapshot = queryEurostatCofog({ geo: 'IT', year: report.macro.year });
  validateReaderSnapshot(report, snapshot.observations);
  const sectors = [...report.sectors].sort((a, b) => Number(b.amountCents) - Number(a.amountCents));
  return <main className={`shell ${styles.report}`}>
    <nav className={styles.breadcrumb} aria-label="Percorso"><Link href="/report">Report</Link><span aria-hidden="true"> / </span><span>Spesa pubblica</span></nav>
    <article>
      <header className={styles.hero}>
        <div className={styles.brand}><Image src="/brand/dvns-mark-transparent.png" width={40} height={40} alt="" aria-hidden="true" /><span>DoveVannoINostriSoldi</span></div>
        <p className={styles.eyebrow}>Analisi · <time dateTime={report.modifiedOn}>14 settembre 2026</time></p>
        <h1>{report.title}</h1>
        <p className={styles.dek}>{report.summary}</p>
        <div className={styles.actions}><a className={styles.primaryAction} href="#riscontri">Leggi i riscontri</a><a href={report.pdfPath} download>Scarica il PDF</a><a href="#copertura">Metodo e copertura</a></div>
      </header>
      <section className={styles.brief} aria-labelledby="in-breve-title">
        <h2 id="in-breve-title">Il punto, in un minuto</h2>
        <p className={styles.prose}>{report.lead}</p>
        <div className={styles.highlights}>{report.cases.slice(0,3).map(item => <a key={item.id} href={`#${item.id}`}>
          <span className={styles.eyebrow}>{report.sectors.find(s => s.code === item.sector)!.label}</span><strong>{item.number}</strong><span className={styles.highlightTitle}>{item.title}</span><span>{item.numberLabel}</span><small>{item.period}</small>
        </a>)}</div>
        <p className={styles.limit}>Periodi e grandezze diversi: questi numeri non formano un totale degli sprechi.</p>
      </section>
      <section id="quadro-spesa" className={styles.section} aria-labelledby="quadro-title">
        <div className={styles.sectionHeading}><p className={styles.eyebrow}>01 · Il quadro completo</p><h2 id="quadro-title">Dove vanno 100 euro di spesa pubblica</h2></div>
        <div className={styles.macroLayout}>
          <div className={styles.macroIntro}><strong className={styles.total}>{readerBillions(report.macro.totalCents)}<span>miliardi di euro</span></strong><p>Italia · {report.macro.year}</p><p>{report.macro.note}</p><p><strong>{readerNumber(report.macro.gdpPercent,1)}% del PIL</strong>. Il PIL misura il valore dell’attività economica del Paese.</p><Sources ids={[report.macro.sourceId]} /></div>
          <figure className={styles.composition}><figcaption>Euro su 100 di spesa complessiva · {report.macro.year}</figcaption>{sectors.map(sector => {
            const share = readerShare(sector.amountCents, report.macro.totalCents);
            return <div className={styles.compositionRow} key={sector.code}><a href={`#settore-${sector.code.toLowerCase()}`}>{sector.label}</a><strong>{readerNumber(share,2)} €</strong><span className={styles.track} aria-hidden="true"><span style={{width:`${share}%`}} /></span></div>;
          })}<p className={styles.figureNote}>Le barre partono da zero e usano tutte la scala 0-100. Più spesa non significa più spreco.</p></figure>
        </div>
        <details className={styles.details}><summary>Importi esatti e denominatore</summary><div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Importi per funzione, tabella scorrevole"><table><caption>Euro correnti, competenza economica SEC 2010, amministrazioni pubbliche S13, {report.macro.year}</caption><thead><tr><th scope="col">Funzione</th><th scope="col">Spesa in euro</th><th scope="col">Su 100 euro</th></tr></thead><tbody>{sectors.map(sector => <tr key={sector.code}><th scope="row">{sector.label}</th><td>{readerNumber(Number(sector.amountCents)/100,0)}</td><td>{readerNumber(readerShare(sector.amountCents,report.macro.totalCents),2)}</td></tr>)}</tbody><tfoot><tr><th scope="row">Totale pubblicato</th><td>{readerNumber(Number(report.macro.totalCents)/100,0)}</td><td>100,00</td></tr></tfoot></table></div><p>La somma delle dieci funzioni italiane coincide con questo totale. Le quote visualizzate sono arrotondate singolarmente.</p></details>
      </section>
      <section className={styles.section} aria-labelledby="settori-title">
        <div className={styles.sectionHeading}><p className={styles.eyebrow}>02 · Tutti i settori</p><h2 id="settori-title">Spesa e risultati sono due domande diverse</h2></div>
        <div className={styles.sectorGrid}>{sectors.map(sector => <section className={styles.sector} id={`settore-${sector.code.toLowerCase()}`} key={sector.code} aria-labelledby={`${sector.code}-title`}><h3 id={`${sector.code}-title`}>{sector.label}</h3><strong>{readerBillions(sector.amountCents)} mld €</strong><p>{sector.note}</p><p>{sector.reading}</p>{sector.caseIds.length>0 && <p className={styles.sectorLinks}>{sector.caseIds.map((id,i) => <span key={id}>{i>0?' · ':''}<a href={`#${id}`}>{report.cases.find(c => c.id===id)!.title.split(':')[0]}</a></span>)}</p>}</section>)}</div>
      </section>
      <section className={styles.section} id="riscontri" aria-labelledby="riscontri-title">
        <div className={styles.sectionHeading}><p className={styles.eyebrow}>03 · L’analisi</p><h2 id="riscontri-title">{report.cases.length} riscontri, ciascuno con il suo significato</h2></div>
        <nav className={styles.contents} aria-label="Indice dei riscontri"><ol>{report.cases.map(item => <li key={item.id}><a href={`#${item.id}`}>{item.title}</a></li>)}</ol></nav>
        {report.cases.map((item,index) => <section className={styles.case} id={item.id} key={item.id} data-kind={item.kind} aria-labelledby={`${item.id}-title`}>
          <div className={styles.caseHeader}><p className={styles.eyebrow}>{String(index+1).padStart(2,'0')} · {report.kindLabels[item.kind]}</p><h3 id={`${item.id}-title`}>{item.title}</h3><p className={styles.period}>{item.period}</p></div>
          <div className={styles.caseLayout}><div className={styles.prose}><p className={styles.lead}>{item.lead}</p>{item.paragraphs.map(text => <p key={text}>{text}</p>)}<div className={styles.conclusion}><h4>Cosa dimostra</h4><p>{item.conclusion}</p></div><p className={styles.improvement}><strong>Come migliorare.</strong> {item.improve}</p><Sources ids={item.sourceIds} /></div>
          <aside className={styles.caseNumbers} aria-label={`Numero principale: ${item.title}`}><p className={styles.stat}>{item.number}</p><p>{item.numberLabel}</p>{item.chart && <Chart chart={item.chart} id={`chart-${item.id}`} />}</aside></div>
          {item.math && <div className={styles.mathIntro}><h4>Il calcolo, in parole semplici</h4><p>{item.math.explanation}</p></div>}
          <details className={styles.details}><summary>Dati e fonti di questo riscontro<span className="sr-only">: {item.title}</span></summary>{item.math && <div className={styles.formulas}>{item.math.calculationIds.map(id => {const c = report.calculations.find(x => x.id===id)!; return <p key={id}><strong>{c.label}</strong><br /><span>{readerCalculationText(report,c)}</span></p>;})}</div>}{item.math && item.math.rows.length>0 && <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Numeratori e denominatori del confronto"><table><caption>Come cambia il confronto escludendo il contratto RTI</caption><thead><tr><th scope="col">Confronto</th><th scope="col">Importo associato</th><th scope="col">Totale confrontato</th><th scope="col">Quota</th></tr></thead><tbody>{item.math.rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{readerNumber(readerValue(report,row.numerator))} €</td><td>{readerNumber(readerValue(report,row.denominator))} €</td><td>{readerNumber(readerValue(report,row.result))}%</td></tr>)}</tbody></table></div>}<ul className={styles.sourceList}>{item.sourceIds.map(id => {const source=sourceMap.get(id)!;return <li key={id}><a href={source.url}>{source.publisher}: {source.title}</a><p>{source.locator}</p></li>;})}</ul></details>
        </section>)}
      </section>
      <section id="comuni" className={styles.section} aria-labelledby="comuni-title"><div className={styles.sectionHeading}><p className={styles.eyebrow}>04 · I servizi locali</p><h2 id="comuni-title">{report.municipal.title}</h2></div><div className={styles.prose}>{report.municipal.paragraphs.map(text => <p key={text}>{text}</p>)}</div><div className={styles.contextCharts}>{report.municipal.charts.map((chart,i)=><Chart chart={chart} id={`comuni-chart-${i}`} key={chart.title} />)}</div><Sources ids={report.municipal.sourceIds}/></section>
      <section id="copertura" className={styles.section} aria-labelledby="metodo-title"><div className={styles.sectionHeading}><p className={styles.eyebrow}>05 · Come leggere il rapporto</p><h2 id="metodo-title">Metodo, copertura e parole utili</h2></div><div className={styles.prose}>{report.method.map(text=><p key={text}>{text}</p>)}</div><details className={styles.details}><summary>Le parole della contabilità, senza tecnicismi</summary><dl className={styles.glossary}>{report.glossary.map(item=><div key={item.term}><dt>{item.term}</dt><dd>{item.definition}</dd></div>)}</dl></details><p className={styles.downloads}><a href="/data/reports/state-budget-reader.json" download>Dati del rapporto (JSON)</a><a href="/data/reports/state-budget-reader.csv" download>Riscontri (CSV)</a><a href={report.legacyEvidenceUrl}>Prove della prima analisi</a></p></section>
      <section className={styles.section} id="fonti" aria-labelledby="fonti-title"><div className={styles.sectionHeading}><h2 id="fonti-title">Fonti</h2></div><ol className={styles.bibliography}>{report.sources.map(source=><li id={`source-${source.id}`} key={source.id}><a href={source.url}><strong>{source.publisher}</strong>: {source.title}</a><p>{source.locator}</p><details><summary>Periodo e consultazione</summary><p>Periodo: {source.period}. Pubblicazione: {source.publishedOn ?? 'non indicata in questa scheda'}. Consultazione: {source.checkedOn}.</p><p>{source.access}</p></details></li>)}</ol></section>
    </article>
  </main>;
}
