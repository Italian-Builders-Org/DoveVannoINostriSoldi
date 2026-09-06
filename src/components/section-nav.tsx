"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { activeNavSection, isNavChildActive } from "@/lib/site-navigation";
import styles from "./section-nav.module.css";

/** Related pages remain available after reading the current section. */
export function SectionNav() {
  const pathname = usePathname();
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
  const section = activeNavSection(pathname);
  const pages = section?.children ?? [];
  if (pages.length < 2) return null;

  return (
    <nav
      className={`shell ${styles.sectionNav}`}
      aria-label={`Altre pagine in ${section!.label}`}
    >
      <p className={styles.title}>
        Continua in <strong>{section!.label}</strong>
      </p>
      <ul className={styles.links}>
        {pages.map((page) => {
          const current = currentSearch !== null
            && isNavChildActive(pathname, page.href, pages, currentSearch);
          return (
            <li key={page.href}>
              {current ? (
                <span className={styles.current} aria-current="page">
                  {page.label}
                  <small>sei qui</small>
                </span>
              ) : (
                <Link className={styles.link} href={page.href}>
                  {page.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
