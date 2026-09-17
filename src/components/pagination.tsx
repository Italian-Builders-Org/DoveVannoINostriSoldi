import Link from "next/link";
import { integer } from "@/lib/format";
import { paginationWindow } from "@/lib/pagination";
import styles from "./pagination.module.css";

export type PaginationProps = {
  /** Accessible name of the navigation landmark, e.g. "Pagine del dataset". */
  label: string;
  /** 1-based page currently on screen. */
  page: number;
  /** Total number of pages; the control renders nothing below two. */
  pageCount: number;
  /** Href for a given page number. */
  hrefForPage: (page: number) => string;
  /** What the visible slice covers, e.g. "righe 51-100 di 159.493". */
  summary?: string;
  /**
   * Direct jump for lists too long to enumerate. The form posts a page number
   * as `pageParam`; `fields` carries the filters that must survive the jump.
   */
  jump?: {
    action: string;
    pageParam: string;
    fields?: Readonly<Record<string, string>>;
  };
};

/** Beyond this many pages the numbered links cannot reach the middle alone. */
const JUMP_THRESHOLD = 12;

export default function Pagination({
  label,
  page,
  pageCount,
  hrefForPage,
  summary,
  jump,
}: PaginationProps) {
  if (pageCount <= 1) return null;
  const current = Math.min(Math.max(Math.trunc(page), 1), pageCount);
  const steps = paginationWindow(current, pageCount);
  const showJump = Boolean(jump) && pageCount > JUMP_THRESHOLD;

  return (
    <nav className={styles.pagination} aria-label={label}>
      <p className={styles.summary}>
        <strong>
          Pagina {integer(current)} di {integer(pageCount)}
        </strong>
        {summary ? <span>{summary}</span> : null}
      </p>

      <ul className={styles.pages}>
        <li>
          {current > 1 ? (
            <Link
              className={styles.step}
              rel="prev"
              href={hrefForPage(current - 1)}
              aria-label="Pagina precedente"
            >
              <span aria-hidden="true">←</span>
              <span className={styles.stepLabel}>Precedente</span>
            </Link>
          ) : (
            <span className={styles.step} aria-hidden="true" data-disabled="true">
              <span>←</span>
              <span className={styles.stepLabel}>Precedente</span>
            </span>
          )}
        </li>

        {steps.map((step, index) =>
          step === "gap" ? (
            <li key={`gap-${index}`} className={styles.gap} aria-hidden="true">
              …
            </li>
          ) : (
            <li
              key={step}
              className={styles.pageItem}
              data-distance={Math.min(Math.abs(step - current), 3)}
            >
              <Link
                className={styles.page}
                href={hrefForPage(step)}
                aria-current={step === current ? "page" : undefined}
                aria-label={`Pagina ${integer(step)}`}
              >
                {integer(step)}
              </Link>
            </li>
          ),
        )}

        <li>
          {current < pageCount ? (
            <Link
              className={styles.step}
              rel="next"
              href={hrefForPage(current + 1)}
              aria-label="Pagina successiva"
            >
              <span className={styles.stepLabel}>Successiva</span>
              <span aria-hidden="true">→</span>
            </Link>
          ) : (
            <span className={styles.step} aria-hidden="true" data-disabled="true">
              <span className={styles.stepLabel}>Successiva</span>
              <span>→</span>
            </span>
          )}
        </li>
      </ul>

      {showJump && jump ? (
        <form className={styles.jump} action={jump.action} method="get">
          {Object.entries(jump.fields ?? {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <label htmlFor={`${jump.pageParam}-jump`}>Vai alla pagina</label>
          <input
            className="input"
            id={`${jump.pageParam}-jump`}
            name={jump.pageParam}
            type="number"
            inputMode="numeric"
            min={1}
            max={pageCount}
            step={1}
            defaultValue={current}
            aria-describedby={`${jump.pageParam}-jump-range`}
          />
          <span id={`${jump.pageParam}-jump-range`} className={styles.jumpRange}>
            da 1 a {integer(pageCount)}
          </span>
          <button className="btn btn-secondary" type="submit">
            Vai
          </button>
        </form>
      ) : null}
    </nav>
  );
}
