"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./esplora.module.css";

type Relation = {
  id: string;
  relation_type: string;
  subject_key: string;
  object_key: string;
  source_record_id: string;
  period: string;
  role?: string | null;
  amount?: number | null;
  source_url?: string | null;
  confidence_note: string;
  note_source?: string | null;
};

const euro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function EsploraSearch({ initialCount }: { initialCount: number }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Relation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function run(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/esplora?q=${encodeURIComponent(value)}&limit=100`,
        );
        if (!res.ok) throw new Error(`risposta ${res.status}`);
        const data = (await res.json()) as { results: Relation[] };
        setResults(data.results ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "errore di ricerca");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  return (
    <section className={styles.searchPanel} aria-labelledby="explorer-search-title">
      <div className={styles.searchHead}>
        <div>
          <h2 id="explorer-search-title" className="panel-title">Cerca nelle relazioni</h2>
          <p>Inserisci almeno due caratteri: nomi, enti, CIG, CUP o identificativi degli atti.</p>
        </div>
      </div>
      <input
        type="search"
        value={query}
        onChange={(event) => run(event.target.value)}
        placeholder="Nome, ente, CIG/CUP, ID atto…"
        aria-label="Cerca relazioni"
        className={styles.searchInput}
      />
      <p className={styles.resultStatus} aria-live="polite">
        {loading
          ? "Ricerca…"
          : query.trim().length < 2
            ? `${initialCount.toLocaleString("it-IT")} relazioni indicizzate`
            : `${results.length} risultati`}
      </p>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <ul className={styles.relationList}>
        {results.map((r) => (
          <li key={r.id} className={styles.relationItem}>
            <span className={styles.relationSubject}>{r.subject_key}</span>
            <span className={styles.relationArrow} aria-hidden="true">
              {" → "}
            </span>
            <span className={styles.relationObject}>{r.object_key}</span>
            <span className={styles.relationType}>{r.relation_type}</span>
            {r.role ? <span className={styles.relationRole}>{r.role}</span> : null}
            {r.period ? <span className={styles.relationPeriod}>{r.period}</span> : null}
            {r.amount !== null && r.amount !== undefined ? (
              <span className={styles.relationAmount}>{euro.format(r.amount)}</span>
            ) : null}
            {r.note_source ? (
              <span className={styles.relationNote}>{r.note_source}</span>
            ) : null}
            <small className={styles.confidenceNote}>{r.confidence_note}</small>
            {r.source_url ? (
              <a
                className={styles.relationSource}
                href={r.source_url}
                target="_blank"
                rel="noreferrer"
              >
                fonte
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
