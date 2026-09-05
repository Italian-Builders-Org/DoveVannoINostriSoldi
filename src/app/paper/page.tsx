import type { Metadata } from "next";
import Link from "next/link";
import { papers } from "@/lib/papers";
import { PUBLIC_SITE_URL } from "@/lib/site";
import styles from "./paper.module.css";

const description = "Studi e working paper sui dati pubblici italiani: domande di ricerca, metodi, risultati, limiti e materiali riproducibili.";
export const metadata: Metadata = {
  title: "Paper e ricerca",
  description,
  alternates: { canonical: `${PUBLIC_SITE_URL}/paper` },
  openGraph: { type: "website", title: "Paper e ricerca", description, url: `${PUBLIC_SITE_URL}/paper`, locale: "it_IT" },
};

export default function PapersPage() {
  const published = papers.listPublished();
  return <main className={`shell page ${styles.page}`}>
    <header className="page-intro"><h1>Paper e ricerca</h1><p>Studi per approfondire una domanda sui soldi pubblici, con il tempo necessario per verificarla. Li pubblichiamo quando sono pronti, senza una cadenza fissa.</p></header>
    <section aria-labelledby="papers-title"><h2 id="papers-title">Paper pubblicati</h2>
      {published.length === 0 ? <div className="panel"><h3>Il primo studio è in preparazione</h3><p>Non ci sono ancora paper pubblicati. Questa pagina ospiterà gli studi completati e i relativi materiali di verifica.</p><p>Le bozze non fanno parte del catalogo pubblico.</p></div> : published.map((paper) => <article className="panel" key={paper.slug} id={paper.slug}>
        <h3>{paper.title}</h3><p>{paper.authors.join(", ")} · <time dateTime={paper.publishedOn}>{new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${paper.publishedOn}T00:00:00Z`))}</time> · Versione {paper.version}</p>
        <p>{paper.abstract}</p><p><strong>Limiti dello studio.</strong> {paper.limitations}</p>
        <p><a href={paper.pdfUrl}>Leggi il paper «{paper.title}» (PDF)</a></p><p><a href={paper.reproducibilityUrl}>Dati, codice e registro delle versioni di «{paper.title}»</a></p>
        <details><summary>Verifica del PDF</summary><p>SHA-256: <code>{paper.pdfSha256}</code></p></details>
      </article>)}
    </section>
    <section className={styles.method} aria-labelledby="papers-method"><h2 id="papers-method">Che cosa troverai in ogni studio</h2><p>Una domanda precisa, un metodo esplicito e risultati accompagnati dai loro limiti. Autori, data, versione del documento e materiali riproducibili permetteranno di seguirne la provenienza.</p><p>Un working paper è un lavoro di ricerca: non implica una revisione accademica esterna. Le associazioni osservate nei dati non dimostrano da sole un rapporto di causa ed effetto.</p><Link href="/metodologia">Come leggiamo i dati</Link></section>
  </main>;
}
