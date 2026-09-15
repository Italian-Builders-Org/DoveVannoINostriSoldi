import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import data from '@/content/reports/state-budget-reader.json';
import { PUBLIC_SITE_URL } from '@/lib/site';
import { queryEurostatCofog } from '@/lib/eurostat-cofog-snapshot';
import {
  validateReader, validateReaderSnapshot, readerValue, readerNumber, readerBillions,
  readerShare, readerCalculationText, type ReaderReport, type ReaderChart, type ReaderCase,
  type AuditContext,
} from '@/lib/reports/state-budget-reader';
import styles from './report.module.css';

const report = validateReader(data as ReaderReport);
export const metadata: Metadata = {
  title: report.title, description: report.summary,
  alternates: { canonical: `${PUBLIC_SITE_URL}${report.route}` },
  openGraph: { type: 'article', title: report.title, description: report.summary,
    publishedTime: report.publishedOn, modifiedTime: report.modifiedOn, url: `${PUBLIC_SITE_URL}${report.route}` },
};
const sources = new Map(report.sources.map((source, i) => [source.id, { ...source, number: i + 1 }]));
function Sources({ ids }: { ids: string[] }) {
  return <span className={styles.sourceLinks}>Fonti {ids.map((id, i) => <span key={id}>{i > 0 ? ', ' : ''}<a href={`#source-${id}`} aria-label={`Fonte ${sources.get(id)!.number}: ${sources.get(id)!.publisher}`}>[{sources.get(id)!.number}]</a></span>)}</span>;
}
function Bars({ title, unit, rows, note, id, ceiling }: { ceiling?: number; title: string; unit: string; rows: {label: string; value: number}[]; note: string; id: string }) {
  const max = ceiling ?? (unit==='%' || unit.startsWith('euro ogni 100') ? 100 : Math.max(...rows.map(r=>r.value), 1));
  return <figure className={styles.figure} aria-labelledby={`${id}-caption`}>
    <figcaption id={`${id}-caption`}><strong>{title}</strong><span>{unit}</span></figcaption>
    <div className={styles.bars}>{rows.map((row, i) => <div className={styles.barRow} key={`${id}-${i}`}>
      <span>{row.label}</span><strong>{readerNumber(row.value, Number.isInteger(row.value) ? 0 : 2)}</strong>
      <span className={styles.track} aria-hidden="true"><span style={{width:`${row.value/max*100}%`}} /></span>
    </div>)}</div><p className={styles.figureNote}>{note}</p>
  </figure>;
}
function Chart({ chart, id }: { chart: ReaderChart; id: string }) {
  return <Bars {...chart} rows={chart.rows.map(r=>({label:r.label,value:Number(readerValue(report,r.metric))}))} id={id} />;
}
function Context({ context, technical = true }: { context: AuditContext; technical?: boolean }) {
  return <div className={styles.prose}>{context.paragraphs.map(p=><p key={p}>{p}</p>)}<Sources ids={context.sourceIds} />{technical && <details className={styles.details}><summary>Perimetro e definizioni</summary><p>{context.technical}</p></details>}</div>;
}
function Case({ item }: { item: ReaderCase }) {
  const index = report.cases.findIndex(c=>c.id===item.id);
  return <section className={styles.case} id={item.id} data-kind={item.kind} aria-labelledby={`${item.id}-title`}>
    <div className={styles.caseHeader}><p className={styles.eyebrow}>{String(index+1).padStart(2,'0')} · {report.kindLabels[item.kind]}</p><h3 id={`${item.id}-title`}>{item.title}</h3><p className={styles.period}>{item.period}</p></div>
    <div className={styles.caseLayout}><div className={styles.prose}><p className={styles.lead}>{item.lead}</p>{item.paragraphs.map(p=><p key={p}>{p}</p>)}<div className={styles.conclusion}><h4>Il punto</h4><p>{item.conclusion}</p></div><p className={styles.improvement}><strong>La correzione utile.</strong> {item.improve}</p><Sources ids={item.sourceIds} /></div>
      <aside className={styles.caseNumbers} aria-label={`Numero principale: ${item.title}`}><p className={styles.stat}>{item.number}</p><p>{item.numberLabel}</p>{item.chart && <Chart chart={item.chart} id={`chart-${item.id}`} />}</aside></div>
    {item.math && <div className={styles.mathIntro}><h4>Come leggere il calcolo</h4><p>{item.math.explanation}</p></div>}
    <details className={styles.details}><summary>Dati e fonti di questo riscontro<span className="sr-only">: {item.title}</span></summary>
      {item.math && <div className={styles.formulas}>{item.math.calculationIds.map(id=>{const c=report.calculations.find(x=>x.id===id)!;return <p key={id}><strong>{c.label}</strong><br/>{readerCalculationText(report,c)}</p>;})}</div>}
      {item.math && item.math.rows.length>0 && <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Numeratori e denominatori del confronto"><table><caption>Come cambia il confronto escludendo il contratto RTI</caption><thead><tr><th scope="col">Confronto</th><th scope="col">Importo associato</th><th scope="col">Totale confrontato</th><th scope="col">Quota</th></tr></thead><tbody>{item.math.rows.map(row=><tr key={row.label}><th scope="row">{row.label}</th><td>{readerNumber(readerValue(report,row.numerator))} €</td><td>{readerNumber(readerValue(report,row.denominator))} €</td><td>{readerNumber(readerValue(report,row.result))}%</td></tr>)}</tbody></table></div>}
      <ul className={styles.sourceList}>{item.sourceIds.map(id=>{const source=sources.get(id)!;return <li key={id}><a href={source.url}>{source.publisher}: {source.title}</a><p>{source.locator}</p></li>;})}</ul>
    </details>
  </section>;
}
function History() {
  const rows=report.audit.history;
  const x=(i:number)=>56+i*62;
  const y=(value:number)=>230-value/220000*185;
  const path=(key:'totalMillion'|'capitalMillion'|'currentMillion')=>rows.map((r,i)=>`${i===0?'M':'L'}${x(i)},${y(r[key])}`).join(' ');
  return <figure className={styles.history} aria-labelledby="history-caption"><figcaption id="history-caption"><strong>Residui delle spese finali, 2015-2024</strong><span>Stock al 31 dicembre · miliardi di euro nominali</span></figcaption>
    <svg viewBox="0 0 660 275" role="img" aria-labelledby="history-svg-title history-svg-desc"><title id="history-svg-title">Dieci anni di residui passivi dello Stato</title><desc id="history-svg-desc">Il totale passa da 109,69 a 187,96 miliardi, con una discontinuità nel 2020. Tutti i valori sono nella tabella seguente.</desc>
      {[0,50,100,150,200].map(v=><g key={v}><line x1="56" y1={y(v*1000)} x2="624" y2={y(v*1000)} className={styles.gridLine}/><text x="44" y={y(v*1000)+4} textAnchor="end">{v}</text></g>)}
      <path d={path('totalMillion')} className={styles.historyTotal}/><path d={path('capitalMillion')} className={styles.historyCapital}/><path d={path('currentMillion')} className={styles.historyCurrent}/>
      {rows.map((r,i)=><g key={r.year}><circle cx={x(i)} cy={y(r.totalMillion)} r="3" className={styles.historyDot}/><text className={i % 3 === 0 ? styles.historyYearMajor : styles.historyYearMinor} x={x(i)} y="256" textAnchor="middle">{r.year}</text></g>)}
    </svg><p className={styles.legend}><span>● Totale</span><span>━ Conto capitale</span><span>┄ Spese correnti</span></p>
    <p className={styles.figureNote}>Scala da zero. Il salto non identifica da solo uno spreco: cambiano le regole e intervengono le misure pandemiche.</p>
    <details className={styles.details}><summary>Dieci anni di dati</summary><div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Residui per anno"><table><caption>Milioni di euro, fonte Camera. Lo stock non va sommato tra anni.</caption><thead><tr><th scope="col">Anno</th><th scope="col">Totale</th><th scope="col">Correnti</th><th scope="col">Capitale</th><th scope="col">Nuova formazione</th></tr></thead><tbody>{rows.map(r=><tr key={r.year}><th scope="row">{r.year}</th><td>{readerNumber(r.totalMillion,0)}</td><td>{readerNumber(r.currentMillion,0)}</td><td>{readerNumber(r.capitalMillion,0)}</td><td>{readerNumber(r.newMillion,0)}</td></tr>)}</tbody></table></div></details>
  </figure>;
}
function SpendingReviewSection() {
  const sr = report.spendingReview;
  return <section id="spending-review" className={styles.section} aria-labelledby="spending-review-title">
    <div className={styles.sectionHeading}><p className={styles.eyebrow}>Dossier · Dalle proposte ai risultati</p><h2 id="spending-review-title">{sr.title}</h2></div>
    <div className={styles.prose}>{sr.intro.map(p=><p key={p}>{p}</p>)}</div>
    <div className={styles.reviewStages} aria-label="Come valutiamo una spending review">{sr.stages.map((st,i)=><div key={st.label}><span className={styles.eyebrow}>0{i+1}</span><h3>{st.label}</h3><p>{st.text}</p></div>)}</div>
    <div className={styles.contextCharts}>{sr.series.map(serie=><div key={serie.id}><Bars ceiling={40} id={`review-${serie.id}`} title={serie.title} unit={serie.unit+' · scala 0-40'} rows={serie.rows.map(row=>({label:`${row.year}${row.status==='previsione'?' (previsione)':row.status==='proposta'?' (proposta)':''}`,value:Number(readerValue(report,row.metric))}))} note={serie.note}/><Sources ids={serie.sourceIds}/></div>)}</div>
    <details className={styles.details}><summary>Dal 1981: commissioni, commissari e documenti prodotti</summary><p>{sr.scope}</p><ol className={styles.reviewTimeline}>{sr.chronology.map(era=><li key={era.period}><span className={styles.eyebrow}>{era.period} · {era.actor}</span><h3>{era.title}</h3><p>{era.text}</p><Sources ids={era.sourceIds}/></li>)}</ol></details>
    <div className={styles.reviewResult}><h3>{sr.result2024.title}</h3>{sr.result2024.paragraphs.map(p=><p className={styles.prose} key={p}>{p}</p>)}<Sources ids={sr.result2024.sourceIds}/>
    <Bars id="review-monitoring" title="205 piani gestionali, tre modi di leggerli" unit="numero di piani · esercizio 2024" rows={[{label:'Solo finalità oggetto di revisione',value:Number(readerValue(report,'sr-pg-dedicated'))},{label:'Più finalità nello stesso conto',value:Number(readerValue(report,'sr-pg-composite'))},{label:'Fondi da ripartire',value:Number(readerValue(report,'sr-pg-funds'))}]} note="Sono piani del monitoraggio 2024, non tutte le voci di bilancio. Non li dividiamo per le 5.395 righe a capitolo del rendiconto 2025: anno e livello contabile sono diversi."/>
    </div>
    <h3>Otto temi, un seguito documentale</h3><div className={styles.reviewTracker}>{sr.tracker.map(t=><details className={styles.details} key={t.theme}><summary>{t.theme}<span className={styles.reviewStatus}>{t.status}</span></summary><p><strong>La proposta.</strong> {t.proposal}</p><p><strong>Il seguito.</strong> {t.result}</p><p><strong>La misura utile.</strong> {t.measure}</p><Sources ids={t.sourceIds}/>{t.caseId && <p><a href={`#${t.caseId}`}>Leggi la scheda con dati e calcoli</a></p>}</details>)}</div>
    <p className={styles.reviewConclusion}>{sr.conclusion}</p>
    <details className={styles.details}><summary>Apri i {sr.documents.length} documenti e percorsi d’archivio</summary><p>Qui trovi i testi originali, le copie reperite e i cataloghi. La modalità di lettura è indicata per ogni voce.</p><ol className={styles.reviewDocuments}>{sr.documents.map(d=><li key={d.id}><span className={styles.eyebrow}>{d.period} · {d.reading}</span><h3><a href={d.url}>{d.title}</a></h3><p>{d.use}</p></li>)}</ol><a href="/data/reports/spending-review-documents.csv" download>Scarica il catalogo (CSV)</a></details>
    <details className={styles.details}><summary>Che cosa i documenti non consentono di affermare</summary>{sr.corrections.map(c=><div key={c.claim}><h3>{c.claim}</h3><p>{c.finding}</p></div>)}{sr.notReconstructed.map(p=><p key={p}>{p}</p>)}</details>
  </section>;
}
export default function StateBudgetReport() {
  validateReaderSnapshot(report, queryEurostatCofog({geo:'IT',year:report.macro.year}).observations);
  const a=report.audit;
  const sectors=[...report.sectors].sort((x,y)=>Number(y.amountCents)-Number(x.amountCents));
  const ranking=[...a.ministries].sort((x,y)=>Number(y.remainingCpCents)/Number(y.commitmentsCpCents)-Number(x.remainingCpCents)/Number(x.commitmentsCpCents));
  const highlights=['discariche','bonus-edilizi','inps-registrazioni'].map(id=>report.cases.find(c=>c.id===id)!);
  return <main className={`shell ${styles.report}`}>
    <nav className={styles.breadcrumb} aria-label="Percorso"><Link href="/report">Report</Link><span aria-hidden="true"> / </span><span>Bilancio e spesa pubblica</span></nav>
    <article>
      <header className={styles.hero}>
        <div className={styles.brand}><Image src="/brand/icon-48.png" width={36} height={36} alt="" aria-hidden="true"/><span>DoveVannoINostriSoldi</span></div>
        <p className={styles.eyebrow}>Dossier · <time dateTime={report.modifiedOn}>15 settembre 2026</time></p>
        <h1>{report.title}</h1><p className={styles.dek}>{report.summary}</p>
        <div className={styles.actions}><a className={styles.primaryAction} href="#soldi-in-entrata">Segui i soldi</a><a href={report.pdfPath} download>Scarica il rapporto PDF</a><a href="#riscontri">Vai ai riscontri</a><a href="#spending-review">Spending review dal 1981</a></div>
      </header>
      <section className={styles.brief} aria-labelledby="in-breve-title"><h2 id="in-breve-title">Non basta sapere quanto spendiamo</h2><p className={styles.prose}>{report.lead}</p><div className={styles.highlights}>{highlights.map(c=><a key={c.id} href={`#${c.id}`}><span className={styles.eyebrow}>{report.kindLabels[c.kind]}</span><strong>{c.number}</strong><span className={styles.highlightTitle}>{c.title}</span><small>{c.numberLabel}. {c.period}.</small></a>)}</div><p className={styles.limit}>Tre problemi diversi, non un totale da sommare. Le fonti distinguono importi pagati, stime e correzioni contabili.</p></section>
      <section id="soldi-in-entrata" className={styles.section} aria-labelledby="entrate-stato-title"><div className={styles.sectionHeading}><p className={styles.eyebrow}>01 · Il bilancio dello Stato</p><h2 id="entrate-stato-title">{a.funding.title}</h2></div>
        <div className={styles.flow} aria-label="Bilancio dello Stato 2025, competenza finanziaria"><div><span>Entrate finali accertate</span><strong>{readerNumber(Number(readerValue(report,'state-revenue'))/1000)} <small>mld €</small></strong><span>Crediti riconosciuti, non solo incassi</span></div><span className={styles.flowArrow} aria-hidden="true">→</span><div><span>Spese finali</span><strong>{readerNumber(Number(readerValue(report,'state-final'))/1000)} <small>mld €</small></strong><span>Esclusi i rimborsi del debito</span></div><span className={styles.flowArrow} aria-hidden="true">→</span><div><span>Saldo netto da finanziare</span><strong>{readerNumber(Number(readerValue(report,'state-balance'))/1000)} <small>mld €</small></strong><span>Non è il deficit europeo</span></div></div>
        <Context context={a.funding}/><div className={styles.contextCharts}><Bars id="chart-revenue" title="Da dove arrivano le entrate" unit="miliardi € · accertamenti 2025" rows={['state-tax','state-other','state-assets'].map((key,i)=>({label:['Imposte','Entrate non tributarie','Alienazioni e riscossione crediti'][i],value:Number(readerValue(report,key))/1000}))} note="Entrate finali. Prestiti e altre operazioni di finanziamento restano separati."/><Bars id="chart-spending" title="Come si compone la spesa finale" unit="miliardi € · competenza 2025" rows={['state-current','state-interest','state-capital'].map((key,i)=>({label:['Spese correnti senza interessi','Interessi','Conto capitale'][i],value:Number(readerValue(report,key))/1000}))} note="Gli interessi sono separati dalle altre spese correnti. Non aggiungiamo il rimborso dei prestiti."/></div>
      </section>
      <section id="pagamenti" className={styles.section} aria-labelledby="pagamenti-title"><div className={styles.sectionHeading}><p className={styles.eyebrow}>02 · Dal conto al pagamento</p><h2 id="pagamenti-title">{a.execution.title}</h2></div><Context context={a.execution}/>
        <figure className={styles.execution} aria-labelledby="execution-caption"><figcaption id="execution-caption"><strong>Quota degli impegni 2025 rimasta da pagare</strong><span>Scala 0-100% · valore non pagato in miliardi, accanto alla quota</span></figcaption><div className={styles.executionGrid}>{ranking.map(r=><div className={styles.barRow} key={r.code}><span>{r.label}</span><strong>{readerNumber(readerShare(r.remainingCpCents,r.commitmentsCpCents))}% <small>· {readerBillions(r.remainingCpCents)} mld</small></strong><span className={styles.track} aria-hidden="true"><span style={{width:`${readerShare(r.remainingCpCents,r.commitmentsCpCents)}%`}}/></span></div>)}</div><p className={styles.figureNote}>Indicatore di esecuzione, non classifica di sprechi. Un impegno può avere scadenze successive; il Ministero della Salute non rappresenta tutta la sanità.</p></figure>
        <details className={styles.details}><summary>Importi esatti e 52 riconciliazioni contabili</summary><div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Aggregati dei quindici ministeri"><table><caption>Euro, competenza 2025. Impegni = pagamenti CP + rimasto CP.</caption><thead><tr><th scope="col">Ministero</th><th scope="col">Impegni</th><th scope="col">Pagato CP</th><th scope="col">Rimasto CP</th></tr></thead><tbody>{a.ministries.map(r=><tr key={r.code}><th scope="row">{r.label}</th><td>{readerNumber(Number(r.commitmentsCpCents)/100)}</td><td>{readerNumber(Number(r.paymentsCompetenceCpCents)/100)}</td><td>{readerNumber(Number(r.remainingCpCents)/100)}</td></tr>)}</tbody></table></div><p>Tre identità per ciascuno dei 15 ministeri e sette somme di colonna coincidono al centesimo. Sono stati analizzati gli aggregati acquisiti, non le 5.395 righe originali a capitolo.</p><a href="/data/reports/state-budget-ministries-2025.csv" download>Scarica i 105 importi e le sette colonne</a></details>
      </section>
      <section id="decennio" className={styles.section} aria-labelledby="decennio-title"><div className={styles.sectionHeading}><p className={styles.eyebrow}>03 · Il tempo conta</p><h2 id="decennio-title">{a.historyIntro.title}</h2></div><Context context={a.historyIntro}/><History/></section>
      <SpendingReviewSection/>
      <section id="riscontri" className={styles.section} aria-labelledby="riscontri-title"><div className={styles.sectionHeading}><p className={styles.eyebrow}>04 · Dalle anomalie alle evidenze</p><h2 id="riscontri-title">Che cosa non funziona, e perché</h2><p className={styles.prose}>Ora seguiamo i casi: prima i costi evitabili, poi i risultati mancati e gli interventi riusciti, i crediti e gli errori nei documenti. Ogni importo conserva la propria data e il proprio significato.</p></div>
        <details className={styles.details}><summary>Indice dei {report.cases.length} riscontri</summary><nav className={styles.contents} aria-label="Indice dei riscontri"><ol>{report.cases.map(c=><li key={c.id}><a href={`#${c.id}`}>{c.title}</a></li>)}</ol></nav></details>
        {report.chapters.slice(0,3).map((ch,i)=><section className={styles.chapter} id={ch.id} key={ch.id} aria-labelledby={`${ch.id}-title`}><div className={styles.chapterHeading}><p className={styles.eyebrow}>Percorso {i+1}</p><h2 id={`${ch.id}-title`}>{ch.title}</h2><p>{ch.intro}</p></div>{ch.id==='crediti-e-riscossione' && <div className={styles.creditContext}><h3>{a.inpsContext.title}</h3><Context context={a.inpsContext}/><Bars id="chart-inps-portfolio" title="Perché 135,2 miliardi non sono tutti incassabili" unit="miliardi € · stock ADER-INPS a fine 2024" rows={a.portfolios.map(r=>({label:r.label,value:Number(r.billion)}))} note="Le categorie ricostruiscono il totale. Potenziale recupero lordo non significa incasso garantito."/></div>}{ch.caseIds.map(id=><Case item={report.cases.find(c=>c.id===id)!} key={id}/>)}</section>)}
      </section>
      <section id="estero" className={styles.section} aria-labelledby="estero-title"><div className={styles.sectionHeading}><p className={styles.eyebrow}>05 · Una domanda dei lettori</p><h2 id="estero-title">{a.foreign.title}</h2></div><Context context={a.foreign}/><Bars id="chart-foreign" title="Le risorse iniziali per l’aiuto pubblico allo sviluppo" unit="milioni € · stanziamenti 2024" rows={a.foreignRows.map(r=>({label:r.label,value:Number(r.million)}))} note="Non sono pagamenti eseguiti all’estero. Perimetro APS distinto dal bilancio MAECI e dallo Strumento europeo per la pace."/></section>
      <section id="dati-che-non-tornano" className={styles.section} aria-labelledby="dati-che-non-tornano-title"><div className={styles.sectionHeading}><p className={styles.eyebrow}>06 · L’affidabilità dei documenti</p><h2 id="dati-che-non-tornano-title">{report.chapters[3].title}</h2><p className={styles.prose}>{report.chapters[3].intro}</p></div>{report.chapters[3].caseIds.map(id=><Case item={report.cases.find(c=>c.id===id)!} key={id}/>)}</section>
      <section className={styles.closing} aria-labelledby="conclusione-title"><p className={styles.eyebrow}>Il risultato dell’analisi</p><h2 id="conclusione-title">Correggere il meccanismo, non soltanto il numero</h2><p>{a.readerOutcome}</p><a href={report.pdfPath} download>Leggi il rapporto con grafici, tabelle e calcoli</a></section>
      <section id="quadro-spesa" className={styles.section} aria-labelledby="quadro-title"><div className={styles.sectionHeading}><p className={styles.eyebrow}>Contesto · L’intera spesa pubblica</p><h2 id="quadro-title">Lo Stato non è tutta la pubblica amministrazione</h2></div><p className={styles.prose}>{report.macro.note}</p><p className={styles.total}>{readerBillions(report.macro.totalCents)} <span>miliardi € · {report.macro.year} · {readerNumber(report.macro.gdpPercent,1)}% del PIL</span></p><Sources ids={[report.macro.sourceId]}/><Bars id="chart-cofog" title="Dove vanno 100 euro di spesa pubblica" unit="euro ogni 100 · amministrazioni pubbliche, non solo Stato" rows={sectors.map(s=>({label:s.label,value:Number(readerShare(s.amountCents,report.macro.totalCents))}))} note="Una funzione più grande non è necessariamente meno efficiente. Le quote derivano da dieci importi che riconciliano il totale."/>
        <details className={styles.details}><summary>Le dieci funzioni e i servizi locali</summary><div className={styles.sectorGrid}>{sectors.map(s=><section className={styles.sector} id={`settore-${s.code.toLowerCase()}`} key={s.code}><h3>{s.label} · {readerBillions(s.amountCents)} mld €</h3><p>{s.note}</p><p>{s.reading}</p></section>)}</div><h3>{report.municipal.title}</h3>{report.municipal.paragraphs.map(p=><p key={p}>{p}</p>)}<div className={styles.contextCharts}>{report.municipal.charts.map((chart,i)=><Chart key={chart.title} chart={chart} id={`chart-municipal-${i}`}/>)}</div><Sources ids={report.municipal.sourceIds}/></details>
      </section>
      <section id="copertura" className={styles.section} aria-labelledby="copertura-title"><div className={styles.sectionHeading}><h2 id="copertura-title">Metodo, copertura e dati</h2></div>{report.method.map(p=><p className={styles.prose} key={p}>{p}</p>)}<details className={styles.details}><summary>Ipotesi scartate e materiali non usati come prova</summary>{a.exclusions.map(x=><div key={x.title}><h3>{x.title}</h3><p>{x.reason}</p></div>)}</details><details className={styles.details}><summary>Le parole del bilancio</summary><dl className={styles.glossary}>{report.glossary.map(g=><div key={g.term}><dt>{g.term}</dt><dd>{g.definition}</dd></div>)}</dl></details><div className={styles.downloads}><a href="/data/reports/state-budget-reader.json" download>Contenuti e calcoli (JSON)</a><a href="/data/reports/state-budget-reader.csv" download>Riscontri (CSV)</a><a href="/data/reports/state-budget-audit.json" download>Esito dei controlli (JSON)</a><a href="/data/reports/state-budget-residuals-2015-2024.csv" download>Decennio (CSV)</a><a href={report.legacyEvidenceUrl}>Prove della prima analisi</a></div></section>
      <section className={styles.section} id="fonti" aria-labelledby="fonti-title"><div className={styles.sectionHeading}><h2 id="fonti-title">Fonti</h2></div><ol className={styles.bibliography}>{report.sources.map(s=><li id={`source-${s.id}`} key={s.id}><a href={s.url}><strong>{s.publisher}</strong>: {s.title}</a><p>{s.locator}</p><details><summary>Periodo e consultazione</summary><p>Periodo: {s.period}. Pubblicazione: {s.publishedOn??'non indicata'}. Consultazione: {s.checkedOn}.</p><p>{s.access}</p></details></li>)}</ol></section>
    </article>
  </main>;
}
