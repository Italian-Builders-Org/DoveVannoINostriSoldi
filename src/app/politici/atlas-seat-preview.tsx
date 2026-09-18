"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { RepublicMapPerson } from "@/lib/politici-repubblica";
import { Portrait } from "./atlas-primitives";
import styles from "./atlas-enhancements.module.css";

type Preview = { personId: string; left: number; top: number; keyboard: boolean };

export function useSeatPreview() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimer = () => { if (timer.current !== null) clearTimeout(timer.current); };
  const dismiss = () => { cancelTimer(); setPreview(null); };
  useEffect(() => {
    const close = () => { if (timer.current !== null) clearTimeout(timer.current); setPreview(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const scroll = (event: Event) => { if (!(event.target instanceof Element && event.target.closest('[role="tooltip"]'))) close(); };
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", scroll, true);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", scroll, true);
    };
  }, []);
  const show = (personId: string, element: SVGElement, keyboard: boolean) => {
    cancelTimer();
    // Touch selection opens the inspector directly. There is no hover-only path on mobile.
    if (!window.matchMedia("(hover: hover) and (min-width: 900px)").matches) return;
    const place = () => {
      const box = element.getBoundingClientRect();
      const width = Math.min(264, innerWidth - 16);
      const height = Math.min(230, innerHeight - 16);
      setPreview({ personId, keyboard,
        left: Math.max(8, Math.min(innerWidth - width - 8, box.left + box.width / 2 - width / 2)),
        top: Math.max(8, Math.min(innerHeight - height - 8, box.top > height + 12 ? box.top - height - 8 : box.bottom + 8)),
      });
    };
    if (keyboard || preview) place(); else timer.current = setTimeout(place, 140);
  };
  const leave = () => { cancelTimer(); timer.current = setTimeout(() => setPreview(null), 160); };
  return { preview, show, leave, dismiss, keep: cancelTimer };
}

export function SeatPreview({ state, person, groupLabel, id }: {
  state: ReturnType<typeof useSeatPreview>; person: RepublicMapPerson; groupLabel: string | null; id: string;
}) {
  if (!state.preview) return null;
  const root = document.querySelector("[data-politici-atlas]");
  if (!root) return null;
  return createPortal(<div id={id} role="tooltip" className={styles.seatTooltip} data-keyboard={String(state.preview.keyboard)}
    style={{ left: state.preview.left, top: state.preview.top }} onPointerEnter={state.keep} onPointerLeave={state.leave}>
    <div><Portrait person={person} size={48} eager /><strong>{person.name}</strong></div>
    <p>{person.roleLabel}</p>
    {groupLabel ? <p>{groupLabel}</p> : null}
    <small>Invio o clic sul seggio per aprire la scheda. Esc per chiudere l’anteprima.</small>
  </div>, root);
}
