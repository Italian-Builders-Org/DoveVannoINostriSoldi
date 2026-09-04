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
      "Camera e Senato restano distinti. Mostriamo i numeri solo dove li abbiamo già controllati; per gli altri documenti diciamo che cosa manca.",
  },
  {
    href: "/palazzo-chigi",
    title: "Palazzo Chigi",
    period: "Rendiconto PCM 2024",
    description:
      "Soldi impegnati e soldi pagati dalla sola Presidenza del Consiglio, con file ufficiale scaricabile.",
  },
  {
    href: "/governi",
    title: "Pagella dei governi",
    period: "Core macro dal 1995 · storia prima del 1995",
    description:
      "Risultati economici durante ogni governo, confronto europeo, contesto, misure e previsione corrente senza attribuire causalità automatica.",
  },
  {
    href: "/ministeri",
    title: "Ministeri",
    period: "Rendiconto dello Stato 2025",
    description:
      "Quanto hanno impegnato, già pagato e ancora da pagare 15 ministeri. Palazzo Chigi e Parlamento non ci sono.",
  },
  {
    href: "/regioni",
    title: "Regioni",
    period: "Consuntivi Istat 2024",
    description:
      "Come si spezzano i soldi impegnati di 22 Regioni e Province autonome, senza classifiche inventate.",
  },
] as const;

export default function InstitutionsPage() {
  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Istituzioni pubbliche</h1>
        <p>
          Parlamento, Palazzo Chigi, governi, Ministeri e Regioni richiedono domande e dati diversi.
          Ogni percorso resta separato.
        </p>
      </div>

      <section aria-labelledby="percorsi-istituzionali">
        <div className={styles.sectionHeader}>
          <h2 id="percorsi-istituzionali">Cinque percorsi, cinque confini</h2>
          <p>In ogni pagina trovi importi esatti o limiti di copertura, periodo e fonte ufficiale.</p>
        </div>
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
