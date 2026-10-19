"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { integer } from "@/lib/format";
import styles from "./conto-annuale.module.css";

type SearchInstitution = Readonly<{
  code: string;
  name: string;
  type: string;
  permanentLatest: number;
}>;

export function InstitutionSearch({
  institutions,
  initialQuery = "",
}: {
  institutions: readonly SearchInstitution[];
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const normalized = query.trim().toLocaleUpperCase("it-IT");
  const results = useMemo(() => {
    if (normalized.length < 2) return [];
    return institutions
      .filter((institution) =>
        institution.code === normalized ||
        institution.name.toLocaleUpperCase("it-IT").includes(normalized))
      .slice(0, 12);
  }, [institutions, normalized]);

  return (
    <div className={styles.searchForm}>
      <label htmlFor="occupazione-search">Cerca un&apos;istituzione</label>
      <input
        id="occupazione-search"
        className={styles.searchInput}
        type="search"
        name="q"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Es. Roma Capitale, Ministero della difesa, codice 6144"
        autoComplete="off"
        spellCheck={false}
      />
      {normalized.length >= 2 ? (
        <div className={styles.results} aria-live="polite">
          {results.length === 0 ? (
            <p className={styles.resultMeta}>Nessuna istituzione corrisponde alla ricerca.</p>
          ) : (
            results.map((institution) => (
              <Link
                key={institution.code}
                href={`/personale-pa/conto-annuale/${institution.code}`}
                className={styles.resultLink}
              >
                <strong>{institution.name}</strong>
                <span className={styles.resultMeta}>
                  {institution.type} · codice {institution.code} · {integer(institution.permanentLatest)} persone nel 2024
                </span>
              </Link>
            ))
          )}
        </div>
      ) : (
        <p className={styles.resultMeta}>Digita almeno due caratteri per cercare tra {integer(institutions.length)} istituzioni con dato 2024.</p>
      )}
    </div>
  );
}
