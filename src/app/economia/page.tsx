import type { Metadata } from "next";
import Link from "next/link";
import styles from "./economia.module.css";

export const metadata: Metadata = {
  title: "Economia: prezzi, cuneo fiscale e PIL",
  description:
    "Indicatori economici ufficiali distinti dalla spesa pubblica: inflazione IPCA Eurostat, cuneo fiscale OECD e PIL Eurostat SEC 2010.",
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
  {
    href: "/pil",
    title: "PIL e conti nazionali",
    period: "Eurostat SEC 2010 · trimestrale e annuale",
    description:
      "Livello, crescita e quote della domanda del prodotto interno lordo. Non è cassa SIOPE e non assegna meriti a un governo.",
  },
] as const;

export default function EconomiaPage() {
  return (
    <main className="shell page">
      <header className="page-intro">
        <p className="eyebrow">Contesto economico</p>
        <h1>Economia</h1>
        <p>
          Qui ci sono indicatori su prezzi, costo del lavoro e PIL. Restano fuori dalla sezione Soldi:
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
