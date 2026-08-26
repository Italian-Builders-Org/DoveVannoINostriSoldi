"use client";

import { useState } from "react";

type Relation = {
  relation_type: string;
  subject_key: string;
  object_key: string;
  source_record_id: string;
  period: string;
  role?: string | null;
  amount?: number | null;
  source_url?: string | null;
  confidence_note: string;
};

export function EsploraSearch({ initialCount }: { initialCount: number }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Relation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
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
  }

  return (
    <section>
      <input
        type="search"
        value={query}
        onChange={(event) => run(event.target.value)}
        placeholder="Nome, ente, CIG/CUP, ID atto…"
        aria-label="Cerca relazioni"
        className="search-input"
      />
      <p aria-live="polite">
        {loading
          ? "Ricerca…"
          : query.trim().length < 2
            ? `${initialCount.toLocaleString("it-IT")} relazioni indicizzate`
            : `${results.length} risultati`}
      </p>
      {error ? (
        <p role="alert" className="text-error">
          {error}
        </p>
      ) : null}
      <ul className="relation-list">
        {results.map((r) => (
          <li key={r.source_record_id} className="relation-item">
            <span className="relation-subject">{r.subject_key}</span>
            <span className="relation-arrow" aria-hidden="true">
              {" → "}
            </span>
            <span className="relation-object">{r.object_key}</span>
            <span className="relation-type">{r.relation_type}</span>
            {r.role ? <span className="relation-role">{r.role}</span> : null}
            {r.source_url ? (
              <a
                className="relation-source"
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
