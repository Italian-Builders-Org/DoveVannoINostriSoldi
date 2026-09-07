import { type AiResponse } from "@/lib/assistant/byok-contracts";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import styles from "@/app/assistente/assistant.module.css";

/** Provider text is rendered only as escaped text; source links come from the server catalog. */
export function AssistantAiReply({ response }: { response: AiResponse }) {
  if (!response.ok) return <p role="status">{response.message}</p>;
  return <div className={styles.aiAnswer}>
    <div className={styles.aiText}><AssistantMarkdown text={response.text} /></div>
    {response.evidence.length ? <div className={styles.aiSources} aria-label="Dataset e fonti consultati">
      {response.evidence.map((entry, index) => <div key={`${entry.dataset}-${index}`}>
        <p><strong>{entry.title}</strong></p>
        {entry.sources.map((source) => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a>{source.period ? <small>{source.period}</small> : null}</p>)}
        {entry.caveat ? <p className={styles.aiCaveat}>{entry.caveat}</p> : null}
      </div>)}
    </div> : null}
    <p className={styles.aiDisclaimer}>Risposta generata con AI. Verifica cifre, provenienza e interpretazioni prima di usarle.</p>
  </div>;
}
