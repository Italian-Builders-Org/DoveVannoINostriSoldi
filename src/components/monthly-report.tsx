import Link from "next/link";
import { ArrowRight01Icon, Calendar03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { MonthlyReportFigure, formatReportValue } from "@/components/monthly-report-figure";
import {
  MONTHLY_REPORT_SERIES,
  issueMonthLabel,
  monthlyReportReadingMinutes,
  type MonthlyReportSummary,
  type PublishedMonthlyReport,
  type ReportSection,
} from "@/lib/monthly-reports-contract";
import styles from "./monthly-report.module.css";

const date = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function localDate(value: string): string {
  return date.format(new Date(`${value}T00:00:00Z`));
}

function TextSection({ section }: { section: ReportSection }) {
  return (
    <section className={styles.proseSection}>
      <h2>{section.title}</h2>
      {section.paragraphs.map((paragraph, index) => <p key={`${section.title}-${index}`}>{paragraph.text}</p>)}
    </section>
  );
}

export function MonthlyReportArticle({ report }: { report: PublishedMonthlyReport }) {
  const facts = new Map(report.facts.map((fact) => [fact.id, fact]));
  return (
    <main className={`shell ${styles.article}`}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/report">Report mensili</Link><span aria-hidden="true">/</span><span>{issueMonthLabel(report.issueMonth)}</span>
      </nav>
      <article>
        <header className={styles.articleHeader}>
          <p className={styles.eyebrow}>{MONTHLY_REPORT_SERIES.title} · {issueMonthLabel(report.issueMonth)}</p>
          <h1>{report.title}</h1>
          <p className={styles.dek}>{report.dek}</p>
          <dl className={styles.publicationMeta}>
            <div><dt>Firma</dt><dd>{MONTHLY_REPORT_SERIES.byline}</dd></div>
            <div><dt>Pubblicato</dt><dd>{localDate(report.publication.publishedOn)}</dd></div>
            <div><dt>Tempo di lettura</dt><dd>{monthlyReportReadingMinutes(report)} min</dd></div>
            <div><dt>Dati verificati fino al</dt><dd>{localDate(report.publication.dataCutoff)}</dd></div>
          </dl>
        </header>

        <section className={styles.brief} aria-labelledby="in-breve-title">
          <h2 id="in-breve-title">In breve</h2>
          <div className={styles.factGrid}>
            {report.inBrief.map((id) => {
              const fact = facts.get(id)!;
              return <article key={id}><h3>{fact.label}</h3><strong>{formatReportValue(fact.value)}</strong><p>{fact.plainLanguage}</p><small>{fact.caveat}</small></article>;
            })}
          </div>
        </section>

        <div className={styles.prose}><TextSection section={report.lead} /></div>
        <MonthlyReportFigure figure={report.figures[0]} />
        <div className={styles.prose}><TextSection section={report.rubrics.numbers} /></div>
        <MonthlyReportFigure figure={report.figures[1]} />
        <div className={styles.prose}>
          <TextSection section={report.rubrics.territories} />
          <TextSection section={report.rubrics.signal} />
          <TextSection section={report.rubrics.sources} />
          <section className={styles.evidence} aria-labelledby="evidence-title">
            <h2 id="evidence-title">Schede delle fonti</h2>
            <ol>
              {report.evidence.map((item) => <li key={item.id}><a href={item.publicUrl}>{item.publisher} · {item.title}</a><p>Dataset: {item.datasetId}. Verificato il {localDate(item.checkedOn)}. {item.perimeter} {item.caveat}</p></li>)}
            </ol>
          </section>
          <TextSection section={report.rubrics.nextMonth} />
          {report.corrections.length > 0 && <section className={styles.corrections}><h2>Correzioni</h2><ul>{report.corrections.map((entry) => <li key={`${entry.publishedOn}-${entry.explanation}`}>{localDate(entry.publishedOn)}: {entry.explanation}</li>)}</ul></section>}
        </div>
      </article>
    </main>
  );
}

export function MonthlyReportsArchive({ reports }: { reports: readonly MonthlyReportSummary[] }) {
  return (
    <main className={`shell ${styles.archive}`}>
      <header><p className={styles.eyebrow}>Pubblicazione mensile</p><h1>{MONTHLY_REPORT_SERIES.title}</h1><p className={styles.dek}>Una storia principale e rubriche stabili per capire i dati pubblici del mese, con fonti e limiti sempre visibili.</p></header>
      <section aria-labelledby="editions-title"><h2 id="editions-title">Tutte le edizioni</h2><div className={styles.archiveGrid}>{reports.map((report) => <article key={report.issueMonth}><p className={styles.issueDate}><HugeiconsIcon icon={Calendar03Icon} size={18} aria-hidden="true" />{report.issueLabel}</p><h3><Link href={report.href}>{report.title}</Link></h3><p>{report.teaser}</p><small>Pubblicato il {localDate(report.publishedOn)} · {report.readingMinutes} min · cutoff {localDate(report.dataCutoff)}</small><Link className={styles.readLink} href={report.href}>Leggi il report <HugeiconsIcon icon={ArrowRight01Icon} size={18} aria-hidden="true" /></Link></article>)}</div></section>
    </main>
  );
}

export function LatestMonthlyReportTeaser({ report }: { report: MonthlyReportSummary }) {
  return (
    <section className={`panel ${styles.homeTeaser}`} aria-labelledby="monthly-report-teaser-title">
      <div><p className={styles.eyebrow}>{MONTHLY_REPORT_SERIES.title} · {report.issueLabel}</p><h2 id="monthly-report-teaser-title">{report.title}</h2><p>{report.teaser}</p><small>{report.readingMinutes} min · dati verificati fino al {localDate(report.dataCutoff)}</small></div>
      <Link className="btn" href={report.href}>Leggi il numero <HugeiconsIcon icon={ArrowRight01Icon} size={18} aria-hidden="true" /></Link>
    </section>
  );
}
