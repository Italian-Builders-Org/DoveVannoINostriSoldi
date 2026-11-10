"use client";

import { publicSurfacePath } from "@/lib/snapshot-routing";

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
  if (pages.length < 2) return null;
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
    <nav
      className={`shell ${styles.sectionNav}`}
      aria-label={`Pagine in ${section!.label}`}
    >
      <div className={styles.picker}>
        <p className={styles.title}>
          <strong>{section!.label}</strong>
        </p>
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
    </nav>
  );
}
