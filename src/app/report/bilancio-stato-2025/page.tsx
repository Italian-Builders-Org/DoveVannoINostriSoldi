import type { Metadata } from "next";
import Link from "next/link";
import report from "@/content/reports/state-budget-2025.json";
import { PUBLIC_SITE_URL } from "@/lib/site";
import styles from "./report.module.css";

export const metadata: Metadata = {
  title: report.title,
  description: report.summary,
  alternates: { canonical: `${PUBLIC_SITE_URL}/report/${report.slug}` },
  openGraph: {
    type: "article",
    title: report.title,
    description: report.summary,
    publishedTime: report.date,
    url: `${PUBLIC_SITE_URL}/report/${report.slug}`,
  },
};

export default function StateBudgetReport() {
  const sources = new Map(report.sources.map((source) => [source.id, source]));
  return (
    <main className={`shell ${styles.report}`}>
      <nav aria-label="Percorso"><Link href="/report">Report</Link></nav>
      <article>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Analisi · <time dateTime={report.date}>14 settembre 2026</time></p>
          <h1>{report.title}</h1>
          <p className={styles.summary}>{report.summary}</p>
          <div className={styles.actions}>
            <a href="/report/bilancio-stato-2025.pdf" download>Scarica il PDF</a>
            <a href="#copertura">Copertura e metodo</a>
          </div>
        </header>

        <div className={styles.introduction}>{report.introduction.map((text) => <p key={text}>{text}</p>)}</div>
        <section className={styles.case} aria-labelledby="lettura-title">
          <h2 id="lettura-title">Come leggere importi e risultati</h2>
          {report.readingGuide.map((text) => <p key={text}>{text}</p>)}
        </section>
        <nav className={styles.contents} aria-label="Casi del rapporto">
          <ol>{report.cases.map((item) => <li key={item.id}><a href={`#${item.id}`}>{item.title}</a></li>)}</ol>
        </nav>

        {report.cases.map((item, index) => (
          <section className={styles.case} id={item.id} key={item.id} aria-labelledby={`${item.id}-title`}>
            <p className={styles.eyebrow}>{String(index + 1).padStart(2, "0")} · {item.label}</p>
            <h2 id={`${item.id}-title`}>{item.title}</h2>
            <p className={styles.finding}>{item.summary}</p>
            {item.paragraphs.map((text) => <p key={text}>{text}</p>)}
            <details>
              <summary>Fonti e calcolo<span className="sr-only">: {item.title}</span></summary>
              <p>{item.record}</p>
              <p className={styles.calculation}>{item.calculation}</p>
              <ul>{item.sourceIds.map((id) => {
                const source = sources.get(id)!;
                return <li key={id}><a href={source.url}>{source.publisher}: {source.title}</a>. {source.locator}</li>;
              })}</ul>
            </details>
            <p className={styles.next}><strong>Da verificare.</strong> {item.nextStep}</p>
          </section>
        ))}

        <section className={styles.case} aria-labelledby="controlli-title">
          <h2 id="controlli-title">Altre verifiche</h2>
          {report.controls.map((item) => <div key={item.text}>
            <p>{item.text}</p>
            <p>Fonti: {item.sourceIds.map((id, index) => <span key={id}>{index > 0 && "; "}<a href={`#source-${id}`}>{sources.get(id)!.publisher}: {sources.get(id)!.title}</a></span>)}.</p>
          </div>)}
        </section>
        <section className={styles.case} id="copertura" aria-labelledby="copertura-title">
          <h2 id="copertura-title">Copertura e metodo</h2>
          <dl className={styles.coverage}>{report.coverage.map((item) => <div key={item.area}><dt>{item.area}</dt><dd><p>{item.checked}</p><p>{item.limit}</p></dd></div>)}</dl>
          {report.method.map((text) => <p key={text}>{text}</p>)}
          <p><a href={report.evidenceUrl}>Dati, calcoli e istruzioni di riproduzione</a></p>
        </section>
        <section className={styles.case} aria-labelledby="fonti-title">
          <h2 id="fonti-title">Fonti</h2>
          <ol className={styles.sources}>{report.sources.map((source) => <li id={`source-${source.id}`} key={source.id}><a href={source.url}>{source.publisher}: {source.title}</a><p>{source.locator}</p></li>)}</ol>
        </section>
      </article>
    </main>
  );
}
