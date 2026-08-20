import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Come leggiamo i dati",
  description: "Sei regole semplici per capire i numeri di DoveVannoINostriSoldi.",
};

const rules = [
  ["01", "Mostriamo sempre la fonte", "Ogni numero porta al documento o al dataset ufficiale da cui arriva."],
  ["02", "Non sommiamo cose diverse", "Pagamenti, costi previsti, debiti e scenari hanno significati diversi e restano separati."],
  ["03", "Diciamo quanto è recente", "Mostriamo la data del dato, quando lo abbiamo controllato e quanto spesso cambia la fonte."],
  ["04", "Un segnale non è una colpa", "Un valore insolito indica dove guardare meglio. Da solo non prova errori, sprechi o illeciti."],
  ["05", "Confrontiamo casi simili", "Mettiamo a confronto enti e servizi solo quando le grandezze sono davvero confrontabili."],
  ["06", "Le correzioni restano visibili", "Se un dato cambia, conserviamo la versione precedente e spieghiamo che cosa è stato corretto."],
];

export default function MethodPage() {
  return (
    <main className="subpage">
      <header className="page-intro">
        <span className="eyebrow"><span /> COME LEGGIAMO I DATI</span>
        <h1>Prima capire.<br /><em>Poi confrontare.</em></h1>
        <p>
          Un numero senza contesto può confondere. Per questo mostriamo sempre la fonte,
          la data, il significato e ciò che quel numero non può dimostrare.
        </p>
      </header>

      <section className="method-grid">
        {rules.map(([index, title, text]) => (
          <article key={index}>
            <span>{index}</span>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="notice warning-notice">
        <strong>Un controllo non è una condanna.</strong>
        <p>
          DoveVannoINostriSoldi aiuta a trovare dati e segnali da approfondire. Non sostituisce
          ANAC, Corte dei conti, magistratura o verifiche dell&apos;amministrazione. Nessun algoritmo
          attribuisce automaticamente illeciti o responsabilità personali.
        </p>
      </section>
    </main>
  );
}
