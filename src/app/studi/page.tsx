import type { Metadata } from "next";
import Link from "next/link";
import { papers } from "@/lib/papers";
import { PUBLIC_SITE_URL } from "@/lib/site";
import styles from "./studies.module.css";

const description = "Ricerche occasionali sui dati pubblici: una domanda precisa, un metodo esplicito e risultati riproducibili.";
const date = new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeZone: "UTC" });

export const metadata: Metadata = {
  title: "Studi e working paper",
  description,
  alternates: { canonical: "/studi" },
  openGraph: { type: "website", title: "Studi e working paper", description, url: `${PUBLIC_SITE_URL}/studi`, locale: "it_IT" },
};

export default function StudiesPage() {
  const published = papers.listPublished();
  return <main className={`shell page ${styles.page}`}>
    <header className={styles.intro}>
      <span className={styles.eyebrow}>Ricerca civica · Pubblicazioni</span>
      <h1>Studi e working paper</h1>
      <p>Una domanda che merita tempo. Dati verificabili, analisi e limiti espliciti per capire come le risorse pubbliche diventano risultati.</p>
      <p className={styles.meta}>Uscite occasionali, distinte dagli articoli mensili. Ogni studio conserva il proprio periodo di osservazione, le versioni e i materiali per riprodurre i risultati.</p>
    </header>
    <section aria-labelledby="published-studies-title">
      <h2 id="published-studies-title">Studi pubblicati</h2>
      {published.length === 0 ? <p>Non ci sono ancora studi pubblicati. Le bozze restano fuori dal catalogo pubblico.</p> : published.map((paper) => {
        const pdfHref = paper.pdfUrl.startsWith(`${PUBLIC_SITE_URL}/`) ? paper.pdfUrl.slice(PUBLIC_SITE_URL.length) : paper.pdfUrl;
        return <article className={styles.card} key={paper.slug} id={paper.slug}>
          <p className={styles.eyebrow}>Working paper · Versione {paper.version}</p>
          <h3>{paper.webPath ? <Link href={paper.webPath}>{paper.title}</Link> : paper.title}</h3>
          <p className={styles.meta}>{paper.authors.join(", ")} · Pubblicato il <time dateTime={paper.publishedOn}>{date.format(new Date(`${paper.publishedOn}T00:00:00Z`))}</time></p>
          <p>{paper.abstract}</p>
          <p><strong>Limiti dello studio.</strong> {paper.limitations}</p>
          <div className={styles.actions}>
            {paper.webPath && <Link href={paper.webPath} className="btn btn-primary">Leggi lo studio</Link>}
            <a href={pdfHref} download>Scarica il PDF · v{paper.version}</a>
            <a href={paper.reproducibilityUrl}>Dati, codice e versioni</a>
          </div>
          <details><summary>Verifica del PDF</summary><p className={styles.hash}>SHA-256: <code>{paper.pdfSha256}</code></p></details>
        </article>;
      })}
    </section>
    <aside className={styles.note}>Un working paper è un lavoro aperto a verifica e revisione, non una certificazione dei risultati né una pubblicazione sottoposta a peer review. Le revisioni devono rendere visibili correzioni e cambiamenti del perimetro.</aside>
    <p><Link href="/metodologia">Come leggiamo i dati</Link></p>
  </main>;
}
