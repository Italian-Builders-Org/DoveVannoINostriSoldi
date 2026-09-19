"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { RepublicMap } from "@/lib/politici-repubblica";
import { searchAtlas, type GraphSelection } from "./atlas-model";
import { PartySymbol } from "./atlas-symbol";
import { Icon, Portrait } from "./atlas-primitives";
import styles from "./politici.module.css";
import extra from "./atlas-enhancements.module.css";

export function AtlasSearch({ map, query, onQuery, onSelect, onResults }: {
  map: RepublicMap; query: string; onQuery: (query: string) => void; onSelect: (selection: GraphSelection) => void; onResults: () => void;
}) {
  const id = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const hits = useMemo(() => searchAtlas(map, query), [map, query]);
  const expanded = open && query.trim().length > 0;
  const selected = active >= 0 && active < hits.length ? active : -1;
  const choose = (selection: GraphSelection) => {
    setOpen(false);
    setActive(-1);
    onSelect(selection);
  };
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  return <div className={styles.searchWrapper} ref={wrapper}>
    <div className={styles.searchField}>
      <Icon name="search" size={19} />
      <label className={styles.srOnly} htmlFor={`${id}-input`}>Cerca una persona o un gruppo</label>
      <input
        ref={input}
        id={`${id}-input`}
        type="search"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        maxLength={120}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={`${id}-results`}
        aria-activedescendant={expanded && selected >= 0 ? `${id}-option-${selected}` : undefined}
        placeholder="Cerca una persona o un gruppo"
        value={query}
        onChange={(event) => {
          onQuery(event.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(event) => { if (!wrapper.current?.contains(event.relatedTarget)) setOpen(false); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            setActive(-1);
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            const step = event.key === "ArrowDown" ? 1 : -1;
            const next = selected < 0 ? (step > 0 ? 0 : hits.length - 1) : (selected + step + hits.length) % hits.length;
            setActive(hits.length ? next : -1);
            if (hits.length) document.getElementById(`${id}-option-${next}`)?.scrollIntoView({ block: "nearest", behavior: "instant" });
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (expanded && selected >= 0) choose(hits[selected].selection); else {
              setOpen(false);
              onResults();
            }
          }
        }} />
      {query ? <button
        type="button"
        className={styles.iconButton}
        aria-label="Cancella ricerca"
        onClick={() => {
          onQuery("");
          setOpen(false);
          input.current?.focus();
        }}>
        <Icon name="close" size={16} />
      </button> : null}
    </div>
    <div className={styles.searchResults} hidden={!expanded}>
      <p className={styles.eyebrow}>Risultati in tutte le istituzioni</p>
      <div id={`${id}-results`} role="listbox" aria-label="Suggerimenti di ricerca">
        {hits.map((hit, index) => <button
          type="button"
          role="option"
          tabIndex={-1}
          key={hit.key}
          id={`${id}-option-${index}`}
          aria-selected={selected === index}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(hit.selection)}>
          {hit.selection.kind === "person" ? (() => {
            const person = map.people.find((item) => item.id === ("id" in hit.selection ? hit.selection.id : ""));
            return person ? <Portrait person={person} size={32} /> : null;
          })() : hit.selection.kind === "group" ? <PartySymbol family={map.groups.find((item) => item.id === ("id" in hit.selection ? hit.selection.id : ""))?.partyFamily ?? null} label={hit.label} size={32} /> : <Icon name="map" size={24} />}
          <span className={extra.searchResultText}>
            <strong>
              {hit.label}
            </strong>
            <small>
              {hit.detail}
            </small>
          </span>
          <Icon name="arrow" size={16} />
        </button>)}
      </div>
      {!hits.length ? <p className={styles.note} role="status">Nessun risultato. Prova un cognome o il nome del gruppo.</p> : <button
        type="button"
        className={styles.textButton}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setOpen(false);
          onResults();
        }}>Filtra l’elenco dell’istituzione corrente <Icon name="arrow" size={16} /></button>}
    </div>
  </div>;
}

const MOBILE = "(max-width: 899px)";
function subscribeMobile(callback: () => void) {
  const media = window.matchMedia(MOBILE);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
function isMobile() { return window.matchMedia(MOBILE).matches; }
function serverMobile() { return false; }

function MobileInspector({ open, onClose, selectionKey, children }: { open: boolean; onClose: () => void; selectionKey: string; children: ReactNode; }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) {
      if (element?.open) element.close();
      return;
    }
    const previous = document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = oldOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    content.current?.scrollTo({ top: 0, behavior: "instant" });
    content.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, [selectionKey, open]);
  return <dialog
    ref={dialog}
    id="politici-inspector"
    className={styles.mobileSheet}
    aria-label="Dettaglio della selezione"
    onCancel={(event) => {
      event.preventDefault();
      closeRef.current();
    }}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')].filter((element) => {
        if (!element.getClientRects().length || getComputedStyle(element).visibility === "hidden") return false;
        // Closed <details> can retain layout boxes: they are not keyboard stops.
        for (let parent = element.parentElement; parent && parent !== event.currentTarget; parent = parent.parentElement) {
          if (parent.tagName === "DETAILS" && !parent.hasAttribute("open") && !parent.querySelector(":scope > summary")?.contains(element)) return false;
        }
        return true;
      });
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !focusable.includes(current as HTMLElement))) {
        event.preventDefault();
        last.focus();
      }
      else if (!event.shiftKey && (current === last || !focusable.includes(current as HTMLElement))) {
        event.preventDefault();
        first.focus();
      }
    }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <div className={styles.sheetHeader}>
      <span className={styles.eyebrow}>Scheda istituzionale</span>
      <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Chiudi scheda">
        <Icon name="close" />
      </button>
    </div>
    <div ref={content} className={styles.sheetContent}>
      {open ? children : null}
    </div>
  </dialog>;
}

export function AtlasInspector({ open, onClose, selectionKey, children }: { open: boolean; onClose: () => void; selectionKey: string; children: ReactNode; }) {
  const mobile = useSyncExternalStore(subscribeMobile, isMobile, serverMobile);
  const rail = useRef<HTMLElement>(null);
  useEffect(() => { rail.current?.scrollTo({ top: 0, behavior: "instant" }); }, [selectionKey]);
  return mobile ? <MobileInspector open={open} onClose={onClose} selectionKey={selectionKey}>
    {children}
  </MobileInspector>
    : <aside id="politici-inspector" ref={rail} className={styles.sideRail} aria-label="Dettaglio della selezione">
      {children}
    </aside>;
}
