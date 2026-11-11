import Link from "next/link";
import { getCompanyAtlasView } from "@/lib/company-atlas";
import { getEducationAtlasView } from "@/lib/education-atlas";
import { parliamentSnapshot } from "@/lib/parliament-snapshot";
import { integer, longDate } from "@/lib/format";
import styles from "./home-pathways.module.css";

function PreviewBars({ points, format = integer }: Readonly<{
  points: readonly { label: string; value: number | null }[];
  format?: (value: number) => string;
}>) {
  const maximum = Math.max(0, ...points.map((point) => point.value ?? 0));
  return <ul className={styles.bars}>{points.map((point) => <li key={point.label}>
    <div><span>{point.label}</span><strong>{point.value === null ? "Non disponibile" : format(point.value)}</strong></div>
    {point.value !== null ? <span className={styles.track} aria-hidden="true"><span style={{ width: `${maximum > 0 ? point.value / maximum * 100 : 0}%` }} /></span> : null}
  </li>)}</ul>;
}

export function InstitutionsPreview() {
  const camera = parliamentSnapshot.chambers.find((chamber) => chamber.id === "camera");
  const accounts = (camera?.statements ?? []).filter((statement) => statement.kind === "account")
    .toSorted((a, b) => a.year - b.year).slice(-3);
  const latest = accounts.at(-1);
  return <div className={styles.preview}>
    <div className={styles.previewHeader}><span>Camera dei deputati</span><span>Consuntivi</span></div>
    <h3 className={styles.previewTitle}>I pagamenti nel tempo</h3>
    <p className={styles.metricNote}>Spesa effettiva · milioni di euro</p>
    <PreviewBars points={accounts.map((statement) => ({ label: String(statement.year), value: statement.values?.effectivePayments ?? null }))}
      format={(value) => value.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} />
    <p className={styles.source}>Pagamenti di competenza sui Titoli I, II e III. I bilanci di Senato e Quirinale hanno perimetri distinti.
      {latest ? <> <a href={latest.documentUrl} target="_blank" rel="noreferrer">Fonte: Camera dei deputati</a>.</> : null}
    </p>
    <div className={styles.institutionLinks}>
      <Link prefetch={false} href="/politici?istituzione=presidenza-repubblica">Presidenza della Repubblica <span aria-hidden="true">→</span></Link>
      <Link prefetch={false} href="/governi">Governi a confronto <span aria-hidden="true">→</span></Link>
      <Link prefetch={false} href="/parlamento">Bilanci di Camera, Senato e Quirinale <span aria-hidden="true">→</span></Link>
    </div>
  </div>;
}

/** Server-rendered projections of existing validated snapshots; no raw data in the client bundle. */
export function EconomyPreviews() {
  const companies = getCompanyAtlasView();
  const education = getEducationAtlasView();
  const companySource = companies.sources.find((source) => source.id === "active-stock");
  const educationSource = education.sources.find((source) => source.id === "students");
  return <div className={styles.atlasPreview}>
    <section className={styles.preview} aria-labelledby="home-company-title">
      <div className={styles.previewHeader}><h3 id="home-company-title">Imprese attive</h3><span>{companies.periodLabel}</span></div>
      <strong className={styles.mediumNumber}>{companies.nationalValue === null ? "Non disponibile" : integer(companies.nationalValue)}</strong>
      <p className={styles.metricNote}>Sedi di impresa in Italia · le tre regioni con più sedi</p>
      <PreviewBars points={companies.ranking.slice(0, 3).map((point) => ({ label: point.name, value: point.value }))} />
      <p className={styles.source}>{companySource ? <><a href={companySource.url} target="_blank" rel="noreferrer">{companySource.publisher}</a> · verificato {longDate(companySource.observedAt)}</> : "Fonte non disponibile"}</p>
      <Link prefetch={false} href="/imprese" className={styles.previewLink}>Confronta le regioni <span aria-hidden="true">→</span></Link>
    </section>
    <section className={styles.preview} aria-labelledby="home-education-title">
      <div className={styles.previewHeader}><h3 id="home-education-title">Studenti delle superiori</h3><span>{education.periodLabel}</span></div>
      <strong className={styles.mediumNumber}>{education.perimeterValue === null ? "Non disponibile" : integer(education.perimeterValue)}</strong>
      <p className={styles.metricNote}>Scuole statali e paritarie · i tre percorsi con più studenti</p>
      <PreviewBars points={education.pathwayBreakdown.toSorted((a, b) => (b.value ?? -1) - (a.value ?? -1)).slice(0, 3)} />
      <p className={styles.source}>
        {educationSource ? <a href={educationSource.landingUrl} target="_blank" rel="noreferrer">Ministero dell’Istruzione e del Merito</a> : "Fonte non disponibile"}.
        {education.missingRegionNames.length ? ` Copertura parziale: ${education.missingRegionNames.join(", ")} fuori dal perimetro.` : " Copertura nazionale."}
      </p>
      <Link prefetch={false} href="/istruzione" className={styles.previewLink}>Esplora i percorsi scolastici <span aria-hidden="true">→</span></Link>
    </section>
  </div>;
}
