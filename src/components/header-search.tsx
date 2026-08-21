"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";

type Suggestion = {
  codiceIpa: string;
  denominazione: string;
  tipologia: string | null;
};

type EntiSearchResponse = {
  ok: boolean;
  records?: Array<{
    codiceIpa: string;
    denominazione: string;
    tipologia: string | null;
  }>;
};

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;

export function HeaderSearch() {
  const router = useRouter();
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLFormElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);

      fetch(`/api/enti?q=${encodeURIComponent(trimmed)}&limit=7`, {
        signal: controller.signal,
      })
        .then((response) => response.json() as Promise<EntiSearchResponse>)
        .then((payload) => {
          if (!payload.ok || !payload.records) {
            setSuggestions([]);
            return;
          }
          setSuggestions(
            payload.records.map((record) => ({
              codiceIpa: record.codiceIpa,
              denominazione: record.denominazione,
              tipologia: record.tipologia,
            })),
          );
          setActiveIndex(-1);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setSuggestions([]);
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [query]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const showDropdown = open && query.trim().length >= MIN_QUERY_LENGTH;

  function goToSuggestion(suggestion: Suggestion) {
    setOpen(false);
    router.push(`/enti/${encodeURIComponent(suggestion.codiceIpa)}`);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown || suggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === "Enter") {
      if (activeIndex >= 0) {
        event.preventDefault();
        goToSuggestion(suggestions[activeIndex]);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <form
      className="header-search"
      action="/enti"
      method="get"
      role="search"
      autoComplete="off"
      ref={rootRef}
      onSubmit={() => setOpen(false)}
    >
      <label htmlFor="global-entity-search">Cerca nel registro degli enti</label>
      <input
        className="input"
        id="global-entity-search"
        name="q"
        type="search"
        placeholder="Cerca un Comune, un ente o un ministero"
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
      />
      <button type="submit" aria-label="Cerca">
        <HugeiconsIcon icon={Search01Icon} size={18} strokeWidth={1.7} aria-hidden="true" />
      </button>

      {showDropdown ? (
        <div className="header-search-dropdown" id={listboxId} role="listbox">
          {loading && suggestions.length === 0 ? (
            <p className="header-search-empty">Cerco…</p>
          ) : suggestions.length === 0 ? (
            <p className="header-search-empty">Nessun risultato in IPA per &ldquo;{query.trim()}&rdquo;</p>
          ) : (
            suggestions.map((suggestion, index) => (
              <Link
                key={suggestion.codiceIpa}
                href={`/enti/${encodeURIComponent(suggestion.codiceIpa)}`}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className="header-search-option"
                data-active={index === activeIndex ? "true" : undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => setOpen(false)}
              >
                <span className="header-search-option-name">{suggestion.denominazione}</span>
                {suggestion.tipologia ? (
                  <span className="header-search-option-type">{suggestion.tipologia}</span>
                ) : null}
              </Link>
            ))
          )}
          <Link
            href={`/enti?q=${encodeURIComponent(query.trim())}`}
            className="header-search-all"
            onClick={() => setOpen(false)}
          >
            Vedi tutti i risultati per &ldquo;{query.trim()}&rdquo;
          </Link>
        </div>
      ) : null}
    </form>
  );
}
