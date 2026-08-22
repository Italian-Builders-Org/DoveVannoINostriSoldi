import type { Metadata } from "next";
import Link from "next/link";
import styles from "./istituzioni.module.css";

export const metadata: Metadata = {
  title: "Spese delle istituzioni",
  description:
    "Quattro percorsi separati per Parlamento, Palazzo Chigi, Ministeri e Regioni, con periodo, perimetro e fonte visibili.",
};

const dossiers = [
  {
    href: "/parlamento",
    title: "Parlamento",
    period: "Camera: dati 2025 · documenti 2024 per Camera e Senato",
    description:
      "Camera e Senato restano distinti. I numeri sono pubblicati solo dove il dato ufficiale è verificato; per gli altri documenti mostriamo la copertura mancante.",
  },
  {
    href: "/palazzo-chigi",
    title: "Palazzo Chigi",
    period: "Rendiconto PCM 2024",
    description:
      "Impegni e pagamenti della sola Presidenza del Consiglio, con fasi contabili separate e fonte ufficiale scaricabile.",
  },
  {
    href: "/ministeri",
    title: "Ministeri",
    period: "Rendiconto dello Stato 2025",
    description:
      "Totale CP, Pagato CP e Rimasto CP per 15 Ministeri. Palazzo Chigi e Parlamento non sono inclusi.",
  },
  {
    href: "/regioni",
    title: "Regioni",
    period: "Consuntivi Istat 2024",
    description:
      "Impegni per Titolo di 22 amministrazioni regionali e Province autonome, senza classifiche o confronti pro capite improvvisati.",
  },
] as const;

export default function InstitutionsPage() {
  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Spese delle istituzioni</h1>
        <p>
          Parlamento, Palazzo Chigi, Ministeri e Regioni hanno conti e regole diverse.
          Scegli il percorso che ti interessa: non li sommiamo in un totale unico.
        </p>
      </div>

      <section aria-labelledby="percorsi-istituzionali">
        <div className={styles.sectionHeader}>
          <h2 id="percorsi-istituzionali">Quattro conti, quattro perimetri</h2>
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
        <strong>Perché non c&apos;è un totale delle istituzioni</strong>
        <p>
          Periodi, perimetri e fasi contabili non coincidono. Sommarli produrrebbe un numero
          fuorviante. I confronti restano dentro ogni fonte e solo tra grandezze compatibili.
        </p>
      </div>
    </main>
  );
}
