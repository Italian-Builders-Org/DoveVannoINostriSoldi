import Link from "next/link";
import { FOOTER_SITEMAP_GROUPS } from "@/lib/site-navigation";
import { MOBILITA_MAP_PATH, PUBLIC_COMUNI_URL, PUBLIC_POLITICI_URL } from "@/lib/site";
import styles from "./site-directory.module.css";

export function SiteDirectory({ showMaps = false }: Readonly<{
  showMaps?: boolean;
}>) {
  return (
    <nav className={styles.directory} aria-label="Mappa dei dati">
      {showMaps ? <section className={styles.maps} aria-labelledby="maps-title">
        <h3 id="maps-title">Mappe</h3>
        <ul>
          <li><Link prefetch={false} href={PUBLIC_COMUNI_URL}>Mappa dei Comuni</Link></li>
          <li><Link prefetch={false} href={PUBLIC_POLITICI_URL}>Mappa della politica</Link></li>
          <li><Link prefetch={false} href={MOBILITA_MAP_PATH}>Mappa della mobilità</Link></li>
        </ul>
      </section> : null}
      <div className={styles.columns}>
        {FOOTER_SITEMAP_GROUPS.map((group) => (
          <section key={group.title} className={styles.group}>
            <h3>{group.title}</h3>
            <ul>{group.links.map((link) => (
              <li key={link.href}><Link prefetch={false} href={link.href}>{link.label}</Link></li>
            ))}</ul>
          </section>
        ))}
      </div>
    </nav>
  );
}
