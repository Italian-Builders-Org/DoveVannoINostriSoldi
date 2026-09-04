/**
 * Primary navigation and footer sitemap. One source so header submenus and the
 * footer map stay aligned.
 */

export type NavLink = Readonly<{
  href: string;
  label: string;
}>;

export type NavSection = Readonly<{
  href: string;
  label: string;
  aliases?: readonly string[];
  children?: readonly NavLink[];
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
  { href: "/istruzione", label: "Istruzione" },
  {
    href: "/spese",
    label: "Soldi",
    aliases: ["/stato"],
    children: [
      { href: "/spese", label: "Pagamenti comunali" },
      { href: "/spese/sanita", label: "Sanità" },
      { href: "/spese/sanita/storico", label: "Sanità · serie storica" },
      { href: "/spese/sport", label: "Sport" },
      { href: "/spese/invalidita", label: "Invalidità INPS" },
      { href: "/spese/pensioni", label: "Pensioni e pensionati" },
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
    aliases: ["/parlamento", "/palazzo-chigi", "/governi", "/ministeri", "/regioni"],
    children: [
      { href: "/istituzioni", label: "Panoramica" },
      { href: "/parlamento", label: "Parlamento" },
      { href: "/palazzo-chigi", label: "Palazzo Chigi" },
      { href: "/governi", label: "Pagella dei governi" },
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
    aliases: ["/appalti", "/incarichi", "/dati", "/trasparenza", "/controlli/sintesi"],
    children: [
      { href: "/appalti", label: "Appalti" },
      { href: "/incarichi", label: "Incarichi" },
      { href: "/dati", label: "Catalogo dati" },
      { href: "/controlli", label: "Segnali" },
      { href: "/controlli/sintesi", label: "Sintesi" },
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
      { href: "/fonti/calendario", label: "Calendario documenti" },
      { href: "/fonti/stato", label: "Stato delle fonti" },
      { href: "/fonti/copertura", label: "Copertura integrata" },
      { href: "/fonti/catalogo", label: "Catalogo delle fonti" },
      { href: "/metodologia", label: "Metodo" },
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
  { title: "Istruzione", links: [{ href: "/istruzione", label: "Atlante Istruzione" }] },
  {
    title: "Soldi",
    links: [
      { href: "/spese", label: "Pagamenti comunali" },
      { href: "/spese/sanita", label: "Sanità" },
      { href: "/spese/sanita/storico", label: "Sanità · serie storica" },
      { href: "/spese/sport", label: "Sport" },
      { href: "/spese/invalidita", label: "Invalidità INPS" },
      { href: "/spese/pensioni", label: "Pensioni e pensionati" },
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
      { href: "/governi", label: "Pagella dei governi" },
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
      { href: "/controlli/sintesi", label: "Sintesi" },
      { href: "/trasparenza", label: "Trasparenza e verifiche" },
    ],
  },
  {
    title: "Strumenti",
    links: [
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
      { href: "/fonti/calendario", label: "Calendario documenti" },
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

/** Footer map: main sections only, in reading order; CSS balances them into columns. */
export const FOOTER_SITEMAP_GROUPS: readonly { title: string; links: readonly NavLink[] }[] =
  SITE_MAP_GROUPS.filter((group) => group.title !== "Home" && group.title !== "Legale");

export const FOOTER_SITEMAP_COLUMNS = 4;

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
  if (parseNavigationLocation(pathname).pathname === "/") return null;
  return (
    PRIMARY_NAV.filter((item) => item.children && item.children.length > 0)
      .filter((item) => isNavSectionActive(pathname, item))
      .sort((left, right) => right.href.length - left.href.length)[0] ?? null
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
