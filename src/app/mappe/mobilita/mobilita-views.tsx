"use client";

import dynamic from "next/dynamic";
import { useCallback, useSyncExternalStore } from "react";
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

export function MobilitaViewTabs() {
  const [view, setView] = useMobilitaView();
  return (
    <div className={styles.viewTabs} role="group" aria-label="Vista della mappa">
      <button type="button" aria-pressed={view === "velocita"} onClick={() => setView("velocita")}>
        <span className={styles.tabLong}>Velocità programmate</span>
        <span className={styles.tabShort}>Velocità</span>
      </button>
      <button type="button" aria-pressed={view === "bus-live"} onClick={() => setView("bus-live")}>
        <span className={styles.liveDot} aria-hidden="true" />
        <span className={styles.tabLong}>Bus Roma in tempo reale</span>
        <span className={styles.tabShort}>Bus Roma live</span>
      </button>
    </div>
  );
}

export function MobilitaViewBody({ explorerSrc }: { explorerSrc: string }) {
  const [view] = useMobilitaView();
  return (
    <>
      {/* Kept mounted while hidden so the explorer keeps city and filters. */}
      <iframe
        id="mobilita-viewer"
        className={styles.viewerFrame}
        title="Esplora velocità programmate GTFS per città e rete"
        src={explorerSrc}
        hidden={view !== "velocita"}
      />
      {view === "bus-live" ? (
        <div className={styles.liveView} data-live-view="">
          <RomaLiveMap />
        </div>
      ) : null}
    </>
  );
}
