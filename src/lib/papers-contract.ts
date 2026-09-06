export type PublishedPaper = Readonly<{
  status: "published";
  slug: string;
  title: string;
  abstract: string;
  authors: readonly string[];
  publishedOn: string;
  version: string;
  webPath?: `/studi/${string}`;
  limitations: string;
  pdfUrl: string;
  pdfSha256: string;
  reproducibilityUrl: string;
}>;

function publicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}

export function validatePublishedPaper(paper: PublishedPaper): PublishedPaper {
  const date = new Date(`${paper.publishedOn}T00:00:00Z`);
  if (paper.status !== "published" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(paper.slug)
    || !/^\d{4}-\d{2}-\d{2}$/.test(paper.publishedOn) || !Number.isFinite(date.getTime())
    || date.toISOString().slice(0, 10) !== paper.publishedOn
    || typeof paper.version !== "string"
    || !/^[1-9]\d*(?:\.(?:0|[1-9]\d*)){0,2}$/.test(paper.version)
    || (paper.webPath !== undefined && !/^\/studi\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(paper.webPath))
    || [paper.title, paper.abstract, paper.limitations].some((text) => !text.trim())
    || !paper.authors.length || paper.authors.some((name) => !name.trim())
    || !/^[a-f0-9]{64}$/.test(paper.pdfSha256)
    || !publicUrl(paper.pdfUrl) || !publicUrl(paper.reproducibilityUrl)) {
    throw new Error("Paper pubblicato non valido: controllare identità, data, autori, limiti e artefatti pubblici");
  }
  return paper;
}

export function createPapersCatalog(entries: readonly PublishedPaper[]) {
  const papers = entries.map((entry) => validatePublishedPaper(structuredClone(entry)));
  if (new Set(papers.map((paper) => paper.slug)).size !== papers.length) throw new Error("Slug paper duplicato");
  papers.sort((a, b) => b.publishedOn.localeCompare(a.publishedOn) || a.slug.localeCompare(b.slug));
  return Object.freeze({ listPublished: () => structuredClone(papers) as readonly PublishedPaper[] });
}
