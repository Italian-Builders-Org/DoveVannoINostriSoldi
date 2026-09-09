"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./period-selector.module.css";

export function PeriodSelector({
  activeYear,
  years,
  pathname,
  query = {},
  yearParam = "anno",
  recentLimit,
  className,
  label = "Anno dei dati",
}: {
  activeYear: number;
  years: number[];
  pathname: string;
  query?: Record<string, string>;
  /** Query key written for the selected year (default `anno`). */
  yearParam?: string;
  /**
   * On long series, show only the newest N years as buttons.
   * Older years stay reachable under «Altri».
   */
  recentLimit?: number;
  className?: string;
  label?: string;
}) {
  const sortedNewestFirst = [...years].sort((left, right) => right - left);
  const recent =
    recentLimit !== undefined && recentLimit > 0
      ? sortedNewestFirst.slice(0, recentLimit)
      : sortedNewestFirst;
  const older =
    recentLimit !== undefined && recentLimit > 0
      ? sortedNewestFirst.slice(recentLimit)
      : [];

  function hrefFor(year: number): string {
    return `${pathname}?${new URLSearchParams({ ...query, [yearParam]: String(year) }).toString()}`;
  }

  return (
    <nav
      className={`${styles.wrapper}${className ? ` ${className}` : ""}`}
      aria-label={label}
    >
      <span>Anno</span>
      <div className={styles.years}>
        <div className={styles.yearList}>
          {recent.map((year) => (
            <Link
              key={year}
              href={hrefFor(year)}
              aria-current={year === activeYear ? "page" : undefined}
            >
              {year}
            </Link>
          ))}
        </div>
        {older.length > 0 ? (
          <OlderYearsMenu
            years={older}
            activeYear={activeYear}
            hrefFor={hrefFor}
          />
        ) : null}
      </div>
    </nav>
  );
}

function OlderYearsMenu({
  years,
  activeYear,
  hrefFor,
}: {
  years: number[];
  activeYear: number;
  hrefFor: (year: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const olderSelected = years.includes(activeYear);

  useEffect(() => {
    if (!open) return;

    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function dismissOnKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnKey);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnKey);
    };
  }, [open]);

  return (
    <div className={styles.older} ref={rootRef} data-open={open ? "true" : undefined}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-current={olderSelected ? "true" : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        Altri
      </button>
      {open ? (
        <ul className={styles.olderMenu} id={menuId}>
          {years.map((year) => (
            <li key={year}>
              <Link
                href={hrefFor(year)}
                aria-current={year === activeYear ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {year}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
