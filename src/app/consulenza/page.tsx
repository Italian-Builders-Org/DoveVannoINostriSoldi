import type { Metadata } from "next";
import { CONSULTING_TOPICS } from "@/lib/leads";
import { CONTACT_EMAIL } from "@/lib/site";
import styles from "./consulenza.module.css";
import { LeadForm } from "./lead-form";

export const metadata: Metadata = {
  title: "Consulenza",
  description:
    "Consulenza su dati pubblici per aziende e amministrazioni. Il sito resta gratuito e indipendente.",
};

const offers = [
  [
    "Lettura guidata",
    "Partiamo da un ente, un territorio o un progetto e ricostruiamo che cosa dicono le fonti, che cosa manca e quali numeri si possono confrontare.",
  ],
  [
    "Report o cruscotto interno",
    "Allestiamo una vista adatta a un ufficio o a un consiglio, con le stesse cautele del sito: fonte, data, perimetro e limiti di ogni cifra.",
  ],
  [
    "Formazione",
    "Lavoriamo con chi deve spiegare i numeri: comunicazione, controllo di gestione, uffici gare, giornalismo o advocacy.",
  ],
  [
    "Imprese che lavorano con la PA",
    "Aiutiamo a leggere bandi, affidamenti, pagamenti e anagrafi pubbliche senza confondere un dato aperto con un vantaggio informativo privato.",
  ],
] as const;

export default function ConsultingPage() {
  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Consulenza su dati pubblici</h1>
        <p>
          Il sito resta gratuito. Se un&apos;azienda o un&apos;amministrazione ha bisogno di una
          lettura più stretta, di un report interno o di un percorso di formazione, si può
          partire da questo form.
        </p>
      </div>

      <div className="notice">
        <strong>Due cose distinte</strong>
        <p>
          I dati pubblici restano pubblici. Un incarico di consulenza non compra accesso
          privilegiato, non cambia i numeri sul sito e non è un parere legale, contabile o
          un accertamento. Per le amministrazioni questa è una richiesta di contatto: un
          eventuale incarico segue le regole di affidamento previste.
        </p>
      </div>

      <div className={styles.layout}>
        <section className={styles.offers} aria-labelledby="offers-title">
          <h2 id="offers-title" className="panel-title">
            Che cosa possiamo fare
          </h2>
          {offers.map(([title, text]) => (
            <article className="panel" key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
          <p className={styles.topicsHint}>
            Nel form trovi le stesse voci: {Object.values(CONSULTING_TOPICS).join("; ")}.
          </p>
        </section>

        <section className="panel" aria-labelledby="form-title">
          <h2 id="form-title" className="panel-title">
            Richiedi un contatto
          </h2>
          <p className={styles.formIntro}>
            Compila i campi. Rispondiamo di solito entro due giorni lavorativi. Se preferisci
            scrivere tu, l&apos;indirizzo è{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
          <LeadForm />
        </section>
      </div>
    </main>
  );
}
