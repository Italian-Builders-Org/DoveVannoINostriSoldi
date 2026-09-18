"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RepublicMap, RepublicMapPerson, RepublicProfile } from "@/lib/politici-repubblica";
import {
  bridge,
  buildChamberScene,
  buildOverviewGeometry,
  CHAMBER,
  curve,
  sectorBand,
  type ApexNode,
  type ChamberCard,
  type ChamberId,
  type ChamberScene,
  type OverviewGeometry,
  type OverviewLayout,
  type Seat,
  type Wedge,
} from "./graph-geometry";
import styles from "./politici.module.css";
import { RepubblicaPanel, type NewsConnection, type NewsState } from "./repubblica-panel";

export type GraphSelection =
  | { kind: "overview" }
  | { kind: "person"; id: string }
  | { kind: "group"; id: string }
  | { kind: "institution"; id: string };

type Scene = "overview" | ChamberId;
type RoleFilter = "tutti" | "governo" | "presidenza" | "capigruppo";
type Hover = { personId: string; x: number; y: number; frameWidth: number } | null;

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const EMPTY_CONNECTIONS: NewsConnection[] = [];
const STACKED_MEDIA = "(max-width: 899px)";

function subscribeStackedMedia(onChange: () => void): () => void {
  const media = window.matchMedia(STACKED_MEDIA);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function stackedMediaSnapshot(): OverviewLayout {
  return window.matchMedia(STACKED_MEDIA).matches ? "stacked" : "wide";
}

function useOverviewLayout(): OverviewLayout {
  return useSyncExternalStore(subscribeStackedMedia, stackedMediaSnapshot, () => "wide");
}

function useClientHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function portraitPath(personId: string): string {
  return `/politici/foto/${personId}`;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/u)
    .filter((token) => token.length > 1)
    .slice(0, 2)
    .map((token) => token[0]!.toLocaleUpperCase("it-IT"))
    .join("");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLocaleLowerCase("it-IT");
}

function isPresidencyRole(person: RepublicMapPerson): boolean {
  return (
    person.roleKind === "presidente-assemblea"
    || person.roleKind === "vicepresidente-assemblea"
    || person.roleKind === "questore"
    || person.roleKind === "segretario-presidenza"
    || person.roleKind === "capo-stato"
  );
}

/** Dock group names left/right of the hemicycle with elbow leaders that do not cross. */
function spaceCallouts(
  wedges: Wedge[],
  width: number,
): Array<Wedge & { lineY: number; lineX: number; elbowX: number }> {
  const leftX = 44;
  const rightX = width - 44;
  const gutter = 88;
  // Bias straddling centre wedges to the right so FI-sized blocs don't send
  // long leaders across the hemicycle from the left rail.
  const split = Math.PI / 2 + 0.12;
  const left = wedges
    .filter((wedge) => wedge.midAngle >= split)
    .sort((a, b) => a.anchorY - b.anchorY);
  const right = wedges
    .filter((wedge) => wedge.midAngle < split)
    .sort((a, b) => a.anchorY - b.anchorY);

  const place = (list: Wedge[], lineX: number, elbowX: number, anchor: "start" | "end") => {
    const minGap = 38;
    const top = 118;
    const bottom = 805;
    const ys = list.map((wedge) => Math.min(bottom, Math.max(top, wedge.anchorY)));
    for (let pass = 0; pass < 5; pass += 1) {
      for (let index = 1; index < ys.length; index += 1) {
        if (ys[index]! < ys[index - 1]! + minGap) ys[index] = ys[index - 1]! + minGap;
      }
      const last = ys[ys.length - 1];
      if (last !== undefined && last > bottom) {
        const overflow = last - bottom;
        for (let index = 0; index < ys.length; index += 1) {
          ys[index]! -= ys.length === 1 ? overflow : (overflow * index) / (ys.length - 1);
        }
      }
      for (let index = ys.length - 2; index >= 0; index -= 1) {
        if (ys[index]! > ys[index + 1]! - minGap) ys[index] = ys[index + 1]! - minGap;
      }
      const first = ys[0];
      if (first !== undefined && first < top) {
        const deficit = top - first;
        for (let index = 0; index < ys.length; index += 1) {
          ys[index]! += ys.length === 1 ? deficit : deficit * (1 - index / (ys.length - 1));
        }
      }
    }
    return list.map((wedge, index) => ({
      ...wedge,
      lineX,
      lineY: Math.round(ys[index]! * 10) / 10,
      elbowX,
      labelX: lineX,
      labelY: Math.round(ys[index]! * 10) / 10,
      labelAnchor: anchor,
    }));
  };

  return [...place(left, leftX, leftX + gutter, "start"), ...place(right, rightX, rightX - gutter, "end")];
}

function sceneForPerson(person: RepublicMapPerson | null | undefined): Scene {
  if (person?.chamberId) return person.chamberId;
  return "overview";
}

/** Keep the executive on the overview: jumping into a hemicycle for Meloni hides the Consiglio. */
function sceneForPersonFocus(person: RepublicMapPerson, current: Scene): Scene {
  if (current === "overview" && person.government) return "overview";
  return sceneForPerson(person);
}

function sceneForSelection(
  selection: GraphSelection,
  peopleById: Map<string, RepublicMapPerson>,
  groupById: Map<string, RepublicMap["groups"][number]>,
): Scene {
  if (selection.kind === "person") return sceneForPerson(peopleById.get(selection.id));
  if (selection.kind === "group") {
    const group = groupById.get(selection.id);
    return group?.chamberId ?? "overview";
  }
  if (selection.kind === "institution" && (selection.id === "camera" || selection.id === "senato")) {
    return selection.id;
  }
  return "overview";
}

export function Portrait({
  person,
  size,
  eager = false,
}: {
  person: { id: string; name: string; photo: boolean };
  size: number;
  eager?: boolean;
}) {
  if (!person.photo) {
    return <span className={styles.monogram} aria-hidden="true">{initialsOf(person.name)}</span>;
  }
  return (
    <Image
      className={styles.portraitImage}
      src={portraitPath(person.id)}
      alt=""
      width={size}
      height={size}
      sizes={`${size}px`}
      loading={eager ? "eager" : "lazy"}
    />
  );
}

export function RepubblicaGraph({
  map,
  initialSelection,
}: {
  map: RepublicMap;
  initialSelection: GraphSelection;
}) {
  const peopleById = useMemo(
    () => new Map(map.people.map((person) => [person.id, person])),
    [map.people],
  );
  const groupById = useMemo(() => new Map(map.groups.map((group) => [group.id, group])), [map.groups]);
  const institutionById = useMemo(
    () => new Map(map.institutions.map((institution) => [institution.id, institution])),
    [map.institutions],
  );

  const [selection, setSelection] = useState<GraphSelection>(initialSelection);
  const [scene, setScene] = useState<Scene>(() => sceneForSelection(initialSelection, peopleById, groupById));
  const overviewLayout = useOverviewLayout();
  const layoutReady = useClientHydrated();
  const [hover, setHover] = useState<Hover>(null);
  const [profiles, setProfiles] = useState<Record<string, RepublicProfile> | null>(null);
  const [profilesFailed, setProfilesFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [familyFilter, setFamilyFilter] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("tutti");
  const [mode, setMode] = useState<"mappa" | "elenco">("mappa");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [news, setNews] = useState<Record<string, NewsState>>({});
  const [newsTick, setNewsTick] = useState(0);

  const frameRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragOrigin = useRef<{ x: number; y: number; viewX: number; viewY: number } | null>(null);
  const pinchOrigin = useRef<{ distance: number; scale: number } | null>(null);
  const moved = useRef(false);
  const newsRef = useRef(news);

  useEffect(() => {
    newsRef.current = news;
  }, [news]);

  const overview = useMemo(() => buildOverviewGeometry(map, overviewLayout), [map, overviewLayout]);
  const cameraScene = useMemo(() => buildChamberScene(map, "camera"), [map]);
  const senatoScene = useMemo(() => buildChamberScene(map, "senato"), [map]);
  const activeChamber: ChamberScene | null =
    scene === "camera" ? cameraScene : scene === "senato" ? senatoScene : null;

  const selectedPerson = selection.kind === "person" ? peopleById.get(selection.id) ?? null : null;

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("person");
    url.searchParams.delete("group");
    url.searchParams.delete("istituzione");
    if (selection.kind === "person") url.searchParams.set("person", selection.id);
    if (selection.kind === "group") url.searchParams.set("group", selection.id);
    if (selection.kind === "institution") url.searchParams.set("istituzione", selection.id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [selection]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/politici/profili", { headers: { Accept: "application/json" } })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
        .then((payload: { profiles?: Record<string, RepublicProfile> }) => {
          if (cancelled) return;
          if (!payload.profiles) throw new Error("payload inatteso");
          setProfiles(payload.profiles);
        })
        .catch(() => {
          if (!cancelled) setProfilesFailed(true);
        });
    };
    const idle = window.requestIdleCallback?.(load, { timeout: 1200 }) ?? window.setTimeout(load, 200);
    return () => {
      cancelled = true;
      if (window.cancelIdleCallback && typeof idle === "number") window.cancelIdleCallback(idle);
      else window.clearTimeout(idle as number);
    };
  }, []);

  useEffect(() => {
    const personId = selectedPerson?.id;
    if (!personId) return;
    if (newsRef.current[personId]?.status === "ready") return;

    let cancelled = false;
    let retryTimer: number | undefined;
    const controller = new AbortController();
    setNews((current) =>
      current[personId]?.status === "ready"
        ? current
        : { ...current, [personId]: { status: "loading" } },
    );

    const attempt = (remaining: number) => {
      fetch(`/api/politici/${encodeURIComponent(personId)}/news`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      })
        .then(async (response) => {
          const payload = await response.json();
          if (response.ok && payload.ok === true) return payload;
          if (payload.retry === true && remaining > 0) return null;
          throw new Error(payload.error ?? `HTTP ${response.status}`);
        })
        .then((payload) => {
          if (cancelled) return;
          if (payload === null) {
            retryTimer = window.setTimeout(() => attempt(remaining - 1), 2800);
            return;
          }
          setNews((current) => ({
            ...current,
            [personId]: {
              status: "ready",
              articles: payload.articles ?? [],
              connections: payload.connections ?? [],
              observedAt: payload.observedAt ?? null,
              provider: payload.provider ?? null,
            },
          }));
        })
        .catch((error: unknown) => {
          if (cancelled || controller.signal.aborted) return;
          setNews((current) => ({
            ...current,
            [personId]: { status: "error", message: error instanceof Error ? error.message : "errore" },
          }));
        });
    };

    attempt(4);
    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [selectedPerson?.id, newsTick]);

  const currentNews: NewsState | null = selectedPerson
    ? news[selectedPerson.id] ?? { status: "loading" }
    : null;
  const connections = currentNews?.status === "ready" ? currentNews.connections : EMPTY_CONNECTIONS;
  const connectionById = new Map(connections.map((connection) => [connection.person.id, connection]));

  const matchesFilters = useCallback(
    (person: RepublicMapPerson): boolean => {
      if (scene !== "overview" && person.chamberId !== scene && !person.government) return false;
      if (familyFilter && person.family !== familyFilter) return false;
      if (roleFilter === "governo" && !person.government) return false;
      if (roleFilter === "presidenza" && !isPresidencyRole(person)) return false;
      if (roleFilter === "capigruppo" && !person.groupLeader) return false;
      return true;
    },
    [scene, familyFilter, roleFilter],
  );

  const filtersActive = familyFilter !== null || roleFilter !== "tutti";
  const roleFilterCount = useMemo(() => {
    if (roleFilter === "tutti") return map.people.length;
    return map.people.filter((person) => {
      if (roleFilter === "governo") return Boolean(person.government);
      if (roleFilter === "presidenza") return isPresidencyRole(person);
      return Boolean(person.groupLeader);
    }).length;
  }, [map.people, roleFilter]);

  const litIds = useMemo(() => {
    let ids: Set<string> | null = null;
    if (selection.kind === "person") {
      const lit = new Set<string>([selection.id]);
      for (const connection of connections) lit.add(connection.person.id);
      const person = peopleById.get(selection.id);
      // On the overview, keep the whole Consiglio readable when focusing a minister.
      if (scene === "overview" && person?.government) {
        for (const member of map.people) {
          if (member.government) lit.add(member.id);
        }
      }
      ids = lit;
    } else if (selection.kind === "group") {
      ids = new Set(map.people.filter((person) => person.groupId === selection.id).map((person) => person.id));
    } else if (selection.kind === "institution") {
      const id = selection.id;
      ids = new Set(
        map.people
          .filter((person) =>
            id === "governo"
              ? person.government
              : id === "presidenza-repubblica"
                ? person.roleKind === "capo-stato"
                : person.chamberId === id,
          )
          .map((person) => person.id),
      );
    }

    if (filtersActive) {
      const filtered = new Set(map.people.filter((person) => matchesFilters(person)).map((person) => person.id));
      if (ids === null) return filtered;
      return new Set([...ids].filter((id) => filtered.has(id)));
    }
    return ids;
  }, [selection, connections, map.people, filtersActive, matchesFilters, peopleById, scene]);

  const highlightedGroupIds = useMemo(() => {
    if (selection.kind === "group") {
      const group = groupById.get(selection.id);
      return new Set([selection.id, ...(group?.relatedGroupIds ?? [])]);
    }
    if (selectedPerson?.groupId) {
      const group = groupById.get(selectedPerson.groupId);
      return new Set([selectedPerson.groupId, ...(group?.relatedGroupIds ?? [])]);
    }
    if (familyFilter !== null) {
      return new Set(map.groups.filter((group) => group.partyFamily === familyFilter).map((group) => group.id));
    }
    return new Set<string>();
  }, [selection, selectedPerson, familyFilter, groupById, map.groups]);

  const searchResults = useMemo(() => {
    const trimmed = normalize(query.trim());
    if (trimmed.length < 2) return [];
    return map.people
      .filter((person) => {
        const group = person.groupId ? groupById.get(person.groupId) : null;
        return (
          normalize(person.name).includes(trimmed)
          || normalize(person.roleLabel).includes(trimmed)
          || (group ? normalize(group.label).includes(trimmed) : false)
        );
      })
      .slice(0, 14);
  }, [query, map.people, groupById]);

  const resetView = useCallback(() => setView({ scale: 1, x: 0, y: 0 }), []);

  const openScene = useCallback(
    (next: Scene, nextSelection?: GraphSelection) => {
      setScene(next);
      resetView();
      setHover(null);
      if (nextSelection) setSelection(nextSelection);
    },
    [resetView],
  );

  const select = useCallback((next: GraphSelection) => {
    setSelection(next);
    setHover(null);
  }, []);

  const focusPerson = useCallback(
    (personId: string) => {
      const person = peopleById.get(personId);
      if (!person) return;
      const nextScene = sceneForPersonFocus(person, scene);
      if (nextScene !== scene) {
        openScene(nextScene, { kind: "person", id: personId });
        return;
      }
      select({ kind: "person", id: personId });
    },
    [peopleById, scene, openScene, select],
  );

  const backToOverview = useCallback(() => {
    openScene("overview", { kind: "overview" });
  }, [openScene]);

  const zoomAt = useCallback((factor: number, originX?: number, originY?: number) => {
    setView((current) => {
      const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const frame = frameRef.current;
      if (!frame) return { ...current, scale };
      const rect = frame.getBoundingClientRect();
      const px = originX ?? rect.width / 2;
      const py = originY ?? rect.height / 2;
      const ratio = scale / current.scale;
      const x = px - ratio * (px - current.x);
      const y = py - ratio * (py - current.y);
      const maxX = rect.width * (scale - 1);
      const maxY = rect.height * (scale - 1);
      return { scale, x: clamp(x, -maxX, 0), y: clamp(y, -maxY, 0) };
    });
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved.current = false;
    if (pointers.current.size === 1) {
      dragOrigin.current = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
    }
    if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      pinchOrigin.current = {
        distance: Math.hypot(first!.x - second!.x, first!.y - second!.y),
        scale: view.scale,
      };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2 && pinchOrigin.current) {
      const [first, second] = [...pointers.current.values()];
      const distance = Math.hypot(first!.x - second!.x, first!.y - second!.y);
      const factor = distance / pinchOrigin.current.distance;
      const target = clamp(pinchOrigin.current.scale * factor, MIN_SCALE, MAX_SCALE);
      moved.current = true;
      setView((current) => ({ ...current, scale: target }));
      return;
    }

    const origin = dragOrigin.current;
    if (!origin || view.scale === 1) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true;
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const maxX = rect.width * (view.scale - 1);
    const maxY = rect.height * (view.scale - 1);
    setView((current) => ({
      ...current,
      x: clamp(origin.viewX + dx, -maxX, 0),
      y: clamp(origin.viewY + dy, -maxY, 0),
    }));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchOrigin.current = null;
    if (pointers.current.size === 0) dragOrigin.current = null;
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const frame = frameRef.current;
    const rect = frame?.getBoundingClientRect();
    zoomAt(
      event.deltaY < 0 ? 1.12 : 1 / 1.12,
      rect ? event.clientX - rect.left : undefined,
      rect ? event.clientY - rect.top : undefined,
    );
  };

  const targetOf = (event: React.MouseEvent | React.PointerEvent): GraphSelection | "enter-chamber" | null => {
    const element = (event.target as Element).closest<HTMLElement | SVGElement>(
      "[data-person],[data-group],[data-institution],[data-enter-chamber]",
    );
    if (!element) return null;
    const enter = element.getAttribute("data-enter-chamber");
    if (enter === "camera" || enter === "senato") return "enter-chamber";
    const personId = element.getAttribute("data-person");
    if (personId) return { kind: "person", id: personId };
    const groupId = element.getAttribute("data-group");
    if (groupId) return { kind: "group", id: groupId };
    const institutionId = element.getAttribute("data-institution");
    if (institutionId) return { kind: "institution", id: institutionId };
    return null;
  };

  const onCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (moved.current) return;
    const element = (event.target as Element).closest<HTMLElement | SVGElement>("[data-enter-chamber]");
    const enter = element?.getAttribute("data-enter-chamber");
    if (enter === "camera" || enter === "senato") {
      openScene(enter, { kind: "institution", id: enter });
      return;
    }
    const next = targetOf(event);
    if (next === "enter-chamber" || next === null) {
      if (scene === "overview") select({ kind: "overview" });
      return;
    }
    if (next.kind === "person") {
      focusPerson(next.id);
      return;
    }
    if (next.kind === "group") {
      const group = groupById.get(next.id);
      if (group && scene === "overview") {
        openScene(group.chamberId, next);
        return;
      }
      select(next);
      return;
    }
    select(next);
  };

  const onCanvasMove = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerMove(event);
    if (event.pointerType === "touch") return;
    const next = targetOf(event);
    if (!next || next === "enter-chamber" || next.kind !== "person") {
      if (hover) setHover(null);
      return;
    }
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    setHover({
      personId: next.id,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      frameWidth: rect.width,
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (scene !== "overview") {
        backToOverview();
        return;
      }
      select({ kind: "overview" });
      return;
    }
    if (selection.kind !== "person" || !activeChamber) return;
    const person = peopleById.get(selection.id);
    if (!person?.chamberId) return;
    const seats = activeChamber.seats;
    const index = seats.findIndex((seat) => seat.personId === selection.id);
    if (index === -1) return;

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = seats[clamp(index + (event.key === "ArrowRight" ? 1 : -1), 0, seats.length - 1)]!;
      focusPerson(next.personId);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const orderedGroups = activeChamber.wedges.map((wedge) => wedge.groupId);
      const currentGroup = orderedGroups.indexOf(person.groupId ?? "");
      const nextGroupId = orderedGroups[
        clamp(currentGroup + (event.key === "ArrowDown" ? 1 : -1), 0, orderedGroups.length - 1)
      ];
      const target = seats.find((seat) => peopleById.get(seat.personId)?.groupId === nextGroupId);
      if (target) focusPerson(target.personId);
    }
  };

  const hoveredPerson = hover ? peopleById.get(hover.personId) ?? null : null;
  const hoveredGroup = hoveredPerson?.groupId ? groupById.get(hoveredPerson.groupId) ?? null : null;
  const statusMessage = describeStatus({
    selection,
    scene,
    people: peopleById,
    groups: groupById,
    institutions: institutionById,
    roleFilter,
    roleFilterCount,
    familyFilter,
    familyLabel: familyFilter
      ? map.partyFamilies.find((family) => family.id === familyFilter)?.label ?? null
      : null,
  });

  const mobileHub = layoutReady && overviewLayout === "stacked" && scene === "overview" && mode === "mappa";

  return (
    <div
      className={styles.explorer}
      data-mobile-hub={mobileHub ? "true" : "false"}
      data-filters-open={filtersOpen ? "true" : "false"}
      data-mode={mode}
    >
      <div className={styles.topBar}>
        <p className={styles.desktopExperienceNote} role="note">
          <strong>Su telefono vedi una panoramica semplificata.</strong>
          {" "}
          L’esperienza completa della mappa (zoom, collegamenti e vista radiale) è pensata per il desktop.
        </p>
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <label className={styles.searchLabel} htmlFor="politici-search">Cerca una persona o un gruppo</label>
            <input
              id="politici-search"
              className={styles.searchInput}
              type="search"
              autoComplete="off"
              placeholder="Es. Meloni, Fratelli d’Italia, ministro"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && searchResults[0]) {
                  event.preventDefault();
                  focusPerson(searchResults[0].id);
                  setQuery("");
                }
                if (event.key === "Escape") setQuery("");
              }}
            />
            {searchResults.length > 0 ? (
              <ul className={styles.searchResults}>
                {searchResults.map((person) => {
                  const group = person.groupId ? groupById.get(person.groupId) : null;
                  return (
                    <li key={person.id}>
                      <button
                        type="button"
                        className={styles.searchResult}
                        onClick={() => {
                          focusPerson(person.id);
                          setQuery("");
                        }}
                      >
                        <span className={styles.searchAvatar}><Portrait person={person} size={40} /></span>
                        <span className={styles.searchText}>
                          <strong>{person.name}</strong>
                          <span>{person.roleLabel}{group ? ` · ${group.shortLabel}` : ""}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <div className={styles.filters}>
            <fieldset className={styles.filterSet}>
              <legend>Vista</legend>
              <button
                type="button"
                className={styles.chip}
                aria-pressed={scene === "overview"}
                onClick={backToOverview}
              >
                Panoramica
              </button>
              <button
                type="button"
                className={styles.chip}
                aria-pressed={scene === "camera"}
                onClick={() => openScene("camera", { kind: "institution", id: "camera" })}
              >
                Camera
              </button>
              <button
                type="button"
                className={styles.chip}
                aria-pressed={scene === "senato"}
                onClick={() => openScene("senato", { kind: "institution", id: "senato" })}
              >
                Senato
              </button>
            </fieldset>
            <fieldset
              className={`${styles.filterSet} ${styles.filterSetExtra}`}
              id="politici-extra-filters"
              data-open={filtersOpen || overviewLayout !== "stacked" ? "true" : "false"}
            >
              <legend>Incarico</legend>
              {(["tutti", "governo", "presidenza", "capigruppo"] as RoleFilter[]).map((value) => {
                const count =
                  value === "tutti"
                    ? map.people.length
                    : map.people.filter((person) => {
                        if (value === "governo") return Boolean(person.government);
                        if (value === "presidenza") return isPresidencyRole(person);
                        return Boolean(person.groupLeader);
                      }).length;
                const label =
                  value === "tutti"
                    ? "Tutti"
                    : value === "governo"
                      ? "Governo"
                      : value === "presidenza"
                        ? "Presidenze"
                        : "Capigruppo";
                return (
                  <button
                    key={value}
                    type="button"
                    className={styles.chip}
                    aria-pressed={roleFilter === value}
                    title={
                      value === "tutti"
                        ? "Mostra tutte le persone"
                        : value === "governo"
                          ? "Tieni accesi solo i membri del Governo"
                          : value === "presidenza"
                            ? "Tieni accese solo le presidenze (Quirinale, Camere, gruppi)"
                            : "Tieni accesi solo i capigruppo"
                    }
                    onClick={() => setRoleFilter(value)}
                  >
                    {label}
                    <span className={styles.chipCount}>{count}</span>
                  </button>
                );
              })}
            </fieldset>
            <div className={styles.filterTools}>
              <div className={styles.modeSwitch} role="group" aria-label="Vista mappa o elenco">
                <button type="button" className={styles.chip} aria-pressed={mode === "mappa"} onClick={() => setMode("mappa")}>
                  Mappa
                </button>
                <button type="button" className={styles.chip} aria-pressed={mode === "elenco"} onClick={() => setMode("elenco")}>
                  Elenco
                </button>
              </div>
              <button
                type="button"
                className={styles.filtersToggle}
                aria-expanded={filtersOpen}
                aria-controls="politici-extra-filters"
                onClick={() => setFiltersOpen((open) => !open)}
              >
                Filtri{filtersActive ? " · on" : ""}
              </button>
            </div>
          </div>
        </div>

        <ul
          className={styles.legend}
          data-open={filtersOpen || overviewLayout !== "stacked" ? "true" : "false"}
        >
          {map.partyFamilies.map((family) => (
            <li key={family.id}>
              <button
                type="button"
                className={styles.legendItem}
                aria-pressed={familyFilter === family.id}
                aria-label={`${family.label}, ${family.memberCount} person${family.memberCount === 1 ? "a" : "e"}`}
                title={family.label}
                onClick={() => setFamilyFilter(familyFilter === family.id ? null : family.id)}
              >
                <span className={styles.legendSwatch} data-family={family.id} aria-hidden="true" />
                <span className={styles.legendLabel}>{family.shortLabel}</span>
                <span className={styles.legendCount}>{family.memberCount}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <aside className={styles.sideRail} aria-label="Dettaglio della selezione">
        <RepubblicaPanel
          map={map}
          selection={selection}
          profiles={profiles}
          profilesFailed={profilesFailed}
          news={currentNews}
          onSelect={(next) => {
            if (next.kind === "person") {
              focusPerson(next.id);
              return;
            }
            if (next.kind === "group") {
              const group = groupById.get(next.id);
              if (group) openScene(group.chamberId, next);
              else select(next);
              return;
            }
            if (next.kind === "institution" && (next.id === "camera" || next.id === "senato")) {
              openScene(next.id, next);
              return;
            }
            if (next.kind === "overview" || (next.kind === "institution" && next.id !== "camera" && next.id !== "senato")) {
              openScene("overview", next);
              return;
            }
            select(next);
          }}
          onRetryNews={
            selectedPerson
              ? () => {
                  setNews((current) => {
                    const next = { ...current };
                    delete next[selectedPerson.id];
                    return next;
                  });
                  setNewsTick((tick) => tick + 1);
                }
              : undefined
          }
        />
      </aside>

      <div className={styles.stageRow}>
        <div className={mode === "mappa" ? styles.stageColumn : styles.stageColumnHidden}>
          {mobileHub ? (
            <>
              <MobileHub
                map={map}
                peopleById={peopleById}
                institutionById={institutionById}
                selection={selection}
                onOpenChamber={(chamberId) => openScene(chamberId, { kind: "institution", id: chamberId })}
                onSelectInstitution={(id) => select({ kind: "institution", id })}
                onSelectPerson={focusPerson}
              />
              <div className={styles.stageFooter}>
                <p className={styles.status} role="status" aria-live="polite">{statusMessage}</p>
              </div>
            </>
          ) : !layoutReady ? (
            <div className={styles.stagePending} aria-busy="true" aria-label="Caricamento panoramica" />
          ) : (
            <>
              <div className={styles.canvasControls}>
                {scene !== "overview" ? (
                  <button type="button" className={styles.backButton} onClick={backToOverview}>
                    ← Torna alla panoramica
                  </button>
                ) : (
                  <p className={styles.canvasHint}>
                    <span className={styles.hintDesktop}>Clicca Camera o Senato · trascina · ⌘/Ctrl + rotella</span>
                    <span className={styles.hintMobile}>Tocca Camera o Senato · trascina · pizzica per zoom</span>
                  </p>
                )}
                <div className={styles.zoomButtons}>
                  <button type="button" className={styles.zoomButton} onClick={() => zoomAt(1.3)} aria-label="Ingrandisci">+</button>
                  <button type="button" className={styles.zoomButton} onClick={() => zoomAt(1 / 1.3)} aria-label="Riduci">−</button>
                  <button type="button" className={styles.zoomButton} onClick={resetView} aria-label="Reimposta la vista">Reset</button>
                </div>
              </div>

              <div
                className={styles.frame}
                ref={frameRef}
                data-zoomed={view.scale > 1 ? "true" : "false"}
                data-scene={scene}
                data-filtered={filtersActive ? "true" : "false"}
                data-layout={scene === "overview" ? overviewLayout : undefined}
                onPointerDown={onPointerDown}
                onPointerMove={onCanvasMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={(event) => {
                  onPointerUp(event);
                  setHover(null);
                }}
                onClick={onCanvasClick}
                onDoubleClick={(event) => {
                  const rect = frameRef.current?.getBoundingClientRect();
                  zoomAt(1.6, rect ? event.clientX - rect.left : undefined, rect ? event.clientY - rect.top : undefined);
                }}
                onWheel={onWheel}
                onKeyDown={onKeyDown}
                tabIndex={0}
                role="group"
                aria-label={
                  scene === "overview"
                    ? "Panoramica istituzionale: clicca Camera o Senato per entrare nell’emiciclo"
                    : `Emiciclo ${scene === "camera" ? "della Camera" : "del Senato"}: frecce per i seggi, Esc per tornare indietro`
                }
              >
                <div
                  className={styles.stage}
                  style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
                >
                  <div
                    className={styles.stageBoard}
                    data-scene={scene}
                    data-layout={scene === "overview" ? overviewLayout : undefined}
                  >
                  {scene === "overview" ? (
                    <OverviewScene
                      map={map}
                      overview={overview}
                      peopleById={peopleById}
                      groupById={groupById}
                      institutionById={institutionById}
                      selection={selection}
                      litIds={litIds}
                      highlightedGroupIds={highlightedGroupIds}
                    />
                  ) : activeChamber ? (
                    <ChamberSceneView
                      map={map}
                      chamber={activeChamber}
                      peopleById={peopleById}
                      groupById={groupById}
                      institutionById={institutionById}
                      selection={selection}
                      litIds={litIds}
                      highlightedGroupIds={highlightedGroupIds}
                      connections={connections}
                      connectionById={connectionById}
                      selectedPerson={selectedPerson}
                    />
                  ) : null}
                  </div>
                </div>

                {hoveredPerson ? (
                  <div
                    className={styles.tooltip}
                    style={{
                      left: `${clamp(hover!.x, 130, Math.max(130, hover!.frameWidth - 130))}px`,
                      top: `${Math.max(12, hover!.y - 18)}px`,
                    }}
                    role="presentation"
                  >
                    <span className={styles.tooltipAvatar}><Portrait person={hoveredPerson} size={48} /></span>
                    <span className={styles.tooltipText}>
                      <strong>{hoveredPerson.name}</strong>
                      <span>{hoveredPerson.roleLabel}</span>
                      {hoveredGroup ? <span className={styles.tooltipGroup}>{hoveredGroup.label}</span> : null}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className={styles.stageFooter}>
                <p className={styles.status} role="status" aria-live="polite">{statusMessage}</p>
                <RelationLegend scene={scene} hasSelection={selection.kind !== "overview"} />
              </div>
            </>
          )}
        </div>

        {mode === "elenco" ? (
          <PeopleList
            map={map}
            groupById={groupById}
            matchesFilters={matchesFilters}
            query={query}
            onSelect={focusPerson}
            selection={selection}
          />
        ) : null}
      </div>
    </div>
  );
}

function RelationLegend({ scene, hasSelection }: { scene: Scene; hasSelection: boolean }) {
  return (
    <ul className={styles.relationLegend} aria-label="Come leggere i collegamenti">
      {scene === "overview" ? (
        <>
          <li><span className={styles.relationSample} data-kind="hierarchy" /> Gerarchia istituzionale</li>
          <li><span className={styles.relationSample} data-kind="family" /> Famiglia politica tra i due rami (solo se selezioni un gruppo)</li>
        </>
      ) : (
        <>
          <li><span className={styles.relationSample} data-kind="family" /> Stesso gruppo nell’altro ramo</li>
          <li><span className={styles.relationSample} data-kind="news" /> Co-citazioni nelle notizie{hasSelection ? "" : " (seleziona una persona)"}</li>
        </>
      )}
    </ul>
  );
}

function MobileHub({
  map,
  peopleById,
  institutionById,
  selection,
  onOpenChamber,
  onSelectInstitution,
  onSelectPerson,
}: {
  map: RepublicMap;
  peopleById: Map<string, RepublicMapPerson>;
  institutionById: Map<string, RepublicMap["institutions"][number]>;
  selection: GraphSelection;
  onOpenChamber: (chamberId: ChamberId) => void;
  onSelectInstitution: (id: string) => void;
  onSelectPerson: (personId: string) => void;
}) {
  const quirinale = institutionById.get("presidenza-repubblica")!;
  const governo = institutionById.get("governo")!;
  const camera = institutionById.get("camera")!;
  const senato = institutionById.get("senato")!;
  const quirinaleLeader = quirinale.leaderPersonId ? peopleById.get(quirinale.leaderPersonId) ?? null : null;
  const governoLeader = governo.leaderPersonId ? peopleById.get(governo.leaderPersonId) ?? null : null;
  const cameraLeader = camera.leaderPersonId ? peopleById.get(camera.leaderPersonId) ?? null : null;
  const senatoLeader = senato.leaderPersonId ? peopleById.get(senato.leaderPersonId) ?? null : null;

  return (
    <nav className={styles.mobileHub} aria-label={`Panoramica della ${map.legislature.label}`}>
      <p className={styles.mobileHubIntro}>Scegli un’istituzione. Camera e Senato aprono l’emiciclo. La classifica presenze Camera è nel pannello sotto.</p>

      <button
        type="button"
        className={styles.mobileHubCard}
        data-kind="presidenza"
        aria-pressed={selection.kind === "institution" && selection.id === quirinale.id}
        onClick={() => {
          if (quirinaleLeader) onSelectPerson(quirinaleLeader.id);
          else onSelectInstitution(quirinale.id);
        }}
      >
        <span className={styles.mobileHubEyebrow}>Presidenza della Repubblica</span>
        <span className={styles.mobileHubRow}>
          {quirinaleLeader ? (
            <span className={styles.mobileHubAvatar}><Portrait person={quirinaleLeader} size={56} eager /></span>
          ) : null}
          <span className={styles.mobileHubCopy}>
            <strong>{quirinaleLeader?.name ?? quirinale.label}</strong>
            <span>{quirinaleLeader?.roleLabel ?? quirinale.shortLabel}</span>
          </span>
        </span>
      </button>

      <button
        type="button"
        className={styles.mobileHubCard}
        data-kind="governo"
        aria-pressed={selection.kind === "institution" && selection.id === governo.id}
        onClick={() => onSelectInstitution(governo.id)}
      >
        <span className={styles.mobileHubEyebrow}>Governo</span>
        <span className={styles.mobileHubRow}>
          {governoLeader ? (
            <span className={styles.mobileHubAvatar}><Portrait person={governoLeader} size={56} eager /></span>
          ) : null}
          <span className={styles.mobileHubCopy}>
            <strong>{governoLeader?.name ?? governo.label}</strong>
            <span>
              {governoLeader?.roleLabel ?? governo.shortLabel}
              {` · ${governo.memberCount} componenti`}
            </span>
          </span>
        </span>
      </button>

      <div className={styles.mobileHubChambers}>
        {([
          { institution: camera, leader: cameraLeader },
          { institution: senato, leader: senatoLeader },
        ] as const).map(({ institution, leader }) => (
          <button
            key={institution.id}
            type="button"
            className={styles.mobileHubChamber}
            data-enter-chamber={institution.id}
            aria-label={`${institution.label}: apri emiciclo`}
            onClick={() => onOpenChamber(institution.id as ChamberId)}
          >
            <span className={styles.mobileHubChamberTitle}>{institution.shortLabel}</span>
            <span className={styles.mobileHubChamberMeta}>
              {institution.vacantSeats
                ? `${institution.memberCount} in carica · ${institution.vacantSeats} vacanti`
                : `${institution.memberCount} in carica`}
            </span>
            {leader ? (
              <span className={styles.mobileHubRow}>
                <span className={styles.mobileHubAvatar}><Portrait person={leader} size={44} eager /></span>
                <span className={styles.mobileHubCopy}>
                  <strong>{leader.name}</strong>
                  <span>{leader.roleLabel}</span>
                </span>
              </span>
            ) : null}
            <span className={styles.mobileHubCta}>Apri emiciclo</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function OverviewScene({
  map,
  overview,
  peopleById,
  groupById,
  institutionById,
  selection,
  litIds,
  highlightedGroupIds,
}: {
  map: RepublicMap;
  overview: OverviewGeometry;
  peopleById: Map<string, RepublicMapPerson>;
  groupById: Map<string, RepublicMap["groups"][number]>;
  institutionById: Map<string, RepublicMap["institutions"][number]>;
  selection: GraphSelection;
  litIds: Set<string> | null;
  highlightedGroupIds: Set<string>;
}) {
  const showFamily = highlightedGroupIds.size > 0;
  const { cx, cy, rings, executiveArc, legislativeArcs } = overview;
  const gov = institutionById.get("governo")!;
  const ringGuide = (radius: number) =>
    `M ${cx + radius} ${cy} A ${radius} ${radius} 0 1 0 ${cx - radius} ${cy} A ${radius} ${radius} 0 1 0 ${cx + radius} ${cy}`;

  const midExec = (executiveArc.start + executiveArc.end) / 2;
  const juniorCount = overview.juniorMembers.length;
  // Sit below the junior arc (not centred on the dots).
  const juniorLabel = polarLabel(cx, cy, rings.junior + 78, midExec);

  return (
    <>
      <svg
        className={styles.canvas}
        viewBox={`0 0 ${overview.width} ${overview.height}`}
        data-focused={litIds !== null ? "true" : "false"}
        role="img"
        aria-label={`Mappa radiale della ${map.legislature.label}: Presidenza, Governo, Camera e Senato`}
      >
        <defs>
          <marker id="politici-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" className={styles.arrowHead} />
          </marker>
        </defs>

        {/* Concentric structure */}
        <g className={styles.ringLayer} aria-hidden="true">
          {[rings.authority, rings.executive, rings.cabinet, rings.junior, rings.chambers, rings.outer].map((radius) => (
            <path key={radius} className={styles.ringGuide} d={ringGuide(radius)} />
          ))}
          <path
            className={styles.sectorExecutive}
            d={sectorBand(cx, cy, rings.executive - 28, rings.junior + 18, executiveArc.start, executiveArc.end)}
          />
          <path
            className={styles.sectorLegislative}
            d={sectorBand(cx, cy, rings.chambers - 72, rings.chambers - 18, legislativeArcs.camera.start, legislativeArcs.camera.end)}
          />
          <path
            className={styles.sectorLegislative}
            d={sectorBand(cx, cy, rings.chambers - 72, rings.chambers - 18, legislativeArcs.senato.start, legislativeArcs.senato.end)}
          />
          <circle className={styles.hubGlow} cx={cx} cy={cy} r={rings.authority + 10} />
        </g>

        <g className={styles.hierarchyLayer}>
          {map.edges
            .filter((edge) => edge.kind === "gerarchia")
            .map((edge) => {
              const from = overviewAnchor(edge.source, overview);
              const to = overviewAnchor(edge.target, overview);
              if (!from || !to) return null;
              const kind =
                edge.source === "presidenza-repubblica" && edge.target === "governo"
                  ? "nominate"
                  : edge.source === "governo"
                    ? "confidence"
                    : "promulgate";
              return (
                <path
                  key={edge.id}
                  className={styles.hierarchyLink}
                  d={curve(from, to, kind === "promulgate" ? 0.18 : 0.08)}
                  markerEnd="url(#politici-arrow)"
                  data-kind={kind}
                >
                  <title>{edge.label}</title>
                </path>
              );
            })}
        </g>

        {showFamily ? (
          <g className={styles.familyLayer}>
            {map.edges
              .filter(
                (edge) =>
                  edge.kind === "famiglia-politica"
                  && (highlightedGroupIds.has(edge.source) || highlightedGroupIds.has(edge.target)),
              )
              .map((edge) => {
                const from = cardWedgeAnchor(edge.source, overview);
                const to = cardWedgeAnchor(edge.target, overview);
                if (!from || !to) return null;
                const family = groupById.get(edge.source)?.partyFamily ?? null;
                return (
                  <path
                    key={edge.id}
                    className={styles.familyLink}
                    d={bridge(from, to, 40)}
                    data-family={family}
                    data-active="true"
                  >
                    <title>{edge.label}</title>
                  </path>
                );
              })}
          </g>
        ) : null}

        {overview.layout === "wide"
          ? overview.cards.map((card) => (
              <ChamberCardSvg key={card.chamberId} card={card} groupById={groupById} highlightedGroupIds={highlightedGroupIds} />
            ))
          : null}
      </svg>

      <div className={styles.overlay}>
        <QuirinalePlaque
          institution={institutionById.get("presidenza-repubblica")!}
          node={overview.headOfState}
          people={peopleById}
          litIds={litIds}
          canvasWidth={overview.width}
          canvasHeight={overview.height}
        />
        <GovernmentCluster
          institution={gov}
          primeMinister={overview.primeMinister}
          people={peopleById}
          litIds={litIds}
          selection={selection}
          canvasWidth={overview.width}
          canvasHeight={overview.height}
        />
        <span
          className={styles.bandLabel}
          data-tone="junior"
          data-anchor="below"
          style={{
            left: `${(juniorLabel.x / overview.width) * 100}%`,
            top: `${(juniorLabel.y / overview.height) * 100}%`,
          }}
        >
          Viceministri e sottosegretari · {juniorCount}
        </span>
        {overview.juniorMembers.map((node) => (
          <PortraitNode
            key={node.personId}
            node={node}
            people={peopleById}
            litIds={litIds}
            selection={selection}
            size={22}
            canvasWidth={overview.width}
            canvasHeight={overview.height}
          />
        ))}
        {overview.ministers.map((node) => (
          <PortraitNode
            key={node.personId}
            node={node}
            people={peopleById}
            litIds={litIds}
            selection={selection}
            size={30}
            canvasWidth={overview.width}
            canvasHeight={overview.height}
          />
        ))}
        {overview.vicePresidents.map((node) => (
          <PortraitNode
            key={node.personId}
            node={node}
            people={peopleById}
            litIds={litIds}
            selection={selection}
            size={40}
            canvasWidth={overview.width}
            canvasHeight={overview.height}
          />
        ))}
        {overview.cards.map((card) => (
          <ChamberEnterCard
            key={`enter-${card.chamberId}`}
            card={card}
            institution={institutionById.get(card.chamberId)!}
            people={peopleById}
            canvasWidth={overview.width}
            canvasHeight={overview.height}
            compact={overview.layout === "stacked"}
          />
        ))}
      </div>
    </>
  );
}

function polarLabel(cx: number, cy: number, radius: number, angle: number) {
  return {
    x: Math.round((cx + radius * Math.cos(angle)) * 100) / 100,
    y: Math.round((cy - radius * Math.sin(angle)) * 100) / 100,
  };
}


function ChamberCardSvg({
  card,
  groupById,
  highlightedGroupIds,
}: {
  card: ChamberCard;
  groupById: Map<string, RepublicMap["groups"][number]>;
  highlightedGroupIds: Set<string>;
}) {
  return (
    <g className={styles.chamberMini} data-chamber={card.chamberId}>
      <rect
        className={styles.chamberCardFrame}
        x={card.x}
        y={card.y}
        width={card.width}
        height={card.height}
        rx={10}
      />
      {card.wedges.map((wedge) => {
        const group = groupById.get(wedge.groupId);
        if (!group) return null;
        const active = highlightedGroupIds.size === 0 || highlightedGroupIds.has(wedge.groupId);
        return (
          <path
            key={wedge.groupId}
            className={styles.chamberMiniBand}
            d={wedge.bandPath}
            data-family={group.partyFamily}
            data-active={active ? "true" : "false"}
            data-group={group.id}
          >
            <title>{`${group.label} · ${wedge.seatCount}`}</title>
          </path>
        );
      })}
    </g>
  );
}

function ChamberEnterCard({
  card,
  institution,
  people,
  canvasWidth,
  canvasHeight,
  compact = false,
}: {
  card: ChamberCard;
  institution: RepublicMap["institutions"][number];
  people: Map<string, RepublicMapPerson>;
  canvasWidth: number;
  canvasHeight: number;
  compact?: boolean;
}) {
  const leader = institution.leaderPersonId ? people.get(institution.leaderPersonId) ?? null : null;
  const headerHeight = compact
    ? Math.max(72, card.height - 10)
    : Math.min(152, card.height * 0.68);
  return (
    <button
      type="button"
      className={compact ? `${styles.chamberEnter} ${styles.chamberEnterCompact}` : styles.chamberEnter}
      data-enter-chamber={card.chamberId}
      aria-label={`${institution.label}: apri emiciclo`}
      style={{
        left: `${((card.x + card.width / 2) / canvasWidth) * 100}%`,
        top: `${((card.y + 4) / canvasHeight) * 100}%`,
        width: compact ? undefined : `${(card.width / canvasWidth) * 100}%`,
        height: compact ? undefined : `${(headerHeight / canvasHeight) * 100}%`,
      }}
    >
      <span className={styles.chamberEnterTitle}>{institution.shortLabel}</span>
      <span className={styles.chamberEnterMeta}>
        {institution.vacantSeats
          ? `${institution.memberCount} in carica · ${institution.vacantSeats} vacanti`
          : `${institution.memberCount} in carica`}
      </span>
      {leader ? (
        <span className={styles.chamberEnterLeader}>
          <span className={styles.chamberEnterAvatar}><Portrait person={leader} size={compact ? 36 : 40} eager /></span>
          <span className={styles.chamberEnterLeaderText}>
            <strong>{leader.name}</strong>
            {compact ? null : <span>Apri emiciclo →</span>}
          </span>
        </span>
      ) : compact ? null : (
        <span className={styles.chamberEnterCta}>Apri emiciclo →</span>
      )}
      {compact ? <span className={styles.chamberEnterCtaPill}>Apri emiciclo</span> : null}
    </button>
  );
}

function ChamberSceneView({
  map,
  chamber,
  peopleById,
  groupById,
  institutionById,
  selection,
  litIds,
  highlightedGroupIds,
  connections,
  connectionById,
  selectedPerson,
}: {
  map: RepublicMap;
  chamber: ChamberScene;
  peopleById: Map<string, RepublicMapPerson>;
  groupById: Map<string, RepublicMap["groups"][number]>;
  institutionById: Map<string, RepublicMap["institutions"][number]>;
  selection: GraphSelection;
  litIds: Set<string> | null;
  highlightedGroupIds: Set<string>;
  connections: NewsConnection[];
  connectionById: Map<string, NewsConnection>;
  selectedPerson: RepublicMapPerson | null;
}) {
  const institution = institutionById.get(chamber.chamberId)!;
  const selectedSeat: Seat | null = selectedPerson
    ? chamber.seatByPerson.get(selectedPerson.id) ?? null
    : null;
  const callouts = spaceCallouts(chamber.wedges, CHAMBER.width);

  return (
    <>
      <svg
        className={styles.canvas}
        viewBox={`0 0 ${CHAMBER.width} ${CHAMBER.height}`}
        data-focused={litIds !== null ? "true" : "false"}
        role="img"
        aria-label={`${institution.label}: ${institution.memberCount} componenti, emiciclo esplorabile`}
      >
        <path
          className={styles.floor}
          d={`M ${chamber.cx - chamber.rOuter - 36} ${chamber.cy + 8} H ${chamber.cx + chamber.rOuter + 36}`}
        />

        {chamber.wedges.map((wedge) => {
          const group = groupById.get(wedge.groupId);
          if (!group) return null;
          const highlighted = highlightedGroupIds.size === 0 || highlightedGroupIds.has(wedge.groupId);
          return (
            <path
              key={`band-${wedge.groupId}`}
              className={styles.groupBand}
              d={wedge.bandPath}
              data-family={group.partyFamily}
              data-group={group.id}
              data-active={highlighted ? "true" : "false"}
            >
              <title>{`${group.label} · ${wedge.seatCount} component${wedge.seatCount === 1 ? "e" : "i"}`}</title>
            </path>
          );
        })}

        {callouts.map((wedge) => {
          const group = groupById.get(wedge.groupId);
          if (!group) return null;
          const active = highlightedGroupIds.has(wedge.groupId) || highlightedGroupIds.size === 0;
          return (
            <g
              key={`label-${wedge.groupId}`}
              className={styles.groupCallout}
              data-active={active ? "true" : "false"}
              data-family={group.partyFamily}
              data-group={group.id}
            >
              <path
                className={styles.wedgeTick}
                d={`M ${wedge.lineX} ${wedge.lineY} L ${wedge.elbowX} ${wedge.lineY} L ${wedge.anchorX} ${wedge.anchorY}`}
                fill="none"
              />
              <rect
                className={styles.wedgeLabelPlate}
                x={wedge.labelAnchor === "start" ? wedge.lineX - 4 : wedge.lineX - 92}
                y={wedge.lineY - 16}
                width={96}
                height={30}
                rx={8}
              />
              <text
                className={styles.wedgeLabel}
                x={wedge.lineX}
                y={wedge.lineY}
                dy="0.35em"
                textAnchor={wedge.labelAnchor}
                data-group={group.id}
              >
                {group.shortLabel}
                <tspan className={styles.wedgeCount} dx="7">{wedge.seatCount}</tspan>
              </text>
            </g>
          );
        })}

        <g className={styles.seats}>
          {chamber.seats.map((seat) => {
            const person = peopleById.get(seat.personId)!;
            const group = person.groupId ? groupById.get(person.groupId) : null;
            const lit = litIds === null || litIds.has(person.id);
            return (
              <circle
                key={seat.personId}
                className={styles.seat}
                cx={seat.x}
                cy={seat.y}
                r={chamber.seatRadius * (person.government ? 1.28 : 1)}
                data-person={person.id}
                data-family={person.family}
                data-lit={lit ? "true" : "false"}
                data-government={person.government ? "true" : "false"}
                data-selected={selection.kind === "person" && selection.id === person.id ? "true" : "false"}
                data-connected={connectionById.has(person.id) ? "true" : "false"}
              >
                <title>{`${person.name} · ${person.roleLabel}${group ? ` (${group.shortLabel})` : ""}`}</title>
              </circle>
            );
          })}
        </g>

        {selectedPerson && selectedSeat ? (
          <g className={styles.newsLayer}>
            {connections.map((connection) => {
              const to = chamber.seatByPerson.get(connection.person.id);
              if (!to) return null;
              return (
                <path
                  key={connection.person.id}
                  className={styles.newsLink}
                  d={curve(
                    { x: selectedSeat.x, y: selectedSeat.y },
                    { x: to.x, y: to.y },
                    0.16,
                  )}
                  style={{ strokeWidth: Math.min(4, 1 + connection.articleCount * 0.5) }}
                >
                  <title>{`${connection.person.name}: ${connection.articleCount} notizie in comune`}</title>
                </path>
              );
            })}
          </g>
        ) : null}
      </svg>

      <div className={styles.overlay}>
        <div className={styles.chamberFocus} data-has-person={selectedPerson ? "true" : "false"}>
          <div className={styles.chamberFocusHeader}>
            <p className={styles.chamberFocusTitle}>{institution.label}</p>
            <p className={styles.chamberFocusMeta}>
              {institution.memberCount} in carica
              {institution.vacantSeats ? ` · ${institution.vacantSeats} vacanti` : ""}
              {" · "}{map.groups.filter((group) => group.chamberId === chamber.chamberId).length} gruppi
              {!selectedPerson ? " · clicca un seggio" : ""}
            </p>
          </div>
          {selectedPerson ? (
            <div className={styles.chamberFocusPerson}>
              <span className={styles.chamberFocusAvatar}>
                <Portrait person={selectedPerson} size={48} eager />
              </span>
              <span>
                <strong>{selectedPerson.name}</strong>
                <span>{selectedPerson.roleLabel}</span>
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

function overviewAnchor(
  nodeId: string,
  overview: OverviewGeometry,
): { x: number; y: number } | null {
  if (nodeId === "presidenza-repubblica" && overview.headOfState) {
    return { x: overview.headOfState.x, y: overview.headOfState.y };
  }
  if (nodeId === "governo" && overview.primeMinister) {
    return { x: overview.primeMinister.x, y: overview.primeMinister.y };
  }
  if (nodeId === "governo") return null;
  const card = overview.cardByChamber.get(nodeId as ChamberId);
  return card ? { x: card.x + card.width / 2, y: card.y + card.height * 0.35 } : null;
}

function cardWedgeAnchor(groupId: string, overview: OverviewGeometry): { x: number; y: number } | null {
  for (const card of overview.cards) {
    const wedge = card.wedges.find((candidate) => candidate.groupId === groupId);
    if (wedge) return { x: wedge.anchorX, y: wedge.anchorY };
  }
  return null;
}

function describeStatus({
  selection,
  scene,
  people,
  groups,
  institutions,
  roleFilter,
  roleFilterCount,
  familyFilter,
  familyLabel,
}: {
  selection: GraphSelection;
  scene: Scene;
  people: Map<string, RepublicMapPerson>;
  groups: Map<string, RepublicMap["groups"][number]>;
  institutions: Map<string, RepublicMap["institutions"][number]>;
  roleFilter: RoleFilter;
  roleFilterCount: number;
  familyFilter: string | null;
  familyLabel: string | null;
}): string {
  const sceneLabel =
    scene === "overview" ? "panoramica" : scene === "camera" ? "Camera dei deputati" : "Senato della Repubblica";
  const filterBits: string[] = [];
  if (roleFilter !== "tutti") {
    const roleLabel =
      roleFilter === "governo"
        ? "solo Governo"
        : roleFilter === "presidenza"
          ? "solo Presidenze"
          : "solo Capigruppo";
    filterBits.push(`${roleLabel} (${roleFilterCount})`);
  }
  if (familyFilter && familyLabel) filterBits.push(`famiglia ${familyLabel}`);
  const filterSuffix = filterBits.length > 0 ? ` · Filtro: ${filterBits.join(", ")} · gli altri restano in ombra.` : "";

  if (selection.kind === "person") {
    const person = people.get(selection.id);
    return person
      ? `${sceneLabel}: ${person.name}, ${person.roleLabel}.${filterSuffix}`
      : "Selezione non trovata.";
  }
  if (selection.kind === "group") {
    const group = groups.get(selection.id);
    return group
      ? `${sceneLabel}: gruppo ${group.label}, ${group.memberCount} componenti.${filterSuffix}`
      : "Gruppo non trovato.";
  }
  if (selection.kind === "institution") {
    const institution = institutions.get(selection.id);
    return institution ? `Vista: ${institution.label}.${filterSuffix}` : "Istituzione non trovata.";
  }
  if (filterBits.length > 0) {
    return `Panoramica con filtro: ${filterBits.join(", ")}. Gli altri restano in ombra.`;
  }
  return "Panoramica: scegli Camera o Senato per entrare nell’emiciclo.";
}

function QuirinalePlaque({
  institution,
  node,
  people,
  litIds,
  canvasWidth,
  canvasHeight,
}: {
  institution: RepublicMap["institutions"][number];
  node: ApexNode | null;
  people: Map<string, RepublicMapPerson>;
  litIds: Set<string> | null;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const leader = institution.leaderPersonId ? people.get(institution.leaderPersonId) ?? null : null;
  if (!node || !leader) return null;
  return (
    <div
      className={styles.quirinaleHub}
      style={{
        left: `${(node.x / canvasWidth) * 100}%`,
        top: `${(node.y / canvasHeight) * 100}%`,
      }}
    >
      <button
        type="button"
        className={styles.quirinalePortrait}
        data-person={leader.id}
        data-lit={litIds === null || litIds.has(leader.id) ? "true" : "false"}
      >
        <Portrait person={leader} size={88} eager />
        <span className={styles.visuallyHidden}>{`${leader.name}, ${institution.leaderRoleLabel}`}</span>
      </button>
      <button type="button" className={styles.quirinaleHubLabel} data-institution={institution.id}>
        <span className={styles.plaqueRole}>{institution.role}</span>
        <span className={styles.quirinaleTitle}>{leader.name}</span>
      </button>
    </div>
  );
}

function GovernmentCluster({
  institution,
  primeMinister,
  people,
  litIds,
  selection,
  canvasWidth,
  canvasHeight,
}: {
  institution: RepublicMap["institutions"][number];
  primeMinister: ApexNode | null;
  people: Map<string, RepublicMapPerson>;
  litIds: Set<string> | null;
  selection: GraphSelection;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const leader = institution.leaderPersonId ? people.get(institution.leaderPersonId) ?? null : null;
  if (!primeMinister || !leader) return null;
  return (
    <div
      className={styles.governmentCluster}
      style={{
        left: `${(primeMinister.x / canvasWidth) * 100}%`,
        top: `${(primeMinister.y / canvasHeight) * 100}%`,
      }}
    >
      <div className={styles.governmentCrest}>
        <span className={styles.bandLabel} data-tone="executive" data-inline="true">
          Esecutivo
        </span>
        <button
          type="button"
          className={styles.governmentHero}
          data-person={leader.id}
          data-lit={litIds === null || litIds.has(leader.id) ? "true" : "false"}
          data-selected={selection.kind === "person" && selection.id === leader.id ? "true" : "false"}
          title={`${leader.name} · ${leader.roleLabel}`}
        >
          <Portrait person={leader} size={64} eager />
          <span className={styles.visuallyHidden}>{`${leader.name}, ${leader.roleLabel}`}</span>
        </button>
        <button type="button" className={styles.governmentCopy} data-institution={institution.id}>
          <span className={styles.governmentTitle}>{institution.label}</span>
          <span className={styles.governmentMeta}>
            {leader.name} · {institution.memberCount} componenti
          </span>
        </button>
      </div>
    </div>
  );
}

function PortraitNode({
  node,
  people,
  litIds,
  selection,
  size,
  canvasWidth,
  canvasHeight,
}: {
  node: ApexNode;
  people: Map<string, RepublicMapPerson>;
  litIds: Set<string> | null;
  selection: GraphSelection;
  size: number;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const person = people.get(node.personId);
  if (!person) return null;
  const lit = litIds === null || litIds.has(person.id);
  const left = Math.round((node.x / canvasWidth) * 10000) / 100;
  const top = Math.round((node.y / canvasHeight) * 10000) / 100;
  const width = Math.round(((node.radius * 2) / canvasWidth) * 10000) / 100;
  return (
    <button
      type="button"
      className={styles.portraitNode}
      data-person={person.id}
      data-family={person.family}
      data-lit={lit ? "true" : "false"}
      data-selected={selection.kind === "person" && selection.id === person.id ? "true" : "false"}
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width: `${width}%`,
      }}
      title={`${person.name} · ${person.roleLabel}`}
      suppressHydrationWarning
    >
      <Portrait person={person} size={size} eager={size >= 44} />
      <span className={styles.visuallyHidden}>{`${person.name}, ${person.roleLabel}`}</span>
    </button>
  );
}

function PeopleList({
  map,
  groupById,
  matchesFilters,
  query,
  onSelect,
  selection,
}: {
  map: RepublicMap;
  groupById: Map<string, RepublicMap["groups"][number]>;
  matchesFilters: (person: RepublicMapPerson) => boolean;
  query: string;
  onSelect: (id: string) => void;
  selection: GraphSelection;
}) {
  const trimmed = normalize(query.trim());
  const people = map.people.filter(
    (person) => matchesFilters(person) && (trimmed.length < 2 || normalize(person.name).includes(trimmed)),
  );
  return (
    <div className={styles.listColumn}>
      <p className={styles.listCount}>{people.length} persone</p>
      <ul className={styles.peopleList}>
        {people.map((person) => {
          const group = person.groupId ? groupById.get(person.groupId) : null;
          return (
            <li key={person.id}>
              <button
                type="button"
                className={styles.personRow}
                aria-current={selection.kind === "person" && selection.id === person.id}
                onClick={() => onSelect(person.id)}
              >
                <span className={styles.personAvatar}><Portrait person={person} size={40} /></span>
                <span className={styles.personText}>
                  <strong>{person.name}</strong>
                  <span>{person.roleLabel}</span>
                </span>
                {group ? (
                  <span className={styles.personBadge} data-family={person.family}>{group.shortLabel}</span>
                ) : (
                  <span className={styles.personBadge} data-family="governo">Governo</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
