"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { clampRailWidth, maxRailWidth, parseStoredRailWidth, RAIL_WIDTH_MIN, RAIL_WIDTH_STORAGE_KEY } from "@/lib/politici-rail-width";
import styles from "./atlas-enhancements.module.css";

const DEFAULT_WIDTH = 365;

export function useAtlasRail() {
  const [preferred, setPreferred] = useState(DEFAULT_WIDTH);
  const [viewportWidth, setViewportWidth] = useState(1280);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number; current: number } | null>(null);
  const width = clampRailWidth(preferred, viewportWidth);
  const max = maxRailWidth(viewportWidth);

  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    const restore = () => {
      try {
        // Retain the desktop preference when the viewport temporarily gets smaller.
        setPreferred(parseStoredRailWidth(localStorage.getItem(RAIL_WIDTH_STORAGE_KEY), 1280) ?? DEFAULT_WIDTH);
      } catch { /* Storage is optional; resizing still works in memory. */ }
    };
    const storage = (event: StorageEvent) => {
      if (event.key === RAIL_WIDTH_STORAGE_KEY || event.key === null) restore();
    };
    resize();
    restore();
    window.addEventListener("resize", resize);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("storage", storage);
    };
  }, []);

  const persist = (value: number) => {
    setPreferred(value);
    try { localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, String(value)); } catch { /* Optional preference. */ }
  };
  const finish = (element: HTMLElement, cancel = false) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setResizing(false);
    if (cancel) setPreferred(current.startWidth);
    else persist(clampRailWidth(current.current, window.innerWidth));
    if (element.hasPointerCapture(current.pointerId)) element.releasePointerCapture(current.pointerId);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, current: width };
    setResizing(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.current = clampRailWidth(current.startWidth + event.clientX - current.startX, window.innerWidth);
    setPreferred(current.current);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && drag.current) {
      event.preventDefault();
      finish(event.currentTarget, true);
      return;
    }
    const step = event.shiftKey ? 48 : 16;
    const next = event.key === "Home" ? RAIL_WIDTH_MIN : event.key === "End" ? max
      : event.key === "ArrowLeft" ? width - step : event.key === "ArrowRight" ? width + step : null;
    if (next === null) return;
    event.preventDefault();
    persist(clampRailWidth(next, window.innerWidth));
  };
  return {
    width, max, resizing,
    style: { "--rail-width": `${width}px`, gridTemplateColumns: "var(--rail-width) 9px minmax(0, 1fr)" } as CSSProperties,
    onPointerDown, onPointerMove, onKeyDown,
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event.currentTarget),
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event.currentTarget, true),
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => finish(event.currentTarget),
    onDoubleClick: () => persist(clampRailWidth(DEFAULT_WIDTH, window.innerWidth)),
  };
}

export function AtlasRailResizer({ rail }: { rail: ReturnType<typeof useAtlasRail> }) {
  return <div
    className={styles.railResizer}
    data-resizing={rail.resizing ? "true" : undefined}
    role="separator"
    tabIndex={0}
    aria-label="Larghezza della scheda"
    aria-controls="politici-inspector"
    aria-orientation="vertical"
    aria-valuemin={RAIL_WIDTH_MIN}
    aria-valuemax={rail.max}
    aria-valuenow={rail.width}
    aria-valuetext={`${rail.width} pixel`}
    title="Trascina o usa le frecce. Doppio clic per ripristinare."
    onPointerDown={rail.onPointerDown}
    onPointerMove={rail.onPointerMove}
    onPointerUp={rail.onPointerUp}
    onPointerCancel={rail.onPointerCancel}
    onLostPointerCapture={rail.onLostPointerCapture}
    onKeyDown={rail.onKeyDown}
    onDoubleClick={rail.onDoubleClick} />;
}
