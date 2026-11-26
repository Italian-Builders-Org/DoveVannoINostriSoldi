"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import styles from "./dvns-index.module.css";

type Member = { istat: string; name: string; region: string; score: number; band: string; rank: number };
type Dot = { column: number; row: number };

const STEP = 14;
const RADIUS = 4.2;
const LIME = "#d8f74a";

/**
 * Every ranked Comune as part of a dot: one column per two points of score,
 * each dot a group of up to ten Comuni with consecutive positions. Clicking a
 * dot asks the server for its Comuni; only the dot counts ship with the page.
 */
export function DotDistribution({
  columns,
  highlight,
  highlightLabel,
}: {
  /** Number of dots in each column. */
  columns: number[];
  highlight: Dot | null;
  highlightLabel: string;
}) {
  const [open, setOpen] = useState<Dot | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const tallest = Math.max(1, ...columns);
  const width = columns.length * STEP;
  const height = tallest * STEP + STEP;
  const mid = height / 2;
  const viewBox = { x: -10, y: -80, w: width + 20, h: height + 100 };
  const position = (dot: Dot) => ({
    x: dot.column * STEP + STEP / 2,
    y: mid + (dot.row - (columns[dot.column] - 1) / 2) * STEP,
  });

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  async function show(dot: Dot) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setOpen(dot);
    setMembers(null);
    setError(false);
    try {
      const response = await fetch(`/api/dvns-index/punto?colonna=${dot.column}&riga=${dot.row}`, { signal: controller.signal });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "errore");
      setMembers(body.members);
    } catch {
      if (!controller.signal.aborted) setError(true);
    }
  }

  const marker = highlight ? position(highlight) : null;
  const toLeft = marker ? marker.x > width * 0.6 : false;
  const dir = toLeft ? -1 : 1;
  // The label always sits above the whole cloud, so it never covers other dots.
  const elbow = marker ? { x: marker.x + dir * 34, y: Math.min(marker.y - 46, mid - (tallest * STEP) / 2 - 28) } : null;
  const popover = open ? position(open) : null;

  return (
    <div className={styles.dotField}>
      <svg
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        role="img"
        aria-label={`Distribuzione dei punteggi: ogni punto è un gruppo di circa 10 Comuni, più a destra fa meglio.${highlight ? ` Evidenziato: ${highlightLabel}.` : ""} Clicca un punto per vedere i Comuni.`}
      >
        {columns.map((count, column) =>
          Array.from({ length: count }, (_, row) => {
            const { x, y } = position({ column, row });
            const tone = 0.32 + 0.58 * (column / (columns.length - 1));
            const active = open?.column === column && open.row === row;
            return (
              <circle
                key={`${column}-${row}`}
                className={styles.dot}
                cx={x}
                cy={y}
                r={active ? RADIUS * 1.5 : RADIUS}
                fill={active ? LIME : "#f4f4f5"}
                fillOpacity={active ? 1 : tone}
                data-dot={`${column}-${row}`}
                onClick={() => void show({ column, row })}
              />
            );
          }),
        )}
        {marker && elbow ? (
          <g data-highlight="true" pointerEvents="none">
            <circle cx={marker.x} cy={marker.y} r={RADIUS * 4} fill="none" stroke={LIME} strokeOpacity={0.35} />
            <circle cx={marker.x} cy={marker.y} r={RADIUS * 2.4} fill="none" stroke={LIME} strokeOpacity={0.7} />
            <circle cx={marker.x} cy={marker.y} r={RADIUS * 1.3} fill={LIME} />
            <polyline
              points={`${marker.x + dir * RADIUS * 2.6},${marker.y - RADIUS * 2.6} ${elbow.x},${elbow.y} ${elbow.x + dir * 120},${elbow.y}`}
              fill="none"
              stroke={LIME}
              strokeWidth={1.5}
            />
            <text x={elbow.x + dir * 4} y={elbow.y - 10} fill={LIME} fontSize={19} fontWeight={600} textAnchor={toLeft ? "end" : "start"}>
              {highlightLabel}
            </text>
          </g>
        ) : null}
      </svg>
      {open && popover ? (
        <div
          className={styles.dotPopover}
          role="dialog"
          aria-label="Comuni di questo punto"
          data-dot-popover
          style={{
            left: `${Math.min(62, Math.max(0, ((popover.x - viewBox.x) / viewBox.w) * 100 - 15))}%`,
            top: `${((popover.y - viewBox.y) / viewBox.h) * 100}%`,
          }}
        >
          <div className={styles.dotPopoverHead}>
            <strong>{members ? `${members.length} Comuni con punteggio simile` : "Comuni di questo punto"}</strong>
            <button type="button" onClick={() => setOpen(null)} aria-label="Chiudi">×</button>
          </div>
          {error ? <p>Impossibile caricare i Comuni di questo punto.</p> : null}
          {!members && !error ? <p>Caricamento…</p> : null}
          {members ? (
            <ol>
              {members.map((member) => (
                <li key={member.istat}>
                  <Link href={`/dvns-index?comune=${member.istat}#scheda`} prefetch={false}>
                    <span>{member.rank}° {member.name}</span>
                    <span className={styles.dotPopoverScore}>{member.score.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                  </Link>
                  <small>{member.region} · fascia {member.band}</small>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
