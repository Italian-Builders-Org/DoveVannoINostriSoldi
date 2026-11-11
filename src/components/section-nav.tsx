"use client";

import { publicSurfacePath } from "@/lib/snapshot-routing";
import Link from "next/link";
import { ShareViewButton } from "./share-view-button";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useId } from "react";
import { activeNavSection, flattenNavLinks, isNavChildActive } from "@/lib/site-navigation";
import styles from "./section-nav.module.css";

export function SectionNav() {
  const pathname = publicSurfacePath(usePathname());
  return (
    <Suspense fallback={<SectionNavContent pathname={pathname} currentSearch={null} />}>
      <SectionNavWithSearchParams pathname={pathname} />
    </Suspense>
  );
}

function SectionNavWithSearchParams({ pathname }: Readonly<{ pathname: string }>) {
  const searchParams = useSearchParams();
  return <SectionNavContent pathname={pathname} currentSearch={searchParams.toString()} />;
}

function SectionNavContent({
  pathname,
  currentSearch,
}: Readonly<{ pathname: string; currentSearch: string | null }>) {
  const router = useRouter();
  const selectId = useId();
  const section = activeNavSection(pathname);
  const pages = flattenNavLinks(section?.children ?? []);
  if (pathname === "/") return null;
  // Immersive map pages: no section chrome · the graph needs the viewport.
  if (pathname === "/politici" || pathname.startsWith("/politici/")) return null;
  if (pathname === "/comuni" || pathname.startsWith("/comuni/")) return null;
  if (pathname === "/mappe/mobilita" || pathname.startsWith("/mappe/mobilita/")) return null;

  const currentHref =
    pages.find((page) =>
      isNavChildActive(pathname, page.href, pages, currentSearch ?? ""),
    )?.href
    ?? pages.find((page) => {
      const pathOnly = page.href.split("?")[0] ?? page.href;
      return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
    })?.href
    ?? pages[0]?.href
    ?? "";

  return (
    <div
      className={`shell ${styles.sectionNav}`}
    >
      <nav className={styles.breadcrumb} aria-label="Percorso della pagina">
        <Link prefetch={false} href="/">Home</Link>
        <span aria-hidden="true">/</span>
        {section ? <Link prefetch={false} href={section.href}>{section.label}</Link> : <Link prefetch={false} href="/#esplora">Esplora i dati</Link>}
      </nav>
      <div className={styles.controls}>
      {pages.length > 1 ? <nav aria-label={`Pagine in ${section!.label}`}>
      <div className={styles.picker}>
        <label className={styles.label} htmlFor={selectId}>
          <span className={styles.visuallyHidden}>Vai a una pagina della sezione</span>
          <select
            id={selectId}
            className={styles.select}
            value={currentHref}
            onChange={(event) => {
              const next = event.target.value;
              if (next && next !== currentHref) router.push(next);
            }}
          >
            {pages.map((page) => (
              <option key={`${page.href}:${page.label}`} value={page.href}>
                {page.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      </nav> : null}
      <ShareViewButton key={`${pathname}?${currentSearch ?? ""}`} />
      </div>
    </div>
  );
}
