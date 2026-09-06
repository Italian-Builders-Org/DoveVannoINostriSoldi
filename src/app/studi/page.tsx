import type { Metadata } from "next";
import Link from "next/link";
import { studies } from "@/lib/studies";
import styles from "./studies.module.css";

export const metadata: Metadata = {
  title: "Studi e working paper",
  description: "Ricerche occasionali sui dati pubblici: una domanda precisa, un metodo esplicito e risultati riproducibili.",
  alternates: { canonical: "/studi" },
};

export default function StudiesPage() {
  return <main className={`shell page ${styles.page}`}>
    <header className={styles.intro}>
      <span className={styles.eyebrow}>Ricerca civica · Pubblicazioni</span>
      <h1>Studi e working paper</h1>
      <p>Una domanda che merita tempo. Dati verificabili, analisi e limiti espliciti per capire come le risorse pubbliche diventano risultati.</p>
      <p className={styles.meta}>Uscite occasionali, distinte dagli articoli mensili. Ogni studio conserva il proprio periodo di osservazione, le versioni e i materiali per riprodurre i risultati.</p>
    </header>
    {studies.map(study => <article className={styles.card} key={study.slug}>
      <p className={styles.eyebrow}>PNRR · Prima infanzia · Working paper {study.version}</p>
      <h2><Link href={study.path}>{study.title}</Link></h2>
      <p>{study.subtitle}</p>
      <p>{study.description}</p>
      <p className={styles.meta}>Revisione 6 settembre 2026 · Dati al 13 giugno 2026 · Analisi descrittiva</p>
      <div className={styles.actions}>
        <Link href={study.path} className="btn btn-primary">Leggi lo studio</Link>
        <a href={`${study.assetPath}/dai-fondi-ai-posti.pdf`} download>Scarica il PDF · v{study.version}</a>
      </div>
    </article>)}
    <aside className={styles.note}>Un working paper è un lavoro aperto a verifica e revisione, non una certificazione dei risultati né una pubblicazione sottoposta a peer review. Le revisioni devono rendere visibili correzioni e cambiamenti del perimetro.</aside>
  </main>;
}
