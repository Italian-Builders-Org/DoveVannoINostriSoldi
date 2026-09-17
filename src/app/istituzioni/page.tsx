import type { Metadata } from "next";
import Link from "next/link";
import styles from "./istituzioni.module.css";

export const metadata: Metadata = {
  title: "Istituzioni pubbliche",
  description:
    "Cinque percorsi separati per Parlamento, Palazzo Chigi, governi, Ministeri e Regioni, con periodo, perimetro e fonte visibili.",
};

const dossiers = [
  {
    href: "/parlamento",
    title: "Parlamento",
    period: "Camera: dati 2025 · documenti 2024 per Camera e Senato",
    description:
      "Bilanci e documenti di Camera e Senato, con la copertura disponibile per ciascuna istituzione.",
  },
  {
    href: "/palazzo-chigi",
    title: "Palazzo Chigi",
    period: "Rendiconto PCM 2024",
    description:
      "Impegni e pagamenti della Presidenza del Consiglio, con il rendiconto ufficiale scaricabile.",
  },
  {
    href: "/governi",
    title: "Pagella dei governi",
    period: "Indicatori dal 1995 · storia dei governi precedenti",
    description:
      "Indicatori economici, confronto europeo e contesto per ciascun governo.",
  },
  {
    href: "/ministeri",
    title: "Ministeri",
    period: "Rendiconto dello Stato 2025",
    description:
      "Impegni, pagamenti e somme ancora da pagare di 15 ministeri.",
  },
  {
    href: "/regioni",
    title: "Regioni",
    period: "Consuntivi Istat 2024",
    description:
      "Impegni di 22 Regioni e Province autonome, suddivisi per voce di bilancio.",
  },
] as const;

export default function InstitutionsPage() {
  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Istituzioni pubbliche</h1>
        <p>
          Bilanci, spese e dati di Parlamento, Palazzo Chigi, governi, Ministeri e Regioni.
        </p>
      </div>

      <section aria-labelledby="percorsi-istituzionali">
        <h2 id="percorsi-istituzionali" className="sr-only">Esplora le istituzioni</h2>
        <div className={styles.grid}>
          {dossiers.map((dossier) => (
            <article className={styles.card} key={dossier.href}>
              <span>{dossier.period}</span>
              <h3>{dossier.title}</h3>
              <p>{dossier.description}</p>
              <Link href={dossier.href} data-institution-link>
                Apri {dossier.title} <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      </section>

      <div className="notice">
        <strong>Percorsi distinti</strong>
        <p>
          Anni, confini e regole contabili restano diversi. I confronti restano dentro ogni fonte
          e solo tra grandezze compatibili.
        </p>
      </div>
    </main>
  );
}
