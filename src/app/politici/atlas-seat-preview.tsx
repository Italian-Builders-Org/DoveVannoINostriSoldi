"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RepublicMapPerson } from "@/lib/politici-repubblica";
import { placePreview, type PreviewRect } from "./atlas-preview-placement";
import { Portrait } from "./atlas-primitives";
import styles from "./atlas-enhancements.module.css";

type Preview = { personId: string; anchor: PreviewRect; keyboard: boolean };

export function useSeatPreview() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const current = useRef<Preview | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const dismiss = useCallback(() => {
    cancelTimer();
    current.current = null;
    setPreview(null);
  }, [cancelTimer]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Element && event.target.closest('[role="tooltip"]'))) dismiss();
    };
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", dismiss);
    document.addEventListener("scroll", scroll, true);
    window.visualViewport?.addEventListener("resize", dismiss);
    window.visualViewport?.addEventListener("scroll", dismiss);
    return () => {
      cancelTimer();
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("scroll", scroll, true);
      window.visualViewport?.removeEventListener("resize", dismiss);
      window.visualViewport?.removeEventListener("scroll", dismiss);
    };
  }, [cancelTimer, dismiss]);
  const show = useCallback((personId: string, element: SVGElement, keyboard: boolean) => {
    cancelTimer();
    // The caller already excludes touch events. A real mouse/pen can hover even
    // when the device's primary input reports no hover (for example a tablet).
    if (!window.matchMedia("(min-width: 900px)").matches) return;
    const reveal = () => {
      timer.current = null;
      if (!element.isConnected) return;
      const { left, top, width, height } = element.getBoundingClientRect();
      const next = { personId, keyboard, anchor: { left, top, width, height } };
      current.current = next;
      setPreview(next);
    };
    if (keyboard || current.current) reveal();
    else timer.current = setTimeout(reveal, 140);
  }, [cancelTimer]);
  const leave = useCallback(() => {
    cancelTimer();
    timer.current = setTimeout(dismiss, 160);
  }, [cancelTimer, dismiss]);
  return { preview, show, leave, dismiss, keep: cancelTimer };
}

export function SeatPreview({ state, person, groupLabel, id }: {
  state: ReturnType<typeof useSeatPreview>; person: RepublicMapPerson; groupLabel: string | null; id: string;
}) {
  const content = useRef<HTMLDivElement>(null);
  const preview = state.preview;
  useLayoutEffect(() => {
    const element = content.current;
    if (!element || !preview) return;
    const measure = () => {
      const visual = window.visualViewport;
      const viewport = {
        left: visual?.offsetLeft ?? 0,
        top: visual?.offsetTop ?? 0,
        width: visual?.width ?? window.innerWidth,
        height: visual?.height ?? window.innerHeight,
      };
      element.style.maxWidth = `${Math.max(0, viewport.width - 16)}px`;
      element.style.maxHeight = `${Math.max(0, viewport.height - 16)}px`;
      const position = placePreview(preview.anchor, element.getBoundingClientRect(), viewport);
      element.style.left = `${position.left}px`;
      element.style.top = `${position.top}px`;
      element.dataset.side = position.side;
      element.style.visibility = "visible";
    };
    measure();
    // Includes wrapping changes from late fonts, long names and translated labels.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [preview, person.name, person.roleLabel, groupLabel]);
  if (!preview) return null;
  const root = document.querySelector("[data-politici-atlas]");
  if (!root) return null;
  return createPortal(<div
    ref={content}
    id={id}
    role="tooltip"
    className={styles.seatTooltip}
    data-keyboard={String(preview.keyboard)}
    style={{ visibility: "hidden" }}
    onPointerEnter={state.keep}
    onPointerLeave={state.leave}>
    <div><Portrait person={person} size={48} eager /><strong>{person.name}</strong></div>
    <p>{person.roleLabel}</p>
    {groupLabel ? <p>{groupLabel}</p> : null}
    <small>Invio o clic sul seggio per aprire la scheda. Esc per chiudere l’anteprima.</small>
  </div>, root);
}
