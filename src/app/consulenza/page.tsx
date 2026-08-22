import type { Metadata } from "next";
import { CONSULTING_TOPICS } from "@/lib/consulting-contract";
import styles from "./consulenza.module.css";
import { LeadForm } from "./lead-form";

export const metadata: Metadata = {
  title: "Consulenza",
  description:
    "Progetti di intelligenza artificiale per aziende e amministrazioni. Il sito resta gratuito e indipendente.",
};

const offers = [
  [
    "Lettura con AI",
    "Leggiamo fonti pubbliche, archivi interni o entrambi. Ogni cifra resta legata alla sua origine.",
  ],
  [
    "Report o cruscotto interno",
    "Una vista per uffici e team, con fonte, data, perimetro e limiti di ogni risposta.",
  ],
  [
    "Formazione",
    "Uso pratico dell'AI su dati, gare, controllo di gestione e comunicazione, senza inventare numeri.",
  ],
  [
    "Strumento AI per l'impresa o per la PA",
    "Un assistente o flusso interno per cercare documenti, seguire pratiche e interrogare archivi.",
  ],
] as const;

export default function ConsultingPage() {
  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Raccontaci il progetto</h1>
        <p>
          Aiutiamo aziende e amministrazioni a usare dati e intelligenza artificiale per
          un lavoro concreto. Il sito pubblico resta gratuito e indipendente.
        </p>
      </div>

      <div className="notice">
        <strong>Il sito resta indipendente</strong>
        <p>
          Un incarico non compra accesso privilegiato e non cambia i numeri pubblicati. I dati
          interni restano dell&apos;organizzazione. Per una PA, il form è solo una richiesta di
          contatto: ogni incarico segue le regole di affidamento previste.
        </p>
      </div>

      <div className={styles.layout}>
        <section className={`panel ${styles.formPanel}`} aria-labelledby="form-title">
          <h2 id="form-title" className="panel-title">
            Richiedi un contatto
          </h2>
          <p className={styles.formIntro}>
            Indica il tipo di progetto e che lavoro dovrebbe fare l&apos;intelligenza
            artificiale. Rispondiamo di solito entro due giorni lavorativi, sullo stesso
            indirizzo che indichi nel form.
          </p>
          <LeadForm />
        </section>

        <section className={`panel ${styles.offers}`} aria-labelledby="offers-title">
          <h2 id="offers-title" className="panel-title">Possiamo aiutarti con</h2>
          <div className={styles.offerList}>
            {offers.map(([title, text]) => (
              <article key={title}>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
          <p className={styles.topicsHint}>
            Scegli una delle {Object.keys(CONSULTING_TOPICS).length} voci nel form; puoi precisare
            il caso nel messaggio finale.
          </p>
        </section>
      </div>
    </main>
  );
}
