"use client";

import { useEffect, useId, useState } from "react";
import {
  addDays, clampTimelineDate, dayIndex, parseGroupTimeline, type GroupTimeline,
} from "@/lib/politici-group-timeline";
import type { Resource } from "./atlas-data";
import { atDate, longDate } from "./atlas-model";
import styles from "./politici.module.css";
import timeline from "./atlas-timeline.module.css";

// One static document per deployment: fetched once per session, never on page load.
let cached: Promise<GroupTimeline> | null = null;

function loadGroupTimeline(): Promise<GroupTimeline> {
  cached ??= fetch("/api/politici/gruppi-nel-tempo", { headers: { accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(parseGroupTimeline)
    // A failed download must be retryable: never cache the rejection.
    .catch((error: unknown) => { cached = null; throw error; });
  return cached;
}

export function useGroupTimeline(enabled: boolean): { resource: Resource<GroupTimeline>; retry: () => void; } {
  const [resource, setResource] = useState<Resource<GroupTimeline>>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    loadGroupTimeline()
      .then((data) => { if (active) setResource({ status: "ready", data }); })
      .catch(() => { if (active) setResource({ status: "error" }); });
    return () => { active = false; };
  }, [enabled, attempt]);
  return {
    // "idle" while enabled means the request is in flight: callers render it as loading.
    resource,
    retry: () => {
      setResource({ status: "loading" });
      setAttempt((value) => value + 1);
    },
  };
}

/**
 * Day slider over the XIX. `asOf === null` is the snapshot's current composition;
 * picking the observation day returns to it, so the URL only records real past days.
 * `changes` are the days the view can move: the step buttons jump between them.
 */
export function TimelineControl({ series, changes, asOf, onAsOf }: {
  series: { firstDate: string; lastDate: string; };
  changes: readonly string[];
  asOf: string | null;
  onAsOf: (asOf: string | null) => void;
}) {
  const id = useId();
  const date = asOf === null ? series.lastDate : clampTimelineDate(series, asOf) ?? series.lastDate;
  const previous = changes.filter((change) => change < date).at(-1) ?? null;
  const next = changes.find((change) => change > date) ?? null;
  const total = dayIndex(series.firstDate, series.lastDate);
  const choose = (value: string) => onAsOf(value === series.lastDate ? null : value);

  return <div className={timeline.control} role="group" aria-labelledby={`${id}-label`}>
    <div className={timeline.row}>
      <label id={`${id}-label`} htmlFor={`${id}-range`} className={timeline.label}>
        Composizione <strong>{atDate(date)}</strong>
        {asOf === null ? <span className={timeline.today}> · ultima rilevazione</span> : null}
      </label>
      <button type="button" className={styles.textButton} disabled={asOf === null} onClick={() => onAsOf(null)}>
        Torna a oggi
      </button>
    </div>
    <input
      id={`${id}-range`}
      className={timeline.range}
      type="range"
      min={0}
      max={total}
      step={1}
      value={dayIndex(series.firstDate, date)}
      aria-valuetext={longDate(date)}
      onChange={(event) => choose(addDays(series.firstDate, Number(event.currentTarget.value)))} />
    <div className={timeline.row}>
      <span className={timeline.bound}>{longDate(series.firstDate)}</span>
      <span className={timeline.steps}>
        <button type="button" className={styles.textButton} disabled={previous === null} onClick={() => previous && choose(previous)}>
          <span aria-hidden="true">←</span> Cambio precedente
        </button>
        <button type="button" className={styles.textButton} disabled={next === null} onClick={() => next && choose(next)}>
          Cambio successivo <span aria-hidden="true">→</span>
        </button>
      </span>
      <span className={timeline.bound}>{longDate(series.lastDate)}</span>
    </div>
  </div>;
}
