"use client";

import { useId, useState } from "react";

import type { GovernmentScorecardV6Ui } from "@/lib/government-scorecard-page";

import styles from "../government-scorecard.module.css";

type ComparisonOption = GovernmentScorecardV6Ui["compare"]["options"][number];

function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function scoreCopy(option: ComparisonOption): string {
  if (option.score_state === "scored_final" || option.score_state === "scored_provisional") {
    if (option.score_display === null) throw new Error(`voto mancante per ${option.id}`);
    return `${option.score_display}/100 · ${option.score_state === "scored_final" ? "storico" : "provvisorio"}`;
  }
  return "Voto non calcolato";
}

export function ArchiveComparison({ compare }: { compare: GovernmentScorecardV6Ui["compare"] }) {
  const defaultLeftId = compare.current_government_id || compare.options[0]?.id || "";
  const currentIndex = Math.max(0, compare.options.findIndex((option) => option.id === defaultLeftId));
  const defaultRightId = compare.options[currentIndex === 0 ? 1 : currentIndex - 1]?.id ?? defaultLeftId;
  const [leftId, setLeftId] = useState(defaultLeftId);
  const [rightId, setRightId] = useState(defaultRightId);
  const headingId = useId();

  return (
    <section className={styles.archiveComparison} aria-labelledby={headingId}>
      <header className={styles.archiveHeading}>
        <div>
          <span className={styles.sectionEyebrow}>Dal 1995 a oggi</span>
          <h2 id={headingId}>Archivio e confronto</h2>
        </div>
        <p>{compare.message}</p>
      </header>

      <div className={styles.archivePhase} data-phase="archive">
        <h3>Archivio cronologico</h3>
        <ol className={styles.archiveGrid}>
          {compare.options.map((option) => (
            <li key={option.id}>
              <a href={option.href} aria-current={option.id === compare.current_government_id ? "page" : undefined}>
                <span className={styles.archiveDate}>
                  <strong>{option.start_date.slice(0, 4)}</strong>
                  <small>→ {option.current ? "oggi" : option.end_date!.slice(0, 4)}</small>
                </span>
                <span className={styles.archiveIdentity}>
                  <strong>{option.label}</strong>
                  <small>{formatDate(option.start_date)} → {option.current ? "in corso" : formatDate(option.end_date!)}</small>
                  <b>{scoreCopy(option)}</b>
                </span>
                <span className={styles.archiveArrow} aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ol>
      </div>

      <form className={styles.comparisonForm} action="/governi/confronta" method="get">
        <h3>Scegli i due governi</h3>
        <label>
          Primo governo
          <select name="sinistra" value={leftId} onChange={(event) => setLeftId(event.target.value)}>
            {compare.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          Secondo governo
          <select name="destra" value={rightId} onChange={(event) => setRightId(event.target.value)}>
            {compare.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <button type="submit" disabled={!leftId || !rightId || leftId === rightId}>Apri il confronto</button>
        {leftId === rightId ? <p role="status">Scegli due governi diversi.</p> : null}
      </form>

      <p className={styles.comparisonPrompt}>Il confronto si apre in una pagina dedicata.</p>
    </section>
  );
}
