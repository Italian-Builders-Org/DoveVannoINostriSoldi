import { useId } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { isInternalSiteHref, type AiResponse } from "@/lib/assistant/byok-contracts";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import styles from "@/app/assistente/assistant.module.css";

/** Provider text is rendered only as escaped text; site pages and source links come from the server catalog. */
export function AssistantAiReply({ response }: { response: AiResponse }) {
  const id = useId();
  if (!response.ok) return <p role="status">{response.message}</p>;
  const siteLinks = (response.siteLinks ?? []).filter((link) => isInternalSiteHref(link.href));
  return <div className={styles.aiAnswer}>
    <div className={styles.aiText}><AssistantMarkdown text={response.text} siteLinks={siteLinks} /></div>

    {siteLinks.length ? <nav className={styles.siteLinks} aria-labelledby={`${id}-site`}>
      <h3 id={`${id}-site`} className={styles.replyLabel}>Approfondisci su DVNS</h3>
      <p className={styles.siteLinksHint}>Le pagine si aprono in una nuova scheda: la conversazione resta qui.</p>
      <ul>{siteLinks.map((link) => <li key={link.href}>
        {/* The chat lives only in memory (nothing is persisted), so leaving this tab would erase it. */}
        <a href={link.href} target="_blank" rel="noopener" className={styles.siteLink}>
          <span><strong>{link.title}</strong>{link.description ? <small>{link.description}</small> : null}</span>
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={18} strokeWidth={1.8} aria-hidden="true" />
          <span className={styles.srOnly}> (nuova scheda)</span>
        </a>
      </li>)}</ul>
    </nav> : null}

    {response.evidence.length ? <section className={styles.evidence} aria-labelledby={`${id}-evidence`}>
      <h3 id={`${id}-evidence`} className={styles.replyLabel}>Dati consultati e fonti ufficiali</h3>
      <ul className={styles.evidenceList}>{response.evidence.map((entry, index) => <li key={`${entry.dataset}-${index}`} className={styles.evidenceItem}>
        <p className={styles.evidenceTitle}>{entry.title}</p>
        {entry.sources.length ? <ul className={styles.sourceList} aria-label={`Fonti ufficiali: ${entry.title}`}>{entry.sources.map((source) => <li key={source.url}>
          <a href={source.url} target="_blank" rel="noreferrer" className={styles.sourceLink}>
            {source.name}<HugeiconsIcon icon={ArrowUpRight01Icon} size={13} strokeWidth={2} aria-hidden="true" /><span className={styles.srOnly}> (sito esterno, nuova scheda)</span>
          </a>
          {source.period ? <span className={styles.sourcePeriod}>{source.period}</span> : null}
        </li>)}</ul> : null}
        {entry.caveat ? <details className={styles.limits}>
          <summary>Limiti del dato</summary>
          <p>{entry.caveat}</p>
        </details> : null}
      </li>)}</ul>
    </section> : null}
    <p className={styles.aiDisclaimer}>Le risposte possono contenere errori: verifica numeri e interpretazioni sulle fonti.</p>
  </div>;
}
