import type { Metadata } from "next";
import { AssistantChat } from "@/components/assistant-chat";

export const metadata: Metadata = {
  title: "Assistente sui dati pubblici",
  description: "Domande sui dati pubblici verificati, con testo e dettatura locale nei browser compatibili.",
};

export default function AssistantPage() {
  return (
    <main className="shell page">
      <header className="page-intro">
        <h1>Assistente sui dati pubblici</h1>
        <p>
          Un assistente deterministico e in sola lettura, con dettatura locale nei browser compatibili. Non genera analisi con
          un modello AI: riconosce solo poche domande esplicite e riusa gli stessi adapter verificati
          del sito e dell’MCP.
        </p>
      </header>

      <AssistantChat />

      <section className="panel" aria-labelledby="assistant-boundary-title">
        <h2 id="assistant-boundary-title">Cosa non fa ancora</h2>
        <p>
          Non supporta chat con memoria, domande sul singolo Comune, classifiche, spiegazioni
          causali o accuse di frode e corruzione. Non usa un provider AI per interpretare le domande.
          La dettatura richiede il supporto locale dell’italiano nel browser: puoi sempre scrivere
          la domanda e controllare il testo prima di inviarlo.
        </p>
        <p>
          Le richieste non vengono salvate dall’applicazione e il testo non viene scritto nei log
          applicativi. Il provider di hosting può conservare i normali log tecnici: consulta la
          <a href="/privacy"> privacy</a> prima di usare il servizio.
        </p>
      </section>
    </main>
  );
}
