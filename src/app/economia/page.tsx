import type { Metadata } from "next";
import Link from "next/link";
import styles from "./economia.module.css";

export const metadata: Metadata = {
  title: "Economia: prezzi e cuneo fiscale",
  description:
    "Indicatori economici ufficiali distinti dalla spesa pubblica: inflazione IPCA Eurostat e cuneo fiscale OECD Taxing Wages.",
  alternates: { canonical: "/economia" },
};

const dossiers = [
  {
    href: "/inflazione",
    title: "Inflazione IPCA",
    period: "Eurostat HICP · prezzi al consumo",
    description:
      "Variazione dei prezzi in Italia, capitoli del paniere e confronto con UE27 e area euro. Non è spesa pubblica.",
  },
  {
    href: "/cuneo-fiscale",
    title: "Cuneo fiscale",
    period: "OECD Taxing Wages · profilo tipo",
    description:
      "Quanto pesano IRPEF e contributi su un lavoratore tipo. Non è la busta paga di una persona reale né l’IRPEF territoriale.",
  },
] as const;

export default function EconomiaPage() {
  return (
    <main className="shell page">
      <header className="page-intro">
        <p className="eyebrow">Contesto economico</p>
        <h1>Economia</h1>
        <p>
          Qui ci sono indicatori su prezzi e costo del lavoro. Restano fuori dalla sezione Soldi:
          non sono pagamenti, stanziamenti o debiti della pubblica amministrazione.
        </p>
      </header>

      <section aria-labelledby="percorsi-economia">
        <h2 id="percorsi-economia" className="sr-only">Esplora economia</h2>
        <div className={styles.grid}>
          {dossiers.map((dossier) => (
            <article className={styles.card} key={dossier.href}>
              <span>{dossier.period}</span>
              <h3>{dossier.title}</h3>
              <p>{dossier.description}</p>
              <Link href={dossier.href}>
                Apri {dossier.title} <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      </section>

      <div className="notice">
        <strong>Distinto da Soldi e Territori</strong>
        <p>
          La spesa pubblica resta in Soldi. L’IRPEF dichiarata per comune e regione resta in Territori.
          Qui si leggono solo serie ufficiali di contesto economico.
        </p>
        <p className={styles.links}>
          <Link href="/spese">Soldi →</Link>
          <Link href="/territori/irpef">IRPEF territoriale →</Link>
        </p>
      </div>
    </main>
  );
}
