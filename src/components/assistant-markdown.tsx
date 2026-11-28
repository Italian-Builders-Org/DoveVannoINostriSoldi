import { Fragment, useMemo, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { isInternalSiteHref, type AiSiteLink } from "@/lib/assistant/byok-contracts";
import { keepFiguresWithUnits, parseAssistantMarkdown, type AssistantBlock, type AssistantInline } from "@/components/assistant-markdown-parse";
import styles from "@/app/assistente/assistant.module.css";

const NO_LINKS: readonly AiSiteLink[] = [];

function inline(nodes: AssistantInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === "text") return <Fragment key={index}>{keepFiguresWithUnits(node.text)}</Fragment>;
    if (node.type === "code") return <code key={index}>{node.text}</code>;
    if (node.type === "strong") return <strong key={index}>{inline(node.children)}</strong>;
    if (node.type === "em") return <em key={index}>{inline(node.children)}</em>;
    // New tab like the site-link cards: the in-memory conversation must survive the visit.
    return <a key={index} href={node.href} target="_blank" rel="noopener" className={styles.inlineSiteLink}>{inline(node.children)}{/* Same new-tab mark as sources and cards; the word joiner keeps it on the last word. */}{"\u2060"}<HugeiconsIcon icon={ArrowUpRight01Icon} size={12} strokeWidth={2} aria-hidden="true" /><span className={styles.srOnly}> (nuova scheda)</span></a>;
  });
}

/** Parses model text, letting through only hrefs from this answer's `siteLinks` that pass the site contract. */
export function useAssistantBlocks(text: string, siteLinks: readonly AiSiteLink[] = NO_LINKS, streaming = false): AssistantBlock[] {
  return useMemo(() => {
    const allowed = new Set(siteLinks.map((link) => link.href));
    return parseAssistantMarkdown(text, (href) => allowed.has(href) && isInternalSiteHref(href), { streaming });
  }, [text, siteLinks, streaming]);
}

/** Already-parsed model text as escaped React nodes. */
export function AssistantMarkdownBlocks({ blocks }: { blocks: AssistantBlock[] }) {
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

/** Model text as escaped React nodes; `streaming` hides an unfinished link or bold at the end. */
export function AssistantMarkdown({ text, siteLinks, streaming = false }: { text: string; siteLinks?: readonly AiSiteLink[]; streaming?: boolean }) {
  return <AssistantMarkdownBlocks blocks={useAssistantBlocks(text, siteLinks, streaming)} />;
}
