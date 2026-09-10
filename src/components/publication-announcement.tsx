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
      if (!document.hidden) timer = setInterval(() => setActive((index) => (index + 1) % items.length), 7_000);
    }
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", schedule); };
  }, [items.length, paused, hovered, focused, reducedMotion]);

  if (!items.length) return null;
  const visualItems = items.length > 1 ? [...items, ...items, ...items, ...items] : items;
  const activeItem = items[active % items.length] ?? items[0];
  const animationPaused = paused || hovered || reducedMotion;

  return (
    <aside className={styles.bar} aria-label="Novità" data-announcement
      data-paused={animationPaused ? "true" : "false"}
      data-marquee={items.length > 1 ? "true" : "false"}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      <div className={styles.inner}>
        <div className={styles.messages} aria-hidden="true">
          <div className={styles.track}>
            {visualItems.map((item, index) => <Link key={`${item.href}-${index}`} href={item.href} className={styles.link}
              tabIndex={-1}>
              <span className={styles.title}>{item.description}</span>
              <span className={styles.cta}>{item.cta}<HugeiconsIcon icon={ArrowRight01Icon} size={14} aria-hidden="true" /></span>
            </Link>)}
          </div>
        </div>
        <p className={styles.srOnly} aria-live="polite">
          {activeItem.description}. {activeItem.cta}
        </p>
        {items.length > 1 && <div className={styles.controls}>
          <button type="button" aria-label={paused ? "Riprendi gli annunci" : "Metti in pausa gli annunci"}
            aria-pressed={paused} disabled={reducedMotion} onClick={() => setPaused((value) => !value)}>
            {paused ? "Riprendi" : "Pausa"}
          </button>
          <button type="button" aria-label={`Mostra: ${items[(active + 1) % items.length].title}`}
            onClick={() => { setPaused(true); setActive((index) => (index + 1) % items.length); }}>
            Prossimo annuncio
          </button>
        </div>}
      </div>
    </aside>
  );
}
