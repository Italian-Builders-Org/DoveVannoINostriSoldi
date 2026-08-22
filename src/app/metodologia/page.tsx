import type { Metadata } from "next";
import styles from "./metodologia.module.css";

export const metadata: Metadata = {
  title: "Come leggiamo i dati",
  description: "Sei regole semplici per capire i numeri di DoveVannoINostriSoldi.",
};

const rules = [
  ["Mostriamo sempre la fonte", "Ogni numero porta al documento o ai dati ufficiali da cui arriva."],
  ["Non sommiamo cose diverse", "Pagamenti, costi previsti, debiti e ipotesi hanno significati diversi e restano separati."],
  ["Diciamo quanto è recente", "Mostriamo la data del dato, quando lo abbiamo controllato e quanto spesso cambia la fonte."],
  ["Un segnale non è una colpa", "Un valore insolito indica dove guardare meglio. Da solo non prova errori, sprechi o illeciti."],
  ["Confrontiamo casi simili", "Mettiamo a confronto enti e servizi solo quando i numeri misurano la stessa cosa."],
  ["Le correzioni restano visibili", "Se un dato cambia, conserviamo la versione precedente e spieghiamo che cosa è stato corretto."],
];

export default function MethodPage() {
  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Come leggere i dati</h1>
        <p>
          Un numero senza contesto può confondere. Per questo mostriamo sempre la fonte, la data,
          il significato e ciò che quel numero non può dimostrare.
        </p>
      </div>

      <div className={styles.rules}>
        {rules.map(([title, text]) => (
          <section className="panel" key={title}>
            <h2>{title}</h2>
            <p>{text}</p>
          </section>
        ))}
      </div>

      <div className="notice warning-notice">
        <strong>Un controllo non è una condanna</strong>
        <p>
          DoveVannoINostriSoldi aiuta a trovare dati e segnali da approfondire. Non sostituisce
          ANAC, Corte dei conti, magistratura o verifiche dell&apos;amministrazione. Nessun algoritmo
          attribuisce automaticamente illeciti o responsabilità personali.
        </p>
      </div>
    </main>
  );
}
