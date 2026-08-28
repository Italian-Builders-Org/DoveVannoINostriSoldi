"use client";

import { useEffect, useRef, useState } from "react";
import {
  EXPLORER_DEFAULT_RESULT_LIMIT,
  EXPLORER_MAX_QUERY_LENGTH,
  EXPLORER_MIN_QUERY_LENGTH,
} from "@/lib/investigative-explorer-contract";
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
  references: { cig: string[]; cup: string[] };
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
  const request = useRef<{ controller: AbortController; sequence: number } | null>(null);
  const sequence = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      sequence.current += 1;
      request.current?.controller.abort();
      request.current = null;
    },
    [],
  );

  function run(value: string) {
    const currentSequence = ++sequence.current;
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    request.current?.controller.abort();
    request.current = null;
    if (value.trim().length < EXPLORER_MIN_QUERY_LENGTH) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      request.current = { controller, sequence: currentSequence };
      try {
        const res = await fetch(
          `/api/esplora?q=${encodeURIComponent(value)}&limit=${EXPLORER_DEFAULT_RESULT_LIMIT}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`risposta ${res.status}`);
        const data = (await res.json()) as { results: Relation[] };
        if (sequence.current !== currentSequence) return;
        setResults(data.results ?? []);
      } catch (err) {
        if (controller.signal.aborted || sequence.current !== currentSequence) return;
        setError(err instanceof Error ? err.message : "errore di ricerca");
        setResults([]);
      } finally {
        if (sequence.current === currentSequence) {
          setLoading(false);
          request.current = null;
        }
      }
    }, 250);
  }

  return (
    <section className={styles.searchPanel} aria-labelledby="explorer-search-title">
      <div className={styles.searchHead}>
        <div>
          <h2 id="explorer-search-title" className="panel-title">Cerca nelle relazioni</h2>
          <p>Inserisci almeno due caratteri: nomi, enti o riferimenti CIG/CUP.</p>
        </div>
      </div>
      <input
        type="search"
        value={query}
        onChange={(event) => run(event.target.value)}
        maxLength={EXPLORER_MAX_QUERY_LENGTH}
        placeholder="Nome, ente o CIG/CUP…"
        aria-label="Cerca relazioni"
        className={styles.searchInput}
      />
      <p className={styles.resultStatus} aria-live="polite">
        {loading
          ? "Ricerca…"
          : query.trim().length < EXPLORER_MIN_QUERY_LENGTH
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
            {(r.references.cig.length > 0 || r.references.cup.length > 0) ? (
              <span className={styles.relationNote}>
                {[...r.references.cig.map((code) => `CIG ${code}`), ...r.references.cup.map((code) => `CUP ${code}`)].join(" · ")}
              </span>
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
