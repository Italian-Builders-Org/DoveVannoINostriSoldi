"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { FOOTER_SITEMAP_GROUPS } from "@/lib/site-navigation";
import { MOBILITA_MAP_PATH } from "@/lib/site";
import { filterDirectory } from "@/lib/frontend-exploration";
import styles from "./site-directory.module.css";

const maps = { title: "Mappe", links: [
  { href: "/comuni", label: "Mappa dei Comuni" },
  { href: "/politici", label: "Mappa della politica" },
  { href: MOBILITA_MAP_PATH, label: "Mappa della mobilità" },
] };
const wideQuery = "(min-width: 761px)";
function subscribeWidth(callback: () => void) {
  const media = window.matchMedia(wideQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const getWide = () => window.matchMedia(wideQuery).matches;
const getServerWide = () => true;
function subscribeHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  window.addEventListener("popstate", callback);
  return () => {
    window.removeEventListener("hashchange", callback);
    window.removeEventListener("popstate", callback);
  };
}
const getHash = () => window.location.hash;
const getServerHash = () => "";

function DirectoryGroup({ group, initiallyOpen }: Readonly<{
  group: (typeof FOOTER_SITEMAP_GROUPS)[number]; initiallyOpen: boolean;
}>) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const hash = useSyncExternalStore(subscribeHash, getHash, getServerHash);
  const mapsId = group.title === "Mappe" ? "maps-title" : undefined;
  // pathname re-render after soft-nav re-reads getHash even without hashchange.
  const hashTargetsMaps = mapsId != null && pathname === "/" && hash === `#${mapsId}`;
  const open = expanded ?? (initiallyOpen || hashTargetsMaps);
  useEffect(() => {
    if (!hashTargetsMaps || !mapsId) return;
    document.getElementById(mapsId)?.scrollIntoView({ block: "start" });
  }, [hashTargetsMaps, mapsId, pathname]);
  return <details className={styles.group} open={open} aria-labelledby={mapsId}>
    <summary onClick={(event) => { event.preventDefault(); setExpanded(!open); }}>
      <h3 id={mapsId}>{group.title}</h3>
      <span className={styles.count}>{group.links.length}</span>
    </summary>
    <ul>{group.links.map((link) => <li key={link.href}>
      <Link prefetch={false} href={link.href}>{link.label}</Link>
    </li>)}</ul>
  </details>;
}

export function SiteDirectory({ showMaps = false }: Readonly<{ showMaps?: boolean }>) {
  const [query, setQuery] = useState("");
  const inputId = useId();
  const isWide = useSyncExternalStore(subscribeWidth, getWide, getServerWide);
  const groups = filterDirectory(showMaps ? [maps, ...FOOTER_SITEMAP_GROUPS] : FOOTER_SITEMAP_GROUPS, query);
  const count = groups.reduce((total, group) => total + group.links.length, 0);
  const filtering = query.trim().length > 0;

  return <nav className={styles.directory} aria-label="Mappa dei dati">
    <div className={styles.filter} role="search" aria-label="Filtra la mappa dei dati">
      <label htmlFor={inputId}>Filtra le pagine per argomento</label>
      <div className={styles.filterRow}>
        <input id={inputId} type="search" value={query} maxLength={120} autoComplete="off"
          placeholder="es. sanità, pensioni, comuni" onChange={(event) => setQuery(event.target.value)} />
        {query ? <button type="button" onClick={() => setQuery("")}>Cancella filtro</button> : null}
      </div>
      <p className={styles.resultCount} role="status">{filtering ? `${count} ${count === 1 ? "pagina trovata" : "pagine trovate"}` : `${count} pagine disponibili`}</p>
    </div>
    {count ? <div className={styles.columns}>
      {groups.map((group) => <DirectoryGroup key={`${group.title}:${filtering}`} group={group} initiallyOpen={isWide || filtering} />)}
    </div> : <div className={styles.empty}>
      <p>Nessuna pagina corrisponde a «{query.trim()}».</p>
      <Link prefetch={false} href={`/cerca?q=${encodeURIComponent(query.trim())}`}>Cerca anche nei dati e nei documenti →</Link>
    </div>}
  </nav>;
}
