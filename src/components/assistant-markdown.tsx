import { Fragment, type ReactNode } from "react";
import styles from "@/app/assistente/assistant.module.css";

/** Intentionally small Markdown subset: no HTML, images or model-controlled links. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/u).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part.startsWith("`") && part.endsWith("`") ? <code key={index}>{part.slice(1, -1)}</code>
        : <Fragment key={index}>{part}</Fragment>,
  );
}

export function AssistantMarkdown({ text }: { text: string }) {
  return <>{text.split(/\n\s*\n/u).map((block, index) => {
    const lines = block.split("\n");
    const cells = (line: string) => line.trim().replace(/^\||\|$/gu, "").split("|").map((cell) => cell.trim());
    if (lines.length >= 2 && lines[0].includes("|") && cells(lines[1]).every((cell) => /^:?-{3,}:?$/u.test(cell))) {
      const headings = cells(lines[0]);
      if (headings.length <= 8 && lines.slice(2).every((line) => cells(line).length === headings.length)) return <div key={index} className={styles.answerTable} role="region" aria-label="Tabella della risposta" tabIndex={0}><table><thead><tr>{headings.map((cell, column) => <th key={column} scope="col">{inline(cell)}</th>)}</tr></thead><tbody>{lines.slice(2).map((line, row) => <tr key={row}>{cells(line).map((cell, column) => <td key={column}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>;
    }
    if (lines.every((line) => /^\s*[-*] /u.test(line))) return <ul key={index}>{lines.map((line, row) => <li key={row}>{inline(line.replace(/^\s*[-*] /u, ""))}</li>)}</ul>;
    if (lines.every((line) => /^\s*\d+\. /u.test(line))) return <ol key={index}>{lines.map((line, row) => <li key={row}>{inline(line.replace(/^\s*\d+\. /u, ""))}</li>)}</ol>;
    if (/^#{1,3} /u.test(block) && lines.length === 1) return <h3 key={index}>{inline(block.replace(/^#{1,3} /u, ""))}</h3>;
    return <p key={index}>{inline(block)}</p>;
  })}</>;
}
