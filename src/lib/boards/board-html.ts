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

/** Sanitizza HTML lato client (DOMParser). */
export function sanitizeBoardHtml(html: string): string {
  if (typeof DOMParser === "undefined") {
    return stripTagsFallback(html);
  }
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName;
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

/** Rimuove script/style in loop finché il markup non cambia (anti nested injection). */
function stripDangerousBlocks(html: string): string {
  let current = html;
  let previous = "";
  while (current !== previous) {
    previous = current;
    current = current
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, "");
  }
  return current;
}

/**
 * Fallback senza DOMParser: solo tag allowlist, attributi limitati a style filtrato.
 */
function stripTagsFallback(html: string): string {
  const withoutDanger = stripDangerousBlocks(html);
  return withoutDanger
    .replace(/<\/?([a-z0-9]+)([^>]*)>/giu, (full, rawTag: string, attrs: string) => {
      const tag = rawTag.toUpperCase();
      const closing = full.startsWith("</");
      if (tag === "BR") return closing ? "" : "<br>";
      if (!ALLOWED_TAGS.has(tag)) return "";
      if (closing) return `</${tag.toLowerCase()}>`;
      const styleMatch = attrs.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/iu);
      const style = styleMatch ? sanitizeStyle(styleMatch[2] ?? styleMatch[3] ?? "") : null;
      return style ? `<${tag.toLowerCase()} style="${style}">` : `<${tag.toLowerCase()}>`;
    })
    .slice(0, 8_000);
}

/** Testo piano per title/export. */
export function plainTextFromHtml(html: string): string {
  const withoutTags = stripDangerousBlocks(html)
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<\/p\s*>/giu, "\n")
    .replace(/<[^>]*>/gu, "");
  // Decodifica entità in ordine sicuro: &amp; per ultimo.
  const text = withoutTags
    .replace(/&nbsp;/gu, " ")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, "&")
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
