import { parseHTML } from "linkedom";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** HTML consentito nelle tile di testo board (no script, no eventi). */

const ALLOWED_TAGS = new Set([
  "P",
  "BR",
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "SPAN",
  "DIV",
]);

const ALLOWED_STYLES = new Set([
  "color",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "text-decoration",
  "text-align",
]);

function sanitizeStyle(value: string): string | null {
  const parts: string[] = [];
  for (const declaration of value.split(";")) {
    const [rawProp, ...rest] = declaration.split(":");
    if (!rawProp || rest.length === 0) continue;
    const prop = rawProp.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (!ALLOWED_STYLES.has(prop) || !val) continue;
    if (/expression|url\s*\(|javascript:/iu.test(val)) continue;
    parts.push(`${prop}: ${val}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

function parseSanitizeRoot(html: string): Element | null {
  const wrapped = `<div>${html}</div>`;
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(wrapped, "text/html");
    return doc.body.firstElementChild;
  }
  const { document } = parseHTML(wrapped);
  return document.firstElementChild;
}

/** Sanitizza HTML lato client (DOMParser). */
export function sanitizeBoardHtml(html: string): string {
  const root = parseSanitizeRoot(html);
  if (!root) return "";
  const walk = (node: Node): string => {
    if (node.nodeType === TEXT_NODE) {
      return node.textContent ?? "";
    }
    if (node.nodeType !== ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE") return "";
    // execCommand produce ancora <font>; lo convertiamo in <span style="…">.
    if (tag === "FONT") {
      const parts: string[] = [];
      const color = el.getAttribute("color");
      const face = el.getAttribute("face");
      const size = el.getAttribute("size");
      if (color) parts.push(`color: ${color}`);
      if (face) parts.push(`font-family: ${face}`);
      if (size) {
        const map: Record<string, string> = {
          "1": "0.75rem",
          "2": "0.85rem",
          "3": "1rem",
          "4": "1.15rem",
          "5": "1.35rem",
          "6": "1.6rem",
          "7": "1.85rem",
        };
        parts.push(`font-size: ${map[size] ?? "1rem"}`);
      }
      const existing = el.getAttribute("style");
      if (existing) {
        const safe = sanitizeStyle(existing);
        if (safe) parts.push(safe);
      }
      const style = parts.length > 0 ? ` style="${parts.join("; ")}"` : "";
      const inner = Array.from(el.childNodes).map(walk).join("");
      return style ? `<span${style}>${inner}</span>` : inner;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      return Array.from(el.childNodes).map(walk).join("");
    }
    if (tag === "BR") return "<br>";
    const style = el.getAttribute("style");
    const safeStyle = style ? sanitizeStyle(style) : null;
    const open = safeStyle ? `<${tag.toLowerCase()} style="${safeStyle}">` : `<${tag.toLowerCase()}>`;
    const inner = Array.from(el.childNodes).map(walk).join("");
    if (tag === "SPAN" && !safeStyle) return inner;
    return `${open}${inner}</${tag.toLowerCase()}>`;
  };
  return Array.from(root.childNodes).map(walk).join("").slice(0, 8_000);
}

/** Testo piano per title/export. */
export function plainTextFromHtml(html: string): string {
  const root = parseSanitizeRoot(html);
  const text = (root?.textContent ?? html)
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return text.slice(0, 120) || "Testo";
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function paragraphHtml(text: string, style?: string): string {
  const safe = escapeHtml(text);
  return style ? `<p style="${style}">${safe}</p>` : `<p>${safe}</p>`;
}

/** Converte body legacy (testo piano) o HTML già presente in HTML sanitizzato. */
export function ensureBoardHtml(raw: string | undefined | null, fallback = ""): string {
  const value = (raw ?? "").trim();
  if (!value) return fallback ? paragraphHtml(fallback) : "";
  if (/<[a-z][\s\S]*>/iu.test(value)) {
    return sanitizeBoardHtml(value);
  }
  return paragraphHtml(value);
}
