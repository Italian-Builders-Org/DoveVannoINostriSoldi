import { useId, useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import { isInternalSiteHref, type AiResponse, type AiSiteLink } from "@/lib/assistant/byok-contracts";
import { AssistantMarkdownBlocks, useAssistantBlocks } from "@/components/assistant-markdown";
import { linkHrefs } from "@/components/assistant-markdown-parse";
import styles from "@/app/assistente/assistant.module.css";

const NO_LINKS: readonly AiSiteLink[] = [];

/** The period every source shares, said once next to the dataset; undefined when they differ. */
function sharedPeriod(sources: readonly { period?: string }[]) {
  const period = sources[0]?.period;
  return period && sources.every((source) => source.period === period) ? period : undefined;
}

const AS_OF = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** A source snapshot date, written as people read it ("14 set 2026"); anything that is not an ISO date stays as given. */
function asOfLabel(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/u.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  return date && !Number.isNaN(date.getTime()) ? AS_OF.format(date) : value;
}

/** Provider text is rendered only as escaped text; site pages and source links come from the server catalog. */
export function AssistantAiReply({ response }: { response: AiResponse }) {
  const id = useId();
  const answer = response.ok ? response : null;
  const siteLinks = useMemo(() => answer?.siteLinks?.filter((link) => isInternalSiteHref(link.href)) ?? NO_LINKS, [answer]);
  const blocks = useAssistantBlocks(answer?.text ?? "", siteLinks);
  // Each DVNS page appears once: a page linked in the text or from a dataset name under "Fonti"
  // is not listed again, so "Approfondisci" only adds what the answer has not offered yet.
  const pages = useMemo(() => {
    const shown = new Set([...linkHrefs(blocks), ...(answer?.evidence ?? []).flatMap((entry) => entry.href && isInternalSiteHref(entry.href) ? [entry.href] : [])]);
    return siteLinks.filter((link) => !shown.has(link.href));
  }, [answer, blocks, siteLinks]);
  if (!response.ok) return <p role="status">{response.message}</p>;
  return <div className={styles.aiAnswer}>
    <div className={styles.aiText}><AssistantMarkdownBlocks blocks={blocks} /></div>

    {response.evidence.length ? <section className={styles.evidence} aria-labelledby={`${id}-evidence`}>
      <h2 id={`${id}-evidence`} className={styles.replyLabel}>Fonti</h2>
      <ul className={styles.evidenceList}>{response.evidence.map((entry, index) => <li key={`${entry.dataset}-${index}`} className={styles.evidenceItem}>
        <div className={styles.evidenceTitle}>{entry.href && isInternalSiteHref(entry.href)
          ? <a href={entry.href} target="_blank" rel="noopener" className={styles.datasetLink}>{entry.title}{"\u2060"}<HugeiconsIcon icon={ArrowUpRight01Icon} size={13} strokeWidth={2} aria-hidden="true" /><span className={styles.srOnly}> (pagina DVNS, nuova scheda)</span></a>
          : entry.title}{sharedPeriod(entry.sources) ? <span className={styles.sourcePeriod}><span aria-hidden="true"> · </span><span className={styles.srOnly}>, periodo </span>{sharedPeriod(entry.sources)}</span> : null}</div>
        {entry.sources.length ? <ul className={styles.sourceList} aria-label={`Fonti ufficiali: ${entry.title}`}>{entry.sources.map((source) => <li key={source.url}>
          <a href={source.url} target="_blank" rel="noreferrer" className={styles.sourceLink}>
            {/* Word joiner: the arrow never wraps alone onto a new line. */}
            {source.name}{"\u2060"}<HugeiconsIcon icon={ArrowUpRight01Icon} size={13} strokeWidth={2} aria-hidden="true" /><span className={styles.srOnly}> (sito esterno, nuova scheda)</span>
          </a>
          {source.period && !sharedPeriod(entry.sources) ? <> <span className={styles.sourcePeriod}>periodo {source.period}</span></> : null}
          {source.asOf ? <> <span className={styles.sourcePeriod}>dati al {asOfLabel(source.asOf)}</span></> : null}
        </li>)}</ul> : null}
        {/* The limit stays visible: on a public-spending answer it changes how the number reads. */}
        {entry.caveat ? <div className={styles.limits}>
          <HugeiconsIcon icon={InformationCircleIcon} size={16} strokeWidth={1.8} aria-hidden="true" />
          <p><strong>Limiti del dato:</strong> {entry.caveat}</p>
        </div> : null}
      </li>)}</ul>
    </section> : null}

    {pages.length ? <section className={styles.siteLinks} aria-labelledby={`${id}-site`} data-site-links>
      <h2 id={`${id}-site`} className={styles.replyLabel}>Approfondisci</h2>
      <ul className={styles.siteLinkList}>{pages.map((link) => <li key={link.href}>
        {/* The chat lives only in memory (nothing is persisted), so leaving this tab would erase it. */}
        <a href={link.href} target="_blank" rel="noopener" className={styles.siteLink}>
          <span className={styles.siteLinkText}>
            <strong>{link.title}</strong>
            {link.description ? <small>{link.description}</small> : null}
          </span>
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={18} strokeWidth={1.8} aria-hidden="true" />
          <span className={styles.srOnly}> (nuova scheda)</span>
        </a>
      </li>)}</ul>
    </section> : null}
  </div>;
}
