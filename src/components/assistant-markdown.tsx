import { Fragment, useMemo, type ReactNode } from "react";
import { isInternalSiteHref, type AiSiteLink } from "@/lib/assistant/byok-contracts";
import { parseAssistantMarkdown, type AssistantInline } from "@/components/assistant-markdown-parse";
import styles from "@/app/assistente/assistant.module.css";

function inline(nodes: AssistantInline[]): ReactNode[] {
  return nodes.map((node, index) => node.type === "strong" ? <strong key={index}>{inline(node.children)}</strong>
    : node.type === "code" ? <code key={index}>{node.text}</code>
      // New tab like the site-link cards: the in-memory conversation must survive the visit.
      : node.type === "link" ? <a key={index} href={node.href} target="_blank" rel="noopener" className={styles.inlineSiteLink}>{node.text}<span className={styles.srOnly}> (nuova scheda)</span></a>
        : <Fragment key={index}>{node.text}</Fragment>);
}

/** Model text as escaped React nodes; only hrefs from this answer's `siteLinks` become links. */
export function AssistantMarkdown({ text, siteLinks = [] }: { text: string; siteLinks?: readonly AiSiteLink[] }) {
  const blocks = useMemo(() => {
    const allowed = new Set(siteLinks.map((link) => link.href));
    return parseAssistantMarkdown(text, (href) => allowed.has(href) && isInternalSiteHref(href));
  }, [text, siteLinks]);
  return <>{blocks.map((block, index) => {
    if (block.type === "heading") return <h3 key={index}>{inline(block.content)}</h3>;
    if (block.type === "paragraph") return <p key={index}>{inline(block.content)}</p>;
    if (block.type === "list") {
      const items = block.items.map((item, row) => <li key={row}>{inline(item)}</li>);
      return block.ordered ? <ol key={index} start={block.start === 1 ? undefined : block.start}>{items}</ol> : <ul key={index}>{items}</ul>;
    }
    return <div key={index} className={styles.answerTable} role="region" aria-label="Tabella della risposta" tabIndex={0}><table>
      <thead><tr>{block.head.map((cell, column) => <th key={column} scope="col">{inline(cell)}</th>)}</tr></thead>
      <tbody>{block.rows.map((row, line) => <tr key={line}>{row.map((cell, column) => <td key={column}>{inline(cell)}</td>)}</tr>)}</tbody>
    </table></div>;
  })}</>;
}
