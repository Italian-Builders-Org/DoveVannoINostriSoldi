"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useSyncExternalStore } from "react";
import styles from "./mobilita.module.css";

/**
 * Two views of the same mobility map, switched in place:
 * - "velocita": scheduled speeds for every city (static GTFS explorer);
 * - "bus-live": where Roma's buses are right now (GTFS-Realtime).
 * The view lives in `?vista=` so it can be shared; the page stays static and
 * the live map (MapLibre, polling) is downloaded only when opened.
 */
export type MobilitaView = "velocita" | "bus-live";

export const LIVE_VIEW_PARAM = "vista";
export const LIVE_VIEW_VALUE = "bus-live";
const EVENT = "dvns:mobilita-view";

/** Cities with a public vehicle-positions feed wired to the live view. */
const LIVE_CITIES = [{ id: "roma", name: "Roma", detail: "Autobus ATAC e Roma TPL" }] as const;

const RomaLiveMap = dynamic(() => import("./_live/roma-live-map").then((m) => m.RomaLiveMap), {
  ssr: false,
  loading: () => (
    <div className={styles.liveLoading} role="status">
      Caricamento della mappa in tempo reale…
    </div>
  ),
});

function readView(): MobilitaView {
  try {
    return new URLSearchParams(window.location.search).get(LIVE_VIEW_PARAM) === LIVE_VIEW_VALUE
      ? "bus-live"
      : "velocita";
  } catch {
    return "velocita";
  }
}

function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(EVENT, callback);
  };
}

const serverView = (): MobilitaView => "velocita";

export function useMobilitaView() {
  const view = useSyncExternalStore(subscribe, readView, serverView);
  const setView = useCallback((next: MobilitaView) => {
    if (next === readView()) return;
    const url = new URL(window.location.href);
    if (next === "bus-live") url.searchParams.set(LIVE_VIEW_PARAM, LIVE_VIEW_VALUE);
    else {
      url.searchParams.delete(LIVE_VIEW_PARAM);
      url.searchParams.delete("linea");
      url.searchParams.delete("vettura");
      url.searchParams.delete("fermata");
    }
    // A history entry, not a Next navigation: no RSC request for a view switch.
    window.history.pushState(window.history.state, "", url);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [view, setView] as const;
}

/** Skip link that follows the active view: the hidden iframe is not a target. */
export function MobilitaSkipLink({ className }: { className: string }) {
  const [view] = useMobilitaView();
  return view === "bus-live" ? (
    <a className={className} href="#roma-live-search">
      Vai alla ricerca linee
    </a>
  ) : (
    <a className={className} href="#mobilita-viewer">
      Vai alla mappa
    </a>
  );
}

/** "Mobilità › Tempo reale · Roma" while the live view is open. */
export function MobilitaCrumb() {
  const [view] = useMobilitaView();
  if (view !== "bus-live") return null;
  return (
    <span className={styles.crumb}>
      <span aria-hidden="true">›</span> Tempo reale · Roma
    </span>
  );
}

/**
 * Entry point to real-time data, kept out of the way of the speeds explorer:
 * a header disclosure listing the cities with a live feed. In the live view
 * it becomes the way back to scheduled speeds.
 */
export function MobilitaLiveSwitch() {
  const [view, setView] = useMobilitaView();
  const details = useRef<HTMLDetailsElement>(null);

  if (view === "bus-live") {
    return (
      <button type="button" className={styles.backToSpeeds} onClick={() => setView("velocita")}>
        <span aria-hidden="true">←</span>
        <span className={styles.labelLong}>Velocità programmate</span>
        <span className={styles.labelShort}>Velocità</span>
      </button>
    );
  }

  return (
    <details ref={details} className={`${styles.sourcesDisclosure} ${styles.liveDisclosure}`}>
      <summary>
        <span className={styles.liveDot} aria-hidden="true" />
        Tempo reale
      </summary>
      <div className={styles.livePanel}>
        <h2>Trasporto pubblico in tempo reale</h2>
        <p>Dove sono adesso i mezzi, dai feed ufficiali delle posizioni.</p>
        <ul className={styles.liveCities}>
          {LIVE_CITIES.map((city) => (
            <li key={city.id}>
              <button
                type="button"
                onClick={() => {
                  if (details.current) details.current.open = false;
                  setView("bus-live");
                }}
              >
                <span>
                  <strong>{city.name}</strong>
                  <small>{city.detail}</small>
                </span>
                <span aria-hidden="true">→</span>
              </button>
            </li>
          ))}
        </ul>
        <p className={styles.liveNote}>
          Altre città si aggiungeranno quando pubblicheranno un feed aperto delle posizioni dei mezzi.
        </p>
      </div>
    </details>
  );
}

export function MobilitaViewBody({ explorerSrc }: { explorerSrc: string }) {
  const [view] = useMobilitaView();
  const live = view === "bus-live";
  return (
    <div className={styles.viewBody}>
      {/*
        The explorer stays laid out at full size while the live view covers it:
        display:none would shrink its viewport to 0×0 and its camera to NaN,
        leaving a blank map on return. Hidden visually, inert for keyboard and
        assistive tech; city and filters are kept.
      */}
      <iframe
        id="mobilita-viewer"
        className={styles.viewerFrame}
        title="Esplora velocità programmate GTFS per città e rete"
        src={explorerSrc}
        data-covered={live ? "true" : undefined}
        aria-hidden={live ? true : undefined}
        inert={live}
      />
      {live ? (
        <div className={styles.liveView} data-live-view="">
          <RomaLiveMap />
        </div>
      ) : null}
    </div>
  );
}
