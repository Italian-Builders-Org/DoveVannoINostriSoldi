import { Fragment, type ReactNode } from "react";

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
    if (lines.every((line) => /^\s*[-*] /u.test(line))) return <ul key={index}>{lines.map((line, row) => <li key={row}>{inline(line.replace(/^\s*[-*] /u, ""))}</li>)}</ul>;
    if (lines.every((line) => /^\s*\d+\. /u.test(line))) return <ol key={index}>{lines.map((line, row) => <li key={row}>{inline(line.replace(/^\s*\d+\. /u, ""))}</li>)}</ol>;
    if (/^#{1,3} /u.test(block) && lines.length === 1) return <h3 key={index}>{inline(block.replace(/^#{1,3} /u, ""))}</h3>;
    return <p key={index}>{inline(block)}</p>;
  })}</>;
}
