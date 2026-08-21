"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./info-tooltip.module.css";

export function InfoTooltip({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const pointerInteraction = useRef(false);

  useEffect(() => {
    if (!open) return;

    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [open]);

  return (
    <span
      ref={wrapperRef}
      className={styles.wrapper}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          event.stopPropagation();
        }
      }}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-controls={id}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onPointerDown={() => {
          pointerInteraction.current = true;
        }}
        onPointerUp={() => {
          pointerInteraction.current = false;
        }}
        onPointerCancel={() => {
          pointerInteraction.current = false;
        }}
        onFocus={() => {
          if (!pointerInteraction.current) setOpen(true);
        }}
        onClick={() => {
          pointerInteraction.current = false;
          setOpen((current) => !current);
        }}
      >
        ?
      </button>
      <span className={styles.tooltip} data-open={open} id={id} role="tooltip">
        {children}
      </span>
    </span>
  );
}
