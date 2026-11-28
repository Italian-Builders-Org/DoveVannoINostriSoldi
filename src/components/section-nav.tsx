"use client";

import { publicSurfacePath } from "@/lib/snapshot-routing";
import Link from "next/link";
import { ShareViewButton } from "./share-view-button";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useId } from "react";
import { activeNavSection, flattenNavLinks, isNavChildActive, standaloneCrumb } from "@/lib/site-navigation";
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
  // Immersive / tool surfaces: no section chrome · the viewport is the product.
  if (pathname === "/politici" || pathname.startsWith("/politici/")) return null;
  if (pathname === "/comuni" || pathname.startsWith("/comuni/")) return null;
  if (pathname === "/mappe/mobilita" || pathname.startsWith("/mappe/mobilita/")) return null;
  if (pathname === "/assistente" || pathname.startsWith("/assistente/")) return null;

  // An empty search page has no view worth sharing.
  const emptySearch = pathname === "/cerca" && !new URLSearchParams(currentSearch ?? "").get("q");

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

  const standalone = section ? null : standaloneCrumb(pathname);
  const hasPicker = pages.length > 1;

  // One row: "Home / Section / [current page ▾]" then the share action. The
  // section picker *is* the last crumb, so the page name is not repeated in a
  // second stacked control above the H1. Phones wrap the picker to its own row.
  return (
    <div className={`shell ${styles.sectionNav}`}>
      <div className={styles.trail}>
        <nav className={styles.breadcrumb} aria-label="Percorso della pagina">
          <Link prefetch={false} href="/">Home</Link>
          <span aria-hidden="true">/</span>
          {section
            ? <Link prefetch={false} className={styles.crumbTruncate} href={section.href}>{section.label}</Link>
            : standalone?.href
              ? <Link prefetch={false} className={styles.crumbTruncate} href={standalone.href}>{standalone.label}</Link>
              : <span className={styles.crumbTruncate} aria-current="page">{standalone?.label}</span>}
        </nav>
        {/* The "/" before the picker travels with it, so a wrap never leaves
            a separator dangling at the end of a line. */}
        {hasPicker ? <nav className={styles.pickerNav} aria-label={`Pagine in ${section!.label}`}>
          <span className={styles.trailSeparator} aria-hidden="true">/</span>
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
        </nav> : null}
      </div>
      {/* A server page with nothing to share (e.g. data unavailable) renders
          [data-share-hidden]; the slot hides itself via :has() in the CSS. */}
      {emptySearch ? null : <div className={styles.shareSlot}><ShareViewButton key={`${pathname}?${currentSearch ?? ""}`} /></div>}
    </div>
  );
}
