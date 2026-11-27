import "server-only";

import { AI_MAX_SITE_LINKS, isInternalSiteHref, type AiSiteLink } from "@/lib/assistant/byok-contracts";
import { sanitizeMarkdownLinks } from "@/lib/assistant/markdown-link-sanitizer";
import { cleanSiteLink, linksForDatasetQuery, sitePageKey, sitePathname } from "@/lib/assistant/site-link-map";
import { searchSiteLinks } from "@/lib/assistant/site-link-search";
import type { DatasetQuery } from "@/lib/mcp/catalog";

/**
 * Pages offered with an answer: the pages of the datasets actually consulted first,
 * then site pages matching the question, one per page, at most AI_MAX_SITE_LINKS.
 */
export function selectAssistantSiteLinks(queries: readonly DatasetQuery[], question: string): AiSiteLink[] {
  const selected: AiSiteLink[] = [];
  const seenKeys = new Set<string>();
  const seenPaths = new Set<string>();
  const add = (candidate: AiSiteLink, oncePerPath: boolean) => {
    const link = cleanSiteLink(candidate);
    if (!link || selected.length >= AI_MAX_SITE_LINKS) return;
    const key = sitePageKey(link.href);
    const path = sitePathname(link.href);
    if (seenKeys.has(key) || (oncePerPath && seenPaths.has(path))) return;
    seenKeys.add(key);
    seenPaths.add(path);
    selected.push(link);
  };
  for (const query of queries) for (const link of linksForDatasetQuery(query)) add(link, false);
  if (selected.length < AI_MAX_SITE_LINKS && question.trim()) {
    for (const link of searchSiteLinks(question, { hasDatasetLinks: selected.length > 0 })) add(link, true);
  }
  return selected;
}

/** Keeps inline links only to the pages offered with this answer. */
export function sanitizeAssistantLinks(text: string, siteLinks: readonly AiSiteLink[]): string {
  return sanitizeMarkdownLinks(text, new Set(siteLinks.map((link) => link.href).filter(isInternalSiteHref)));
}
