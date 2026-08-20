import Link from "next/link";
import styles from "./period-selector.module.css";

export function PeriodSelector({
  activeYear,
  years,
  pathname,
}: {
  activeYear: number;
  years: number[];
  pathname: string;
}) {
  return (
    <nav className={styles.wrapper} aria-label="Anno dei dati SIOPE">
      <span>Anno</span>
      <div>
        {years.map((year) => (
          <Link
            key={year}
            href={`${pathname}?anno=${year}`}
            aria-current={year === activeYear ? "page" : undefined}
          >
            {year}
          </Link>
        ))}
      </div>
    </nav>
  );
}
