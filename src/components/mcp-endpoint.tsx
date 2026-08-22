"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/app/mcp/mcp.module.css";
import { PUBLIC_MCP_ENDPOINT } from "@/lib/site";

const AGENT_PROMPT = `Collega questo server MCP remoto:
${PUBLIC_MCP_ENDPOINT}

Procedura:
1. Scopri i tool disponibili e usa list_datasets prima di interrogare i dati.
2. Scegli il dataset coerente con la domanda e usa solo filtri dichiarati dal catalogo.
3. Usa limit e offset soltanto quando il catalogo li dichiara; mantieni sempre i filtri più stretti necessari.
4. Nella risposta indica dataset, periodo, territorio, fonte ufficiale e limiti interpretativi.
5. Distingui pagamenti, costi, imposte dichiarate e stime: l'imposta netta dichiarata MEF non è il gettito totale e non va sottratta al saldo CPT; il saldo CPT non è un residuo fiscale.
6. Non chiamare un valore spreco, frode o qualità del servizio senza una fonte che lo dimostri.
7. Se il dato non esiste, è soppresso o i perimetri non sono confrontabili, dichiaralo senza imputazioni o stime inventate.

Inizia elencando i dataset utili alla mia domanda; esegui la query soltanto dopo aver scelto quello corretto.`;

function useClipboardFeedback(value: string, enabled = true) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  async function copy() {
    if (!enabled) return;
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    resetTimer.current = window.setTimeout(() => setStatus("idle"), 2400);
  }

  return { copy, status };
}

export function McpEndpoint() {
  const { copy, status } = useClipboardFeedback(PUBLIC_MCP_ENDPOINT);

  return (
    <div className={styles.endpointRow}>
      <code>{PUBLIC_MCP_ENDPOINT}</code>
      <button className="btn" type="button" onClick={copy}>
        {status === "copied" ? "Copiato" : status === "error" ? "Copia non riuscita" : "Copia endpoint"}
      </button>
      <span className={styles.srStatus} role="status" aria-live="polite">
        {status === "copied" ? "Endpoint MCP copiato negli appunti." : status === "error" ? "Copia non riuscita. Seleziona e copia manualmente l’indirizzo." : ""}
      </span>
    </div>
  );
}

export function AgentMcpPrompt() {
  const { copy, status } = useClipboardFeedback(AGENT_PROMPT);

  return (
    <div className={styles.promptBlock}>
      <pre
        className={styles.agentPrompt}
        role="region"
        aria-label="Prompt MCP per agenti AI"
        tabIndex={0}
      >
        <code>{AGENT_PROMPT}</code>
      </pre>
      <button className="btn" type="button" onClick={copy}>
        {status === "copied" ? "Prompt copiato" : status === "error" ? "Copia non riuscita" : "Copia prompt per agenti"}
      </button>
      <span className={styles.srStatus} role="status" aria-live="polite">
        {status === "copied" ? "Prompt MCP copiato negli appunti." : status === "error" ? "Copia non riuscita. Seleziona e copia manualmente il prompt." : ""}
      </span>
    </div>
  );
}
