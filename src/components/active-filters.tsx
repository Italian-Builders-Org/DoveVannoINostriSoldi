"use client";

import styles from "./active-filters.module.css";

export function ActiveFilters({ filters, pending, onRemove, onReset }: Readonly<{
  filters: readonly { key: string; label: string }[];
  pending: boolean;
  onRemove: (key: string) => void;
  onReset: () => void;
}>) {
  return <div className={styles.summary}>
    <span className={styles.status} role="status">{pending ? "Aggiornamento dei dati…" : filters.length ? "Filtri applicati" : "Tutti i territori e le categorie"}</span>
    {filters.map((filter) => <button key={filter.key} type="button" disabled={pending}
      aria-label={`Rimuovi filtro: ${filter.label}`} onClick={() => onRemove(filter.key)}>{filter.label}<span aria-hidden="true">×</span></button>)}
    {filters.length ? <button className={styles.reset} type="button" disabled={pending} onClick={onReset}>Azzera filtri</button> : null}
  </div>;
}
