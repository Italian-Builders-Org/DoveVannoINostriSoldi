"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/app/mcp/mcp.module.css";
import { PUBLIC_MCP_ENDPOINT } from "@/lib/site";

const AGENT_PROMPT = `Collega questo server MCP remoto:
${PUBLIC_MCP_ENDPOINT}

Procedura:
1. Scopri i tool disponibili e usa list_datasets prima di interrogare i dati.
2. Scegli il dataset coerente con la domanda e usa solo filtri dichiarati dal catalogo.
3. Usa limit, offset e cursor soltanto quando il catalogo li dichiara; per continuare una scansione riutilizza il cursor restituito senza modificarlo.
4. Nella risposta indica dataset, periodo, territorio, fonte ufficiale e limiti interpretativi.
5. Distingui pagamenti, costi, imposte dichiarate e stime: l'imposta netta dichiarata MEF resta separata dal gettito totale e dal saldo CPT; il saldo CPT resta un saldo contabile territorializzato.
6. Chiama un valore spreco, frode o qualità del servizio soltanto se una fonte lo documenta.
7. Se il dato manca, è soppresso o i perimetri restano inconfrontabili, dichiaralo senza imputazioni o stime inventate.

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
