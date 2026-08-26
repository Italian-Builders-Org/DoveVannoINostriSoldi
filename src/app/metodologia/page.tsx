import type { Metadata } from "next";
import styles from "./metodologia.module.css";

export const metadata: Metadata = {
  title: "Come leggiamo i dati",
  description: "Sei regole semplici per capire i numeri di DoveVannoINostriSoldi.",
};

const rules = [
  ["Mostriamo sempre la fonte", "Ogni numero porta al documento o ai dati ufficiali da cui arriva."],
  ["Teniamo separate le grandezze diverse", "Pagamenti, costi previsti, debiti e ipotesi hanno significati diversi e restano separati."],
  ["Diciamo quanto è recente", "Mostriamo la data del dato, quando lo abbiamo controllato e quanto spesso cambia la fonte."],
  ["Un segnale indica dove guardare", "Un valore insolito serve a scegliere cosa approfondire con contesto e fonti ufficiali."],
  ["Confrontiamo casi simili", "Mettiamo a confronto enti e servizi solo quando i numeri misurano la stessa cosa."],
  ["Le correzioni restano visibili", "Se un dato cambia, conserviamo la versione precedente e spieghiamo che cosa è stato corretto."],
];

export default function MethodPage() {
  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Come leggere i dati</h1>
        <p>
          Un numero senza contesto può confondere. Per questo mostriamo sempre la fonte, la data
          e il significato di ogni cifra.
        </p>
      </div>

      <div className={styles.rules}>
        {rules.map(([title, text], index) => (
          <section className="panel" key={title}>
            <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
            <h2>{title}</h2>
            <p>{text}</p>
          </section>
        ))}
      </div>

      <div className="notice warning-notice">
        <strong>Controlli e approfondimenti</strong>
        <p>
          Qui trovi dati e segnali da verificare. I controlli ufficiali restano di ANAC, Corte dei
          conti, magistratura e amministrazioni. Nessun algoritmo decide da solo illeciti o colpe.
        </p>
      </div>
    </main>
  );
}
