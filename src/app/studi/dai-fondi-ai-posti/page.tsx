import type { Metadata } from "next";
import Link from "next/link";
import { childcareStudy as study } from "@/lib/studies";
import styles from "../studies.module.css";

const count = (n: number) => new Intl.NumberFormat("it-IT", { useGrouping: "always" }).format(n);
const pct = (n: number) => new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 1 }).format(n);
export const metadata: Metadata = {
  title: `${study.title} · Studi`,
  description: study.description,
  alternates: { canonical: study.path },
  openGraph: { type: "article", title: study.title, description: study.description, url: study.path, modifiedTime: study.revisedAt },
};

export default function ChildcareStudyPage() {
  const source = study.reproducibilityUrl;
  return <main className={`shell page ${styles.page}`}>
    <Link href="/studi">← Tutti gli studi</Link>
    <header className={styles.intro}>
      <p className={styles.eyebrow}>Paper di ricerca {study.version} · PNRR e prima infanzia</p>
      <h1>{study.title}</h1>
      <p>{study.subtitle}</p>
      <p className={styles.meta}>DoveVannoINostriSoldi · Revisione <time dateTime={study.revisedAt}>6 settembre 2026</time><br />
        Fotografia di attuazione: <time dateTime={study.source.reference_date}>13 giugno 2026</time> · Benchmark ISTAT: 2023/24</p>
      <div className={styles.actions}>
        <a href={`${study.assetPath}/dai-fondi-ai-posti.pdf`} className="btn btn-primary" download>Scarica il paper PDF</a>
        <a href="#materiali">Dati e riproduzione</a>
      </div>
    </header>
    <aside className={styles.note}><strong>Cosa misura davvero.</strong> Finanziamenti e avanzamento amministrativo, non posti nido aperti. La data della revisione non aggiorna la fotografia dei cantieri. Non possiamo verificare da questi dati il raggiungimento del target europeo.</aside>
    <dl className={styles.stats}>
      <div><dt>Progetti classificati ASILI NIDO</dt><dd>{count(study.source.projects_primary_sample)}</dd></div>
      <div><dt>Registrati come conclusi</dt><dd>{pct(study.headline.concluded_share)}</dd></div>
      <div><dt>Conclusi oppure in collaudo</dt><dd>{pct(study.headline.commissioning_or_concluded_share)}</dd></div>
    </dl>
    <section className={styles.section}>
      <h2>La domanda: dove si arriva alla consegna?</h2>
      <p>Assegnare risorse ai territori meno coperti non assicura che il servizio diventi disponibile allo stesso ritmo. Incrociamo i progetti Italia Domani con la copertura regionale ISTAT per distinguere allocazione, maturità amministrativa e risultato fisico.</p>
      <p>Il perimetro principale contiene solo i nidi: {count(study.source.projects_primary_sample)} progetti e {count(study.source.tenders_primary_sample)} righe procedura. La misura completa 0-6, con {count(study.source.projects_full_measure)} progetti, resta un controllo di sensibilità, non il denominatore delle percentuali mostrate qui.</p>
    </section>
    <section className={styles.section} aria-labelledby="pipeline">
      <h2 id="pipeline">Quasi metà è almeno in collaudo. Non significa metà dei posti.</h2>
      <figure>
        <div className={styles.bars}>
          {study.pipeline.map(row => <div key={row.maturity}>
            <div className={styles.barLabel}><span>{row.maturity}</span><span>{count(row.projects)} · {pct(row.project_share)}</span></div>
            <div className={styles.track} aria-hidden="true"><div className={styles.fill} style={{ width: `${row.project_share * 100}%` }} /></div>
          </div>)}
        </div>
        <figcaption className={styles.meta}>Stati mutuamente esclusivi; denominatore: {count(study.source.projects_primary_sample)} progetti. Fonte: Italia Domani tramite DVNS, 13 giugno 2026. Collaudo non equivale a apertura o certificazione dei posti.</figcaption>
      </figure>
    </section>
    <section className={styles.section}>
      <h2>Più fondi dove la copertura è minore, ma maturità diversa</h2>
      <p>Nei gruppi regionali sotto il 33% di copertura, circa il 37-43% del finanziamento totale è associato a progetti conclusi o in collaudo; sopra il 33%, circa il 58-59%. Questo è un confronto tra portafogli, non una misura dei divari di servizio effettivamente ridotti.</p>
      <p>La copertura 2023/24 è successiva all’avvio del PNRR e include offerta pubblica e privata: non è una baseline pre-intervento. I controlli escludendo una regione alla volta verificano l’influenza dei singoli territori, senza rendere causali le correlazioni.</p>
    </section>
    <section className={styles.section}>
      <h2>Gli affidamenti diretti: numero e valore raccontano cose diverse</h2>
      <div className={styles.tableWrap} role="region" aria-label="Procedure per numero e valore" tabIndex={0}>
        <table className={styles.table}>
          <caption>Righe procedura e importi a base osservati</caption>
          <thead><tr><th scope="col">Modalità</th><th scope="col">Righe</th><th scope="col">Quota numero</th><th scope="col">Quota valore</th></tr></thead>
          <tbody>{study.procurement.map(row => <tr key={row.procedure_group}><th scope="row">{row.procedure_group}</th><td>{count(row.procedures)}</td><td>{pct(row.number_share)}</td><td>{pct(row.value_share)}</td></tr>)}</tbody>
        </table>
      </div>
      <p className={styles.meta}>Gli importi a base non sono pagamenti né importi aggiudicati. Le righe non deduplicano le relazioni economiche tra accordi quadro e contratti derivati: il valore non è una stima del mercato unico dei lavori.</p>
    </section>
    <section className={styles.section}>
      <h2>Cosa serve per verificare il risultato</h2>
      <p>Un registro pubblico che colleghi ogni CUP ai posti previsti, completati, certificati e attivati, con date, autorizzazioni e capacità operativa. Lo storico delle fasi dovrebbe conservare anche correzioni e revoche. Solo così si passa dal monitoraggio amministrativo alla valutazione dell’efficacia.</p>
      <p>Il paper include modelli descrittivi, curve dei tempi, controlli di sensibilità e una proposta di monitoraggio. Non identifica sprechi, responsabilità individuali o effetti causali; non è una graduatoria delle amministrazioni.</p>
      <Link href="/coesione/asili">Esplora i progetti e le fonti aggiornate →</Link>
    </section>
    <section className={styles.section} id="materiali">
      <h2>Materiali, versione e verificabilità</h2>
      <ul>
        <li><a href={`${study.assetPath}/dai-fondi-ai-posti.pdf`} download>Paper completo · PDF v{study.version}</a></li>
        <li><a href={`${study.assetPath}/regioni.csv`} download>Tabella regionale · CSV</a></li>
        <li><a href={`${study.assetPath}/sensibilita.json`} download>Controlli di sensibilità · JSON</a></li>
        <li><a href={source}>Codice, LaTeX, dizionario e manifest delle fonti</a></li>
        <li><Link href="/mcp">Interrogare il catalogo tramite MCP</Link></li>
      </ul>
      <p className={styles.meta}>Versione 1.2: corretti il riferimento temporale ISTAT, una mediana e una citazione; aggiunti controlli regionali e sui denominatori. Snapshot invariato. Studio assistito da IA; non sottoposto a peer review esterna.</p>
      <details><summary>Impronte SHA-256</summary>
        <p className={styles.hash}>Snapshot: <code>{study.source.snapshot_sha256}</code></p>
        <p className={styles.hash}>PDF v{study.version}: <code>{study.assets["dai-fondi-ai-posti.pdf"].sha256}</code></p>
      </details>
    </section>
  </main>;
}
