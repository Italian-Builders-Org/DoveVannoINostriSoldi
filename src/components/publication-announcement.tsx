"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import styles from "./publication-announcement.module.css";

export type PublicationAnnouncementItem = Readonly<{
  label: string;
  title: string;
  description: string;
  cta: string;
  href: string;
}>;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function subscribeMotion(callback: () => void) {
  const media = window.matchMedia(REDUCED_MOTION);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const getReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

export function PublicationAnnouncement({ items }: Readonly<{ items: readonly PublicationAnnouncementItem[] }>) {
  const [instant, setInstant] = useState(false);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeMotion, getReducedMotion, () => true);

  useEffect(() => {
    if (items.length < 2 || paused || hovered || focused || reducedMotion) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    function schedule() {
      clearInterval(timer);
      if (!document.hidden) timer = setInterval(() => { setInstant(false); setActive((index) => (index + 1) % items.length); }, 7_000);
    }
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", schedule); };
  }, [items.length, paused, hovered, focused, reducedMotion]);

  if (!items.length) return null;
  return (
    <aside className={styles.bar} aria-label="Novità" data-announcement data-instant={instant}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      <div className={styles.inner}>
        <div className={styles.messages} aria-live="off">
          {items.map((item, index) => <Link key={item.href} href={item.href} className={styles.link}
            data-active={active === index} aria-hidden={active !== index} tabIndex={active === index ? 0 : -1}>
            <span className={styles.title}>{item.description}</span>
            <span className={styles.cta}>{item.cta}<HugeiconsIcon icon={ArrowRight01Icon} size={14} aria-hidden="true" /></span>
          </Link>)}
        </div>
        {items.length > 1 && <div className={styles.controls}>
          <button type="button" aria-label={paused ? "Riprendi gli annunci" : "Metti in pausa gli annunci"}
            aria-pressed={paused} disabled={reducedMotion} onClick={() => setPaused((value) => !value)}>
            {paused ? "Riprendi" : "Pausa"}
          </button>
          <button type="button" aria-label={`Mostra: ${items[(active + 1) % items.length].title}`}
            onClick={(event) => { setInstant(event.detail === 0); setPaused(true); setActive((index) => (index + 1) % items.length); }}>
            Prossimo annuncio
          </button>
        </div>}
      </div>
    </aside>
  );
}
