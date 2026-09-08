"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import {
  GLOBAL_SEARCH_MIN_QUERY_LENGTH,
  type GlobalSearchResponse,
  type SearchResult,
} from "@/lib/global-search-contract";

const DEBOUNCE_MS = 600;
const SUGGESTION_LIMIT = 8;
const CLIENT_SEARCH_CACHE_LIMIT = 24;

const clientSearchCache = new Map<string, GlobalSearchResponse>();

function rememberClientSearch(query: string, payload: GlobalSearchResponse): void {
  clientSearchCache.set(query, payload);
  if (clientSearchCache.size <= CLIENT_SEARCH_CACHE_LIMIT) return;
  const oldest = clientSearchCache.keys().next().value;
  if (oldest !== undefined) clientSearchCache.delete(oldest);
}

function flattenResults(response: GlobalSearchResponse | null): readonly SearchResult[] {
  return response?.groups.flatMap((group) => group.results) ?? [];
}

export function HeaderSearch() {
  const router = useRouter();
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<GlobalSearchResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [expanded, setExpanded] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLFormElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const results = flattenResults(response);
  const trimmedQuery = query.trim();
  const showDropdown = open && trimmedQuery.length >= GLOBAL_SEARCH_MIN_QUERY_LENGTH;

  useLayoutEffect(() => { if (expanded) inputRef.current?.focus(); }, [expanded]);

  function closeSearch(restoreFocus = false) {
    setOpen(false);
    setExpanded(false);
    setActiveIndex(-1);
    if (restoreFocus && window.matchMedia("(max-width: 1099px)").matches) triggerRef.current?.focus();
  }

  useEffect(() => {
    const effectQuery = query.trim();
    const requestId = ++requestIdRef.current;
    abortRef.current?.abort();

    if (effectQuery.length < GLOBAL_SEARCH_MIN_QUERY_LENGTH) {
      return;
    }

    const timer = setTimeout(() => {
      if (requestId !== requestIdRef.current) return;

      const cached = clientSearchCache.get(effectQuery);
      if (cached) {
        setResponse(cached);
        setActiveIndex(-1);
        setSearchError(false);
        setLoading(false);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);

      fetch(`/api/search?q=${encodeURIComponent(effectQuery)}&limit=${SUGGESTION_LIMIT}`, {
        signal: controller.signal,
      })
        .then((request) => {
          if (!request.ok) throw new Error(`Ricerca globale HTTP ${request.status}`);
          return request.json() as Promise<GlobalSearchResponse>;
        })
        .then((payload) => {
          if (requestId !== requestIdRef.current || payload.ok !== true) return;
          rememberClientSearch(effectQuery, payload);
          setResponse(payload);
          setActiveIndex(-1);
          setSearchError(false);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (requestId !== requestIdRef.current) return;
          setResponse(null);
          setActiveIndex(-1);
          setSearchError(true);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
      if (requestId === requestIdRef.current) requestIdRef.current += 1;
    };
  }, [query]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) closeSearch();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    const compact = window.matchMedia("(max-width: 1099px)");
    function preserveSearchFocus() {
      if (compact.matches && rootRef.current?.contains(document.activeElement)) setExpanded(true);
      if (!compact.matches && document.activeElement === triggerRef.current) inputRef.current?.focus();
    }
    compact.addEventListener("change", preserveSearchFocus);
    return () => compact.removeEventListener("change", preserveSearchFocus);
  }, []);

  function goToResult(result: SearchResult) {
    closeSearch();
    router.push(result.href);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch(true);
      return;
    }

    if (!showDropdown || results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(results.length - 1);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      goToResult(results[activeIndex]);
    }
  }

  return (
    <div className="header-search-root" data-expanded={expanded} ref={wrapperRef}
      onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); closeSearch(true); } }}
      onBlurCapture={(event) => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) closeSearch(); }}>
      <button ref={triggerRef} type="button" className="navigation-button header-search-trigger"
        aria-label={expanded ? "Chiudi ricerca" : "Apri ricerca"} aria-expanded={expanded} aria-controls="header-search-form"
        onClick={() => expanded ? closeSearch(true) : setExpanded(true)}>
        <HugeiconsIcon icon={expanded ? Cancel01Icon : Search01Icon} size={21} strokeWidth={1.7} aria-hidden="true" />
      </button>
    <form
      id="header-search-form"
      className="header-search"
      action="/cerca"
      method="get"
      role="search"
      autoComplete="off"
      ref={rootRef}
      onSubmit={() => closeSearch()}
    >
      <label htmlFor="global-site-search">Cerca nel sito</label>
      <input
        className="input"
        id="global-site-search"
        ref={inputRef}
        name="q"
        type="search"
        placeholder="Cerca pagine, dati o enti"
        autoComplete="off"
        value={query}
        maxLength={180}
        onChange={(event) => {
          const nextQuery = event.target.value;
          requestIdRef.current += 1;
          abortRef.current?.abort();
          setQuery(nextQuery);
          setResponse(null);
          setActiveIndex(-1);
          setSearchError(false);
          setLoading(nextQuery.trim().length >= GLOBAL_SEARCH_MIN_QUERY_LENGTH);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          showDropdown && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
        }
      />
      <button type="submit" aria-label="Cerca nel sito">
        <HugeiconsIcon icon={Search01Icon} size={18} strokeWidth={1.7} aria-hidden="true" />
      </button>

      {showDropdown ? (
        <div className="header-search-dropdown">
          {loading ? (
            <p className="header-search-empty" role="status" aria-live="polite">
              Ricerca…
            </p>
          ) : searchError ? (
            <p className="header-search-empty" role="status" aria-live="polite">
              Ricerca non disponibile. Premi Invio per riprovare.
            </p>
          ) : response && results.length === 0 ? (
            <p className="header-search-empty" role="status" aria-live="polite">
              Nessun risultato per &ldquo;{trimmedQuery}&rdquo;
            </p>
          ) : null}

          <div id={listboxId} role="listbox" aria-label="Risultati della ricerca" aria-busy={loading}>
            {response?.groups.map((group) => (
              <div key={group.type} role="group" aria-label={group.label}>
                <div className="header-search-group-label" role="presentation">
                  {group.label}
                </div>
                {group.results.map((result) => {
                  const resultIndex = results.indexOf(result);
                  return (
                    <Link
                      key={result.id}
                      href={result.href}
                      id={`${listboxId}-${resultIndex}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={resultIndex === activeIndex}
                      className="header-search-option"
                      data-active={resultIndex === activeIndex ? "true" : undefined}
                      onMouseEnter={() => setActiveIndex(resultIndex)}
                      onClick={() => closeSearch()}
                    >
                      <span className="header-search-option-copy">
                        <span className="header-search-option-name">{result.title}</span>
                        <span className="header-search-option-context">{result.context}</span>
                      </span>
                      <span className="header-search-option-type">{result.match.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>

          {response?.hasMore ? (
            <Link
              href={`/cerca?q=${encodeURIComponent(trimmedQuery)}`}
              className="header-search-all"
              onClick={() => closeSearch()}
            >
              Tutti i risultati
            </Link>
          ) : null}
        </div>
      ) : null}
    </form>
    </div>
  );
}
