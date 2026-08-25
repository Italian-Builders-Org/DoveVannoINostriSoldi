import Link from "next/link";
import styles from "./period-selector.module.css";

export function PeriodSelector({
  activeYear,
  years,
  pathname,
  query = {},
}: {
  activeYear: number;
  years: number[];
  pathname: string;
  query?: Record<string, string>;
}) {
  return (
    <nav className={styles.wrapper} aria-label="Anno dei dati SIOPE">
      <span>Anno</span>
      <div>
        {years.map((year) => (
          <Link
            key={year}
            href={`${pathname}?${new URLSearchParams({ ...query, anno: String(year) }).toString()}`}
            aria-current={year === activeYear ? "page" : undefined}
          >
            {year}
          </Link>
        ))}
      </div>
    </nav>
  );
}
