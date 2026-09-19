"use client";

import type { ReactNode } from "react";
import { AtlasImage } from "./atlas-image";
import type { RepublicMapPerson } from "@/lib/politici-repubblica";
import { initialsOf, isSafeExternalUrl } from "./atlas-model";
import styles from "./politici.module.css";
import extra from "./atlas-enhancements.module.css";

export function Icon({ name, size = 20 }: { name: "search" | "arrow" | "close" | "plus" | "minus" | "reset" | "filter" | "list" | "map" | "external" | "back" | "info"; size?: number; }) {
  const paths = {
    search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    close: "m6 6 12 12M18 6 6 18",
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    reset: "M3 10a9 9 0 1 1 2 8M3 4v6h6",
    filter: "M4 7h16M7 12h10M10 17h4",
    list: "M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1",
    map: "M3 17a9 9 0 0 1 18 0M7 17a5 5 0 0 1 10 0M11 17h2M3 21h18",
    external: "M14 3h7v7m0-7L10 14M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6",
    back: "M19 12H5m6-6-6 6 6 6",
    info: "M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  };
  return <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true">
    <path d={paths[name]} />
  </svg>;
}

export function Portrait({ person, size = 48, eager = false }: { person: Pick<RepublicMapPerson, "id" | "name" | "photo">; size?: number; eager?: boolean; }) {
  return <AtlasImage
    src={person.photo ? `/politici/foto/${encodeURIComponent(person.id)}` : null}
    fallback={initialsOf(person.name)}
    size={size}
    eager={eager}
    className={`${styles.portrait} ${extra.portrait}`} />;
}

export function SourceLink({ href, children, className }: { href: string; children: ReactNode; className?: string; }) {
  return isSafeExternalUrl(href) ? <a href={href} className={className ?? styles.sourceLink} target="_blank" rel="noopener noreferrer">
    {children}
    <Icon name="external" size={13} />
    <span className={styles.srOnly}> (nuova scheda)</span>
  </a> : <span>
    {children}
  </span>;
}

export function Status({ kind = "empty", title, children, onRetry }: { kind?: "loading" | "error" | "empty"; title: string; children?: ReactNode; onRetry?: () => void; }) {
  return <div className={styles.status} data-state={kind} role={kind === "error" ? "alert" : "status"}>
    <span className={styles.statusSymbol} aria-hidden="true">
      <Icon name={kind === "error" ? "info" : "search"} />
    </span>
    <strong>
      {title}
    </strong>
    {children ? <div className={extra.statusContent}>
      {children}
    </div> : null}
    {onRetry ? <button type="button" className={styles.secondaryButton} onClick={onRetry}>Riprova</button> : null}
  </div>;
}

export function PersonRow({ person, detail, onSelect, selected = false }: { person: RepublicMapPerson; detail?: string; onSelect: (id: string) => void; selected?: boolean; }) {
  return <button
    type="button"
    className={styles.personRow}
    data-person-row={person.id}
    aria-pressed={selected}
    onClick={() => onSelect(person.id)}>
    <Portrait person={person} size={40} />
    <span className={styles.personRowText}>
      <strong>
        {person.name}
      </strong>
      <span>
        {detail ?? person.roleLabel}
      </span>
    </span>
    <Icon name="arrow" size={16} />
  </button>;
}
