"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import styles from "./comuni.module.css";

const DEBOUNCE_MS = 180;
const MIN_QUERY = 2;
const SUGGESTION_LIMIT = 8;

type SearchHit = Readonly<{
  codiceIpa: string;
  label: string;
  detail: string;
}>;

type SearchResponse = Readonly<{
  ok: true;
  query: string;
  hits: readonly SearchHit[];
}>;

export function ComuniSearch({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const listboxId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [settledQuery, setSettledQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const trimmed = query.trim();
  const queryReady = trimmed.length >= MIN_QUERY;
  const visibleHits = queryReady ? hits : [];
  const visibleSettled = queryReady ? settledQuery : "";
  const visibleLoading = queryReady && loading;
  const showDropdown = open && queryReady;
  const showEmpty =
    showDropdown && !visibleLoading && visibleSettled === trimmed && visibleHits.length === 0;

  useEffect(() => {
    const effectQuery = query.trim();
    if (effectQuery.length < MIN_QUERY) return;

    const requestId = ++requestIdRef.current;
    abortRef.current?.abort();

    const timer = setTimeout(() => {
      if (requestId !== requestIdRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);

      fetch(
        `/api/comuni/search?q=${encodeURIComponent(effectQuery)}&limit=${SUGGESTION_LIMIT}`,
        { signal: controller.signal },
      )
        .then((response) => {
          if (!response.ok) throw new Error(`Ricerca comuni HTTP ${response.status}`);
          return response.json() as Promise<SearchResponse>;
        })
        .then((payload) => {
          if (requestId !== requestIdRef.current || payload.ok !== true) return;
          setHits(payload.hits);
          setSettledQuery(effectQuery);
          setActiveIndex(-1);
          setOpen(true);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (requestId !== requestIdRef.current) return;
          setHits([]);
          setSettledQuery(effectQuery);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [query]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function goToHit(hit: SearchHit) {
    setOpen(false);
    setQuery(hit.label);
    router.push(`/comuni?ente=${encodeURIComponent(hit.codiceIpa)}`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown || visibleHits.length === 0) {
      if (event.key === "Escape") setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % visibleHits.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? visibleHits.length - 1 : index - 1));
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      const hit = visibleHits[activeIndex];
      if (hit) goToHit(hit);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div className={styles.searchWrap} ref={wrapperRef} id="cerca">
      <form
        className={styles.chromeSearch}
        action="/comuni"
        method="get"
        role="search"
        onSubmit={(event) => {
          if (activeIndex >= 0 && visibleHits[activeIndex]) {
            event.preventDefault();
            goToHit(visibleHits[activeIndex]!);
          }
        }}
      >
        <label className={styles.srOnly} htmlFor="comuni-search">Cerca un Comune</label>
        <input
          id="comuni-search"
          name="q"
          type="search"
          role="combobox"
          value={query}
          placeholder="Inizia a scrivere un Comune…"
          autoComplete="off"
          spellCheck={false}
          minLength={MIN_QUERY}
          required
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={showDropdown}
          aria-activedescendant={
            activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            setOpen(true);
            if (next.trim().length < MIN_QUERY) {
              setHits([]);
              setSettledQuery("");
              setLoading(false);
              setActiveIndex(-1);
            }
          }}
          onFocus={() => {
            if (trimmed.length >= MIN_QUERY) setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <button type="submit">{visibleLoading ? "…" : "Cerca"}</button>
      </form>

      {showDropdown ? (
        <ul
          id={listboxId}
          className={styles.searchSuggestions}
          role="listbox"
          aria-label="Comuni suggeriti"
        >
          {visibleLoading && visibleHits.length === 0 ? (
            <li className={styles.searchEmpty} role="status">
              Cerco…
            </li>
          ) : null}
          {showEmpty ? (
            <li className={styles.searchEmpty} role="status">
              Nessun Comune per «{trimmed}»
            </li>
          ) : null}
          {visibleHits.map((hit, index) => (
            <li key={hit.codiceIpa} role="presentation">
              <Link
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={
                  index === activeIndex
                    ? `${styles.searchSuggestion} ${styles.searchSuggestionActive}`
                    : styles.searchSuggestion
                }
                href={`/comuni?ente=${encodeURIComponent(hit.codiceIpa)}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => setOpen(false)}
              >
                <strong>{hit.label}</strong>
                <span>Codice IPA {hit.detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
