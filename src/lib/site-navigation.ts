/** Primary navigation, dashboard taxonomy and search discovery catalogue. */

export type NavLink = Readonly<{
  href: string;
  label: string;
  group?: string;
}>;

export type NavSection = Readonly<{
  href: string;
  label: string;
  aliases?: readonly string[];
  children?: readonly NavLink[];
}>;

export type DashboardNavSection = NavSection & Readonly<{
  utility?: boolean;
  icon:
    | "overview"
    | "map"
    | "spending"
    | "institutions"
    | "business"
    | "contracts"
    | "projects"
    | "controls"
    | "comparison"
    | "reports"
    | "data"
    | "docs"
    | "assistant";
}>;

export const PRIMARY_NAV: readonly NavSection[] = [
  { href: "/", label: "Home" },
  {
    href: "/imprese",
    label: "Imprese",
    children: [
      { href: "/imprese", label: "Panoramica" },
      { href: "/imprese?metric=active_enterprises", label: "Imprese attive" },
      { href: "/imprese?metric=employees", label: "Addetti" },
      { href: "/imprese?metric=active_local_units", label: "Localizzazioni attive" },
      { href: "/imprese?metric=production_value_band_count", label: "Valore della produzione" },
      { href: "/imprese?metric=turnover", label: "Fatturato aggregato (ISTAT)" },
    ],
  },
  {
    href: "/spese",
    label: "Soldi",
    aliases: ["/stato"],
    children: [
      { href: "/spese", label: "Pagamenti comunali" },
      { href: "/spese/sanita", label: "Sanità" },
      { href: "/spese/sanita/storico", label: "Sanità · serie storica" },
      { href: "/spese/invalidita", label: "Invalidità INPS" },
      { href: "/spese/consulenze", label: "Consulenze ministeriali" },
      { href: "/spese/territoriale", label: "Spesa statale per territorio" },
      { href: "/spese/operative", label: "Spese operative" },
      { href: "/stato", label: "Amministrazioni centrali" },
      { href: "/debito", label: "Debito pubblico" },
      { href: "/spese/legge-di-bilancio", label: "Legge di Bilancio" },
      { href: "/stato/legislature", label: "Spesa per legislatura" },
    ],
  },
  {
    href: "/territori",
    label: "Territori",
    children: [
      { href: "/territori", label: "Panoramica" },
      { href: "/territori/irpef", label: "Redditi IRPEF" },
      { href: "/territori/fisco", label: "Entrate e spese" },
      { href: "/territori/confronto", label: "Confronto Comuni" },
    ],
  },
  {
    href: "/coesione",
    label: "Fondi e progetti",
    aliases: ["/confronti", "/pnrr", "/progetti"],
    children: [
      { href: "/coesione", label: "Coesione e PNRR" },
      { href: "/coesione/asili", label: "Asili e prima infanzia" },
      { href: "/confronti", label: "Confronti verificati" },
      { href: "/pnrr/incarichi", label: "Incarichi PNRR INDIRE" },
    ],
  },
  {
    href: "/istituzioni",
    label: "Istituzioni",
    aliases: ["/parlamento", "/palazzo-chigi", "/ministeri", "/regioni"],
    children: [
      { href: "/istituzioni", label: "Panoramica" },
      { href: "/parlamento", label: "Parlamento" },
      { href: "/palazzo-chigi", label: "Palazzo Chigi" },
      { href: "/ministeri", label: "Ministeri" },
      { href: "/regioni", label: "Regioni" },
    ],
  },
  {
    href: "/enti",
    label: "Enti e società",
    aliases: ["/partecipazioni"],
    children: [
      { href: "/enti", label: "Registro enti" },
      { href: "/partecipazioni", label: "Partecipazioni" },
    ],
  },
  {
    href: "/controlli",
    label: "Cosa controllare",
    aliases: ["/appalti", "/incarichi", "/dati", "/trasparenza"],
    children: [
      { href: "/appalti", label: "Appalti" },
      { href: "/incarichi", label: "Incarichi" },
      { href: "/dati", label: "Catalogo dati" },
      { href: "/controlli", label: "Segnali" },
      { href: "/esplora", label: "Esplora relazioni" },
    ],
  },
  { href: "/assistente", label: "Assistente" },
  {
    href: "/fonti",
    label: "Fonti",
    aliases: ["/metodologia"],
    children: [
      { href: "/fonti", label: "Elenco fonti" },
      { href: "/fonti/stato", label: "Stato delle fonti" },
      { href: "/fonti/copertura", label: "Copertura integrata" },
      { href: "/fonti/catalogo", label: "Catalogo delle fonti" },
      { href: "/metodologia", label: "Metodo" },
    ],
  },
] as const;

/**
 * Reference dashboard navigation. It reorganises every primary destination
 * into the thirteen plain-language families visible in the approved design,
 * without changing or removing any route.
 * PRIMARY_NAV remains the canonical compatibility map for route matching and
 * integrations; this collection owns the visible information architecture.
 */
export const DASHBOARD_NAV: readonly DashboardNavSection[] = [
  { href: "/", label: "Panoramica", icon: "overview" },
  {
    href: "/territori",
    label: "Mappa della spesa",
    icon: "map",
    aliases: ["/territori/irpef", "/territori/fisco"],
    children: [
      { href: "/territori", label: "Panoramica territoriale" },
      { href: "/territori/irpef", label: "Redditi IRPEF" },
      { href: "/territori/fisco", label: "Entrate e spese" },
    ],
  },
  {
    href: "/istituzioni",
    label: "Enti e Amministrazioni",
    icon: "institutions",
    aliases: ["/enti", "/parlamento", "/palazzo-chigi", "/ministeri", "/regioni", "/stato"],
    children: [
      { href: "/istituzioni", label: "Panoramica istituzioni", group: "Istituzioni" },
      { href: "/enti", label: "Registro enti" },
      { href: "/parlamento", label: "Parlamento" },
      { href: "/palazzo-chigi", label: "Palazzo Chigi" },
      { href: "/ministeri", label: "Ministeri" },
      { href: "/regioni", label: "Regioni" },
      { href: "/stato", label: "Amministrazioni centrali", group: "Amministrazioni centrali" },
      { href: "/stato/legislature", label: "Spesa per legislatura" },
    ],
  },
  {
    href: "/imprese",
    label: "Fornitori e Beneficiari",
    icon: "business",
    aliases: ["/partecipazioni"],
    children: [
      { href: "/imprese", label: "Panoramica imprese", group: "Imprese" },
      { href: "/imprese?metric=active_enterprises", label: "Imprese attive" },
      { href: "/imprese?metric=employees", label: "Addetti" },
      { href: "/imprese?metric=active_local_units", label: "Localizzazioni attive" },
      { href: "/imprese?metric=production_value_band_count", label: "Valore della produzione" },
      { href: "/imprese?metric=turnover", label: "Fatturato aggregato (ISTAT)" },
      { href: "/partecipazioni", label: "Partecipazioni pubbliche", group: "Beneficiari e partecipate" },
      { href: "/appalti/fornitori", label: "Fornitori e aggiudicatari" },
      { href: "/incarichi/nominativi", label: "Nominativi e curriculum" },
    ],
  },
  {
    href: "/appalti",
    label: "Contratti e Gare",
    icon: "contracts",
    aliases: ["/incarichi", "/pnrr/incarichi"],
    children: [
      { href: "/appalti", label: "Appalti", group: "Appalti" },
      { href: "/appalti/dettaglio", label: "Appalti di dettaglio" },
      { href: "/appalti/affidamenti-diretti", label: "Affidamenti diretti e CIG" },
      { href: "/appalti/rinnovi-proroghe", label: "Rinnovi e proroghe" },
      { href: "/appalti/consip-da-confrontare", label: "Acquisti da confrontare" },
      { href: "/incarichi", label: "Incarichi pubblici", group: "Incarichi" },
      { href: "/incarichi/dettaglio", label: "Incarichi di dettaglio" },
      { href: "/incarichi/consulenze-legali", label: "Consulenze legali" },
      { href: "/incarichi/pnrr", label: "Consulenze e incarichi PNRR" },
      { href: "/incarichi/personale-organi", label: "Personale, staff e organi" },
      { href: "/pnrr/incarichi", label: "Incarichi PNRR INDIRE" },
      { href: "/esplora", label: "Esplora relazioni", group: "Analisi trasversale" },
    ],
  },
  {
    href: "/coesione",
    label: "Progetti e Opere",
    icon: "projects",
    aliases: ["/progetti"],
    children: [
      { href: "/coesione", label: "Coesione e PNRR" },
      { href: "/coesione/asili", label: "Asili e prima infanzia" },
    ],
  },
  {
    href: "/spese",
    label: "Spesa per Categoria",
    icon: "spending",
    aliases: ["/debito"],
    children: [
      { href: "/spese", label: "Pagamenti comunali", group: "Comuni e prestazioni" },
      { href: "/spese/sanita", label: "Sanità" },
      { href: "/spese/sanita/storico", label: "Sanità · serie storica" },
      { href: "/spese/invalidita", label: "Invalidità INPS" },
      { href: "/spese/operative", label: "Spese operative", group: "Categorie di spesa" },
      { href: "/spese/consulenze", label: "Consulenze ministeriali" },
      { href: "/spese/eventi", label: "Eventi e convegni" },
      { href: "/spese/campagne", label: "Campagne e pubblicità" },
      { href: "/spese/affitti", label: "Affitti e immobili" },
      { href: "/spese/missioni", label: "Missioni e trasferte" },
      { href: "/spese/auto-welfare", label: "Auto e welfare" },
      { href: "/spese/rimborsi", label: "Rimborsi spese" },
      { href: "/spese/capitoli-progetti", label: "Capitoli e progetti" },
      { href: "/spese/territoriale", label: "Spesa statale per territorio", group: "Stato e debito" },
      { href: "/spese/legge-di-bilancio", label: "Legge di Bilancio" },
      { href: "/debito", label: "Debito pubblico" },
    ],
  },
  {
    href: "/controlli",
    label: "Anomalie e Sprechi",
    icon: "controls",
    aliases: ["/trasparenza"],
    children: [
      { href: "/controlli", label: "Segnali da approfondire", group: "Controlli" },
      { href: "/controlli/corte-dei-conti", label: "Atti della Corte dei conti" },
      { href: "/controlli/working-set", label: "Casi da verificare" },
      { href: "/trasparenza", label: "Trasparenza e verifiche", group: "Trasparenza" },
      { href: "/trasparenza/documenti-mancanti", label: "Documenti non reperibili" },
      { href: "/trasparenza/perimetro-enti", label: "Perimetro degli enti" },
    ],
  },
  {
    href: "/confronti",
    label: "Confronti e Benchmark",
    icon: "comparison",
    aliases: ["/territori/confronto"],
    children: [
      { href: "/confronti", label: "Confronti verificati" },
      { href: "/confronti/catalogo", label: "Benchmark da rendere omogenei" },
      { href: "/territori/confronto", label: "Confronto Comuni" },
    ],
  },
  {
    href: "/assistente",
    label: "AI Insights",
    icon: "assistant",
  },
  {
    href: "/supporto",
    label: "Segnalazioni dei cittadini",
    icon: "reports",
    aliases: ["/controlli/segnalazioni"],
    children: [
      { href: "/supporto", label: "Invia una segnalazione" },
      { href: "/controlli/segnalazioni", label: "Segnalazioni da spiegare" },
    ],
  },
  {
    href: "/dati",
    label: "Open Data",
    icon: "data",
    aliases: ["/mcp", "/fonti/stato", "/fonti/copertura", "/fonti/catalogo"],
    children: [
      { href: "/dati", label: "Tutti i dataset", group: "Dati aperti" },
      { href: "/mcp", label: "Accesso MCP" },
      { href: "/fonti/stato", label: "Stato delle fonti", group: "Copertura" },
      { href: "/fonti/copertura", label: "Copertura integrata" },
      { href: "/fonti/catalogo", label: "Catalogo delle fonti" },
    ],
  },
  {
    href: "/metodologia",
    label: "Documentazione",
    icon: "docs",
    aliases: ["/fonti", "/privacy", "/termini", "/supporter"],
    children: [
      { href: "/metodologia", label: "Metodologia", group: "Metodo e fonti" },
      { href: "/fonti", label: "Elenco fonti" },
      { href: "/cerca", label: "Cerca nella piattaforma", group: "Strumenti" },
      { href: "/supporter", label: "Chi siamo", group: "Progetto" },
      { href: "/privacy", label: "Privacy" },
      { href: "/termini", label: "Termini" },
    ],
  },
] as const;

export const SITE_MAP_GROUPS: readonly { title: string; links: readonly NavLink[] }[] = [
  { title: "Home", links: [{ href: "/", label: "Home" }] },
  {
    title: "Imprese",
    links: [
      { href: "/imprese", label: "Panoramica" },
      { href: "/imprese?metric=active_enterprises", label: "Imprese attive" },
      { href: "/imprese?metric=employees", label: "Addetti" },
      { href: "/imprese?metric=active_local_units", label: "Localizzazioni attive" },
      { href: "/imprese?metric=production_value_band_count", label: "Valore della produzione" },
      { href: "/imprese?metric=turnover", label: "Fatturato aggregato (ISTAT)" },
    ],
  },
  {
    title: "Soldi",
    links: [
      { href: "/spese", label: "Pagamenti comunali" },
      { href: "/spese/sanita", label: "Sanità" },
      { href: "/spese/sanita/storico", label: "Sanità · serie storica" },
      { href: "/spese/invalidita", label: "Invalidità INPS" },
      { href: "/spese/consulenze", label: "Consulenze ministeriali" },
      { href: "/spese/territoriale", label: "Spesa statale per territorio" },
      { href: "/spese/operative", label: "Spese operative" },
      { href: "/stato", label: "Amministrazioni centrali" },
      { href: "/debito", label: "Debito pubblico" },
      { href: "/spese/legge-di-bilancio", label: "Legge di Bilancio" },
      { href: "/stato/legislature", label: "Spesa per legislatura" },
    ],
  },
  {
    title: "Territori",
    links: [
      { href: "/territori", label: "Panoramica" },
      { href: "/territori/irpef", label: "Redditi IRPEF" },
      { href: "/territori/fisco", label: "Entrate e spese" },
      { href: "/territori/confronto", label: "Confronto Comuni" },
    ],
  },
  {
    title: "Fondi e progetti",
    links: [
      { href: "/coesione", label: "Coesione e PNRR" },
      { href: "/coesione/asili", label: "Asili e prima infanzia" },
      { href: "/confronti", label: "Confronti verificati" },
      { href: "/pnrr/incarichi", label: "Incarichi PNRR INDIRE" },
    ],
  },
  {
    title: "Istituzioni",
    links: [
      { href: "/istituzioni", label: "Panoramica" },
      { href: "/parlamento", label: "Parlamento" },
      { href: "/palazzo-chigi", label: "Palazzo Chigi" },
      { href: "/ministeri", label: "Ministeri" },
      { href: "/regioni", label: "Regioni" },
    ],
  },
  {
    title: "Enti e società",
    links: [
      { href: "/enti", label: "Registro enti" },
      { href: "/partecipazioni", label: "Partecipazioni" },
    ],
  },
  {
    title: "Cosa controllare",
    links: [
      { href: "/appalti", label: "Appalti" },
      { href: "/appalti/dettaglio", label: "Appalti di dettaglio" },
      { href: "/incarichi", label: "Incarichi" },
      { href: "/incarichi/dettaglio", label: "Incarichi di dettaglio" },
      { href: "/dati", label: "Catalogo dati" },
      { href: "/controlli", label: "Segnali" },
      { href: "/trasparenza", label: "Trasparenza e verifiche" },
      { href: "/confronti", label: "Confronti verificati" },
      { href: "/esplora", label: "Esplora relazioni" },
    ],
  },
  {
    title: "Strumenti",
    links: [
      { href: "/cerca", label: "Cerca in tutta la piattaforma" },
      { href: "/assistente", label: "Assistente" },
      { href: "/mcp", label: "Istruzioni MCP" },
      { href: "/supporto", label: "Supporto" },
      { href: "/supporter", label: "Chi ci sostiene" },
    ],
  },
  {
    title: "Fonti e metodo",
    links: [
      { href: "/fonti", label: "Elenco fonti" },
      { href: "/fonti/stato", label: "Stato delle fonti" },
      { href: "/fonti/copertura", label: "Copertura integrata" },
      { href: "/fonti/catalogo", label: "Catalogo delle fonti" },
      { href: "/metodologia", label: "Metodo" },
    ],
  },
  {
    title: "Legale",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/termini", label: "Termini" },
    ],
  },
] as const;

type NavigationLocation = Readonly<{
  pathname: string;
  searchParams: URLSearchParams;
}>;

function parseNavigationLocation(value: string, search = ""): NavigationLocation {
  const [pathname = "/", inlineSearch = ""] = value.split("?", 2);
  return {
    pathname: pathname || "/",
    searchParams: new URLSearchParams(search || inlineSearch),
  };
}

function pathMatches(pathname: string, target: string): boolean {
  return pathname === target || pathname.startsWith(`${target}/`);
}

function hrefMatchesLocation(
  location: NavigationLocation,
  href: string,
): boolean {
  const target = parseNavigationLocation(href);
  if (!pathMatches(location.pathname, target.pathname)) return false;

  for (const [key, value] of target.searchParams) {
    if (location.searchParams.get(key) !== value) return false;
  }
  return true;
}

function isMoreSpecificHref(candidateHref: string, currentHref: string): boolean {
  const candidate = parseNavigationLocation(candidateHref);
  const current = parseNavigationLocation(currentHref);
  if (candidate.pathname.length !== current.pathname.length) {
    return candidate.pathname.length > current.pathname.length;
  }
  return candidate.searchParams.size > current.searchParams.size;
}

export function isNavSectionActive(pathname: string, item: NavSection): boolean {
  const location = parseNavigationLocation(pathname);
  if (item.href === "/") return location.pathname === "/";
  if (pathMatches(location.pathname, item.href)) return true;
  if (item.aliases?.some((alias) => pathMatches(location.pathname, alias))) return true;
  return (
    item.children?.some(
      (child) => hrefMatchesLocation(location, child.href),
    ) ?? false
  );
}

export function activeNavSection(pathname: string): NavSection | null {
  const location = parseNavigationLocation(pathname);
  if (location.pathname === "/") return null;

  function ownershipScore(item: NavSection): number {
    const childSpecificity = Math.max(
      0,
      ...(item.children ?? [])
        .filter((child) => hrefMatchesLocation(location, child.href))
        .map((child) => {
          const target = parseNavigationLocation(child.href);
          return 10_000 + target.pathname.length * 10 + target.searchParams.size;
        }),
    );
    if (childSpecificity > 0) return childSpecificity;
    if (pathMatches(location.pathname, item.href)) return 1_000 + item.href.length;
    return Math.max(
      0,
      ...(item.aliases ?? [])
        .filter((alias) => pathMatches(location.pathname, alias))
        .map((alias) => 100 + alias.length),
    );
  }

  return (
    DASHBOARD_NAV
      .filter((item) => isNavSectionActive(pathname, item))
      .sort((left, right) => ownershipScore(right) - ownershipScore(left))[0] ?? null
  );
}

export function isNavChildActive(
  pathname: string,
  childHref: string,
  siblings: readonly NavLink[],
  search = "",
): boolean {
  const location = parseNavigationLocation(pathname, search);
  const queryKeys = new Set(
    siblings.flatMap((child) => [...parseNavigationLocation(child.href).searchParams.keys()]),
  );
  const matches = siblings.filter((child) => {
    if (!hrefMatchesLocation(location, child.href)) return false;

    // A queryless overview is the fallback only when the URL is not choosing a
    // query-backed sibling. This prevents "Panoramica" from being announced
    // as current while, for example, ?metric=employees is selected.
    const target = parseNavigationLocation(child.href);
    return (
      target.searchParams.size > 0 ||
      ![...queryKeys].some((key) => location.searchParams.has(key))
    );
  });
  if (matches.length === 0) return false;
  const best = matches.reduce((current, candidate) =>
    isMoreSpecificHref(candidate.href, current.href) ? candidate : current,
  );
  return best.href === childHref;
}
