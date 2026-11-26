import { useId, useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { isInternalSiteHref, type AiResponse, type AiSiteLink } from "@/lib/assistant/byok-contracts";
import { AssistantMarkdownBlocks, useAssistantBlocks } from "@/components/assistant-markdown";
import { linkHrefs } from "@/components/assistant-markdown-parse";
import styles from "@/app/assistente/assistant.module.css";

const NO_LINKS: readonly AiSiteLink[] = [];

/**
 * Provider text is rendered only as escaped text; site pages and source links come from the server catalog.
 * `showNewTabHint` is set on the first answer with site pages only: repeating it on every answer is noise.
 */
export function AssistantAiReply({ response, showNewTabHint = false }: { response: AiResponse; showNewTabHint?: boolean }) {
  const id = useId();
  const answer = response.ok ? response : null;
  const siteLinks = useMemo(() => answer?.siteLinks?.filter((link) => isInternalSiteHref(link.href)) ?? NO_LINKS, [answer]);
  const blocks = useAssistantBlocks(answer?.text ?? "", siteLinks);
  // Pages already linked in the text come first and are marked, so the cards read as their continuation, not a repeat.
  const pages = useMemo(() => {
    const cited = linkHrefs(blocks);
    return siteLinks.map((link) => ({ ...link, cited: cited.has(link.href) })).sort((a, b) => Number(b.cited) - Number(a.cited));
  }, [blocks, siteLinks]);
  if (!response.ok) return <p role="status">{response.message}</p>;
  return <div className={styles.aiAnswer}>
    <div className={styles.aiText}><AssistantMarkdownBlocks blocks={blocks} /></div>

    {pages.length ? <section className={styles.siteLinks} aria-labelledby={`${id}-site`} data-site-links>
      <div className={styles.replyHead}>
        <h3 id={`${id}-site`} className={styles.replyLabel}>Approfondisci su DVNS</h3>
        {showNewTabHint ? <p className={styles.replyHint}>Si aprono in una nuova scheda</p> : null}
      </div>
      <ul className={styles.siteLinkList}>{pages.map((link) => <li key={link.href}>
        {/* The chat lives only in memory (nothing is persisted), so leaving this tab would erase it. */}
        <a href={link.href} target="_blank" rel="noopener" className={styles.siteLink} data-cited={link.cited || undefined}>
          <span className={styles.siteLinkText}>
            <span className={styles.siteLinkTitle}>
              <strong>{link.title}</strong>
              {link.cited ? <span className={styles.citedTag}><span aria-hidden="true">Nel testo</span><span className={styles.srOnly}>, citata nella risposta</span></span> : null}
            </span>
            {link.description ? <small>{link.description}</small> : null}
          </span>
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={18} strokeWidth={1.8} aria-hidden="true" />
          <span className={styles.srOnly}> (nuova scheda)</span>
        </a>
      </li>)}</ul>
    </section> : null}

    {response.evidence.length ? <section className={styles.evidence} aria-labelledby={`${id}-evidence`}>
      <h3 id={`${id}-evidence`} className={styles.replyLabel}>Dati consultati e fonti ufficiali</h3>
      <ul className={styles.evidenceList}>{response.evidence.map((entry, index) => <li key={`${entry.dataset}-${index}`} className={styles.evidenceItem}>
        <p className={styles.evidenceTitle}>{entry.title}</p>
        {entry.sources.length ? <ul className={styles.sourceList} aria-label={`Fonti ufficiali: ${entry.title}`}>{entry.sources.map((source) => <li key={source.url}>
          <a href={source.url} target="_blank" rel="noreferrer" className={styles.sourceLink}>
            {/* Word joiner: the arrow never wraps alone onto a new line. */}
            {source.name}{"\u2060"}<HugeiconsIcon icon={ArrowUpRight01Icon} size={13} strokeWidth={2} aria-hidden="true" /><span className={styles.srOnly}> (sito esterno, nuova scheda)</span>
          </a>
          {source.period ? <> <span className={styles.sourcePeriod}>{source.period}</span></> : null}
        </li>)}</ul> : null}
        {entry.caveat ? <details className={styles.limits}>
          <summary><HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={2} aria-hidden="true" />Limiti del dato</summary>
          <p>{entry.caveat}</p>
        </details> : null}
      </li>)}</ul>
    </section> : null}
    <p className={styles.aiDisclaimer}>Verifica numeri e interpretazioni sulle fonti.</p>
  </div>;
}
