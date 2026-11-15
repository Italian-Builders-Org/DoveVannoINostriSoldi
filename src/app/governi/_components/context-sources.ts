export type GovernmentContextSource = {
  owner: string;
  url: string;
  type: string;
};

function normalizeContextSourceUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${normalizedPath}${parsed.search}`;
}

/** Keeps the first source for each canonical URL; different URLs stay even with the same owner. */
export function dedupeContextSources(sources: readonly GovernmentContextSource[]): GovernmentContextSource[] {
  const uniqueByUrl = new Map<string, GovernmentContextSource>();
  for (const source of sources) {
    const key = normalizeContextSourceUrl(source.url);
    if (!uniqueByUrl.has(key)) uniqueByUrl.set(key, source);
  }
  return [...uniqueByUrl.values()];
}