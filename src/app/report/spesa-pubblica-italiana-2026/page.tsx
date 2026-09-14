import type { Metadata } from 'next';
import Link from 'next/link';
import reportArtifact from '@/content/reports/public-spending-2026.json';
import { queryEurostatCofog } from '@/lib/eurostat-cofog-snapshot';
import { compareReportSnapshot, formatReportDecimal, sectionShare, validatePublicSpendingReport, type PublicSpendingReport } from '@/lib/public-spending-report';
import styles from './report.module.css';

const report = validatePublicSpendingReport(reportArtifact as PublicSpendingReport);
export const metadata: Metadata = {
  title: report.title,
  description: report.subtitle,
  alternates: {canonical: '/report/spesa-pubblica-italiana-2026'},
};

function Sources({ids}: {ids: string[]}) {
  return <p className={styles.refs}>Fonti: {ids.map((id, i) => <span key={id}>{i > 0 ? ' · ' : ''}<a href={`#source-${id}`}>{id}</a></span>)}</p>;
}
function Facts({ids, context}: {ids: string[]; context: string}) {
  return <div className={styles.facts}>{ids.map((id) => {
    const fact = report.facts.find((entry) => entry.id === id);
    if (!fact) throw new Error(`Fatto mancante: ${id}`);
    return <article className={styles.fact} key={id} id={`${context}-${id}`}>
      <p className={styles.label}>{id} · {report.assessmentLabels[fact.kind]} · {fact.referencePeriod}</p>
      <h4>{fact.title}</h4><p>{fact.text}</p>
      <p className={styles.note}>{fact.scope}. {fact.limitation}</p>
      {fact.calculationId && <p><a href={`#calc-${fact.calculationId}`}>Verifica il calcolo {fact.calculationId}</a></p>}
      <Sources ids={fact.sourceIds}/>
    </article>;
  })}</div>;
}

export default function PublicSpendingReportPage() {
  const snapshot = queryEurostatCofog({geo: 'IT', year: report.scope.macroYear});
  const differences = compareReportSnapshot(report, snapshot.observations);
  return <main className={`shell page ${styles.report}`}>
    <header className={styles.header}>
      <Link href="/report">Tutti i report</Link>
      <p className={styles.label}>Rapporto di approfondimento · {report.edition}</p>
      <h1>{report.title}</h1><p className={styles.lead}>{report.subtitle}</p>
      <p>{report.scope.coverage}</p>
      <p className={styles.note}>Bozza per revisione editoriale. Mappa monetaria {report.scope.macroYear}; le evidenze mantengono il proprio periodo. Nessuna stima del totale nazionale degli sprechi.</p>
      <nav className={styles.downloads} aria-label="Documenti del rapporto">
        <a href={report.pdfPath}>PDF completo</a><a href={report.jsonPath}>Dati e fonti JSON</a><a href={report.csvPath}>Registro delle evidenze CSV</a>
        <Link href={report.predecessor.href}>Prima versione: audit del bilancio statale</Link>
      </nav>
    </header>
    {differences.length > 0 && <aside className={styles.warning} aria-label="Avviso di revisione della fonte">
      <h2>Lo snapshot corrente è diverso da questa edizione</h2>
      <p>I valori del rapporto e del PDF sono congelati alla data di ricerca. Non rappresentano automaticamente il rilascio più recente.</p>
      <ul>{differences.map((message) => <li key={message}>{message}</li>)}</ul>
    </aside>}
    <nav className={styles.contents} aria-label="Indice del rapporto">
      <a href="#sintesi">Sintesi</a><a href="#mappa">Mappa della spesa</a><a href="#priorita">Priorità</a>
      {report.sections.map((s) => <a key={s.code} href={`#${s.code}`}>{s.code} · {s.title}</a>)}
      <a href="#comuni">Comuni</a><a href="#metodo">Metodo</a><a href="#calcoli">Calcoli</a><a href="#fonti">Fonti</a>
    </nav>
    <section id="sintesi" className={styles.section} aria-labelledby="sintesi-title">
      <h2 id="sintesi-title">Il quadro d’insieme</h2>
      {report.executive.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      <Sources ids={['S01', 'S04', 'S06', 'S08', 'S10', 'S12', 'S13']}/>
      <p className={styles.note}>Quote ricalcolate: <a href="#calc-C07">C07</a> e <a href="#calc-C08">C08</a>. Le priorità che seguono sono proposte del report, non raccomandazioni attribuite alle fonti.</p>
    </section>
    <section id="mappa" className={styles.section} aria-labelledby="mappa-title">
      <h2 id="mappa-title">Tutte le funzioni della spesa pubblica</h2>
      <p className={styles.metric}>{formatReportDecimal(report.macro.totalBillionRounded)} <span>miliardi di euro</span></p>
      <p>{report.scope.name} · {report.scope.macroYear} · {report.scope.accounting}. {formatReportDecimal(report.macro.shareGdpRounded, 1)}% del PIL.</p>
      <div className={styles.tableScroll} role="region" tabIndex={0} aria-label="Spesa per funzione, tabella scorrevole">
        <table className={styles.table}><caption>Importi arrotondati a 0,01 miliardi. Quote calcolate sul totale, non percentuali di spreco.</caption>
          <thead><tr><th scope="col">Funzione</th><th scope="col">Miliardi €</th><th scope="col">Quota %</th></tr></thead>
          <tbody>{report.sections.map((s) => <tr key={s.code}><th scope="row"><a href={`#${s.code}`}>{s.code} · {s.title}</a></th><td>{formatReportDecimal(s.amountBillionRounded)}</td><td>{sectionShare(s.amountBillionRounded, report.macro.totalBillionRounded)}</td></tr>)}</tbody>
          <tfoot><tr><th scope="row">Totale ufficiale</th><td>{formatReportDecimal(report.macro.totalBillionRounded)}</td><td>100,0</td></tr></tfoot>
        </table>
      </div>
      <p className={styles.note}>{report.macro.reconciliation}</p><Sources ids={report.macro.sourceIds}/>
      <Facts ids={['F01']} context="macro"/>
    </section>
    <section id="priorita" className={styles.section} aria-labelledby="priorita-title">
      <h2 id="priorita-title">Quattro priorità di intervento</h2>
      {report.priorities.map((p, i) => <article key={p.title} className={styles.priority}>
        <p className={styles.label}>{i + 1} · {p.scope}</p><h3>{p.title}</h3>
        <p>{p.action}</p><p><strong>Base della proposta.</strong> {p.basis}.</p><p className={styles.note}>{p.tradeoff}</p><Sources ids={p.sourceIds}/>
      </article>)}
    </section>
    {report.sections.map((s) => <section className={styles.section} key={s.code} id={s.code} aria-labelledby={`${s.code}-title`}>
      <p className={styles.label}>{s.code} · {s.assessment}</p><h2 id={`${s.code}-title`}>{s.title}</h2>
      <p className={styles.metricSmall}>{formatReportDecimal(s.amountBillionRounded)} miliardi € <span>· COFOG {report.scope.macroYear}</span></p>
      <h3>{s.headline}</h3><Facts ids={s.factIds} context={s.code}/>
      <div className={styles.analysis}><h3>Analisi</h3>{s.analysis.map((p) => <p key={p}>{p}</p>)}</div>
      <h3>Dove intervenire</h3><ol>{s.actions.map((p) => <li key={p}>{p}</li>)}</ol>
      <dl className={styles.decision}><div><dt>Chi può intervenire</dt><dd>{s.owner}</dd></div><div><dt>Come misurare il risultato</dt><dd>{s.kpi}</dd></div><div><dt>Risorse liberabili</dt><dd>{s.quantification}</dd></div></dl>
      <p className={styles.note}>{s.limitations}</p><Sources ids={s.sourceIds}/><a className={styles.back} href="#mappa">Torna alla mappa</a>
    </section>)}
    <section className={styles.section} id="comuni" aria-labelledby="comuni-title">
      <h2 id="comuni-title">{report.municipal.title}</h2><Facts ids={report.municipal.factIds} context="comuni"/>
      {report.municipal.analysis.map((p) => <p key={p}>{p}</p>)}
      <h3>Dove intervenire</h3><ol>{report.municipal.actions.map((p) => <li key={p}>{p}</li>)}</ol>
      <dl className={styles.decision}><div><dt>Chi può intervenire</dt><dd>{report.municipal.owner}</dd></div><div><dt>Come misurare il risultato</dt><dd>{report.municipal.kpi}</dd></div><div><dt>Risorse liberabili</dt><dd>{report.municipal.quantification}</dd></div></dl>
      <p className={styles.note}>{report.municipal.limitations}</p><Sources ids={report.municipal.sourceIds}/>
    </section>
    <section className={styles.section} id="metodo" aria-labelledby="metodo-title"><h2 id="metodo-title">Metodo e limiti della verifica</h2>{report.methodology.map((p) => <p key={p}>{p}</p>)}</section>
    <section className={styles.section} id="calcoli" aria-labelledby="calcoli-title"><h2 id="calcoli-title">Registro dei calcoli</h2>
      {report.calculations.map((c) => <article key={c.id} id={`calc-${c.id}`} className={styles.calculation}><h3>{c.id} · {c.display}</h3><p>{c.description}</p><p className={styles.note}>Operazione: {c.operation}. Operandi: {c.inputs.join(' ; ')}. Arrotondamento: {c.roundDigits} decimali.</p><Sources ids={c.sourceIds}/></article>)}
    </section>
    <section className={styles.section} id="fonti" aria-labelledby="fonti-title"><h2 id="fonti-title">Registro delle fonti</h2>
      <p>Le fonti di evidenza e i cataloghi per ulteriori verifiche sono distinti. Consultazione documentale non significa acquisizione integrale della banca dati.</p>
      {report.sources.map((s) => <article key={s.id} id={`source-${s.id}`} className={styles.source}>
        <h3>{s.id} · {s.holder}</h3><p><a href={s.url} rel="noreferrer">{s.title}</a></p>
        <p className={styles.note}>Periodo: {s.referencePeriod}. Pubblicazione: {s.publicationDate ?? 'non dichiarata'}. Consultazione: {s.checkedAt}.</p>
        <p>{s.locator}</p><p className={styles.note}>{s.note} Modalità: {s.verificationChannel}. {s.rights}</p>
      </article>)}
    </section>
    <footer className={styles.footer}><p>{report.predecessor.note}</p><Link href="/report">Torna all’archivio report</Link></footer>
  </main>;
}
