import type { MetadataRoute } from "next";

type PublicPath = "/" | `/${string}`;

/**
 * Canonical pages that search engines may index. This is deliberately
 * separate from the visual navigation: a page can remain public even when it
 * is not promoted in the header or footer.
 *
 * Dynamic entity, project and dataset pages are omitted until their complete
 * canonical URL sets can be enumerated without making sitemap generation
 * depend on request-time data.
 */
export const PUBLIC_INDEXABLE_PATHS = [
  "/",
  "/appalti",
  "/appalti/dettaglio",
  "/assistente",
  "/coesione",
  "/coesione/asili",
  "/confronti",
  "/controlli",
  "/dati",
  "/debito",
  "/enti",
  "/esplora",
  "/fonti",
  "/fonti/catalogo",
  "/fonti/copertura",
  "/fonti/stato",
  "/governi",
  "/governi/confronta",
  "/imprese",
  "/incarichi",
  "/incarichi/dettaglio",
  "/istituzioni",
  "/istruzione",
  "/mcp",
  "/metodologia",
  "/ministeri",
  "/palazzo-chigi",
  "/parlamento",
  "/partecipazioni",
  "/pnrr/incarichi",
  "/privacy",
  "/regioni",
  "/spese",
  "/spese/consulenze",
  "/spese/invalidita",
  "/spese/legge-di-bilancio",
  "/spese/operative",
  "/spese/sanita",
  "/spese/sanita/storico",
  "/spese/territoriale",
  "/stato",
  "/stato/legislature",
  "/supporter",
  "/supporto",
  "/termini",
  "/territori",
  "/territori/confronto",
  "/territori/fisco",
  "/territori/irpef",
  "/trasparenza",
  "/appalti/affidamenti-diretti",
  "/appalti/fornitori",
  "/appalti/rinnovi-proroghe",
  "/appalti/consip-da-confrontare",
  "/incarichi/consulenze-legali",
  "/incarichi/pnrr",
  "/incarichi/nominativi",
  "/incarichi/personale-organi",
  "/spese/eventi",
  "/spese/campagne",
  "/spese/affitti",
  "/spese/missioni",
  "/spese/auto-welfare",
  "/spese/rimborsi",
  "/spese/capitoli-progetti",
  "/trasparenza/documenti-mancanti",
  "/trasparenza/perimetro-enti",
  "/controlli/segnalazioni",
  "/controlli/corte-dei-conti",
  "/controlli/working-set",
  "/confronti/catalogo",
] as const satisfies readonly PublicPath[];

/** Public pages that crawlers may visit but must not index. */
export const PUBLIC_NOINDEX_PATHS = [
  "/cerca",
] as const satisfies readonly PublicPath[];

/** Pages that the concise llms.txt overview must always expose. */
export const LLMS_DISCOVERY_PATHS = [
  "/",
  "/spese",
  "/territori",
  "/territori/irpef",
  "/stato",
  "/spese/legge-di-bilancio",
  "/coesione",
  "/enti",
  "/istruzione",
  "/parlamento",
  "/governi",
  "/controlli",
  "/fonti",
  "/mcp",
  "/assistente",
  "/metodologia",
  "/privacy",
  "/supporter",
] as const satisfies readonly (typeof PUBLIC_INDEXABLE_PATHS)[number][];

export function publicSitemap(siteUrl: string): MetadataRoute.Sitemap {
  return PUBLIC_INDEXABLE_PATHS.map((path) => ({
    url: new URL(path, siteUrl).href,
  }));
}

export function publicRobots(siteUrl: string): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
