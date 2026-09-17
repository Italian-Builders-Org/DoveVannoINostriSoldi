"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  ChamberId,
  ParliamentPerson,
  ParliamentaryGroup,
  PoliticiParlamentoSnapshot,
} from "@/lib/data/politici-parlamento-contract";
import styles from "./politici.module.css";

export type PoliticiSelection =
  | { kind: "overview" }
  | { kind: "group"; groupId: string }
  | { kind: "person"; personId: string };

type Props = {
  snapshot: PoliticiParlamentoSnapshot;
  initialSelection?: PoliticiSelection;
};
type DetailTab = "connections" | "news";
type ViewMode = "graph" | "directory";
type ChamberFilter = "all" | ChamberId;
type Point = { x: number; y: number; angle: number };
type NewsArticle = {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  imageUrl: string | null;
};
type NewsConnection = {
  person: {
    id: string;
    name: string;
    chamber: ChamberId;
    groupId: string;
    groupLabel: string;
  };
  articleCount: number;
  articleUrls: string[];
};
type NewsState =
  | { state: "idle"; articles: NewsArticle[]; connections: NewsConnection[] }
  | { state: "loading"; articles: NewsArticle[]; connections: NewsConnection[] }
  | { state: "ready"; articles: NewsArticle[]; connections: NewsConnection[]; observedAt: string }
  | { state: "error"; articles: NewsArticle[]; connections: NewsConnection[]; message: string };

const WIDTH = 1200;
const HEIGHT = 680;
const CHAMBER_CENTERS: Record<ChamberId, Point> = {
  camera: { x: 305, y: 605, angle: 0 },
  senato: { x: 895, y: 605, angle: 0 },
};
const ROW_RADII: Record<ChamberId, number[]> = {
  camera: [145, 178, 211, 244, 277, 310],
  senato: [138, 178, 218, 258, 298],
};
const PARTY_ORDER = [
  "alleanza-verdi-sinistra",
  "partito-democratico",
  "movimento-5-stelle",
  "misto",
  "autonomie",
  "azione",
  "italia-viva",
  "noi-moderati",
  "forza-italia",
  "lega",
  "fratelli-italia",
];
const PARTY_COLORS: Record<string, string> = {
  "alleanza-verdi-sinistra": "#31906c",
  "partito-democratico": "#c53f45",
  "movimento-5-stelle": "#d7a91e",
  misto: "#7f7b75",
  autonomie: "#587a8d",
  azione: "#3479a9",
  "italia-viva": "#a7548f",
  "noi-moderati": "#6b83a7",
  "forza-italia": "#3976bd",
  lega: "#4d8f55",
  "fratelli-italia": "#294f78",
};

function allocateRows(total: number, radii: number[]): number[] {
  const weight = radii.reduce((sum, radius) => sum + radius, 0);
  const exact = radii.map((radius) => total * radius / weight);
  const counts = exact.map(Math.floor);
  let remaining = total - counts.reduce((sum, count) => sum + count, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const item of byRemainder) {
    if (remaining <= 0) break;
    counts[item.index] += 1;
    remaining -= 1;
  }
  return counts;
}

function makeSeats(chamber: ChamberId, total: number): Point[] {
  const center = CHAMBER_CENTERS[chamber];
  const radii = ROW_RADII[chamber];
  const counts = allocateRows(total, radii);
  return radii.flatMap((radius, rowIndex) => Array.from({ length: counts[rowIndex] }, (_, index) => {
    const start = Math.PI + 0.1;
    const span = Math.PI - 0.2;
    const angle = start + ((index + 0.5) / counts[rowIndex]) * span;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      angle,
    };
  })).sort((a, b) => a.angle - b.angle || a.x - b.x);
}

function partyRank(group: ParliamentaryGroup): number {
  const rank = PARTY_ORDER.indexOf(group.partyFamily);
  return rank < 0 ? PARTY_ORDER.length : rank;
}

function formatNewsDate(value: string | null): string {
  if (!value) return "Data non disponibile";
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(value));
}

function chamberName(chamber: ChamberId): string {
  return chamber === "camera" ? "Camera" : "Senato";
}

function portraitUrl(personId: string): string {
  return `/politici/foto/${encodeURIComponent(personId)}`;
}

export function PoliticiGraphExplorer({
  snapshot,
  initialSelection = { kind: "overview" },
}: Props) {
  const [selection, setSelection] = useState<PoliticiSelection>(initialSelection);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<DetailTab>("connections");
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [chamberFilter, setChamberFilter] = useState<ChamberFilter>("all");
  const [zoom, setZoom] = useState(1);
  const [news, setNews] = useState<NewsState>({ state: "idle", articles: [], connections: [] });
  const newsCache = useRef(new Map<string, Extract<NewsState, { state: "ready" }>>());
  const searchInput = useRef<HTMLInputElement>(null);

  const selectedPerson = selection.kind === "person"
    ? snapshot.people.find((person) => person.id === selection.personId) ?? null
    : null;
  const selectedGroup = selection.kind === "group"
    ? snapshot.groups.find((group) => group.id === selection.groupId) ?? null
    : selectedPerson
      ? snapshot.groups.find((group) => group.id === selectedPerson.groupId) ?? null
      : null;

  const peopleByGroup = useMemo(() => {
    const grouped = new Map<string, ParliamentPerson[]>();
    for (const group of snapshot.groups) grouped.set(group.id, []);
    for (const person of snapshot.people) grouped.get(person.groupId)?.push(person);
    return grouped;
  }, [snapshot.groups, snapshot.people]);

  const layout = useMemo(() => {
    const personPoints = new Map<string, Point>();
    const groupPoints = new Map<string, Point>();
    for (const chamber of ["camera", "senato"] as const) {
      const groups = snapshot.groups
        .filter((group) => group.chamber === chamber)
        .sort((a, b) => partyRank(a) - partyRank(b) || a.label.localeCompare(b.label, "it"));
      const people = groups.flatMap((group) =>
        (peopleByGroup.get(group.id) ?? []).slice().sort((a, b) => a.lastName.localeCompare(b.lastName, "it")));
      const seats = makeSeats(chamber, people.length);
      people.forEach((person, index) => personPoints.set(person.id, seats[index]));
      for (const group of groups) {
        const points = (peopleByGroup.get(group.id) ?? [])
          .map((person) => personPoints.get(person.id))
          .filter((point): point is Point => Boolean(point));
        const angle = points.reduce((sum, point) => sum + point.angle, 0) / points.length;
        const center = CHAMBER_CENTERS[chamber];
        groupPoints.set(group.id, {
          x: center.x + Math.cos(angle) * 102,
          y: center.y + Math.sin(angle) * 102,
          angle,
        });
      }
    }
    return { personPoints, groupPoints };
  }, [peopleByGroup, snapshot.groups]);

  const searchHits = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("it-IT");
    if (needle.length < 2) return [];
    const people = snapshot.people
      .filter((person) => person.displayName.toLocaleLowerCase("it-IT").includes(needle)
        || person.groupLabel.toLocaleLowerCase("it-IT").includes(needle))
      .slice(0, 8)
      .map((person) => ({
        kind: "person" as const,
        id: person.id,
        label: person.displayName,
        meta: `${chamberName(person.chamber)} · ${person.groupLabel}`,
      }));
    const groups = snapshot.groups
      .filter((group) => group.label.toLocaleLowerCase("it-IT").includes(needle))
      .slice(0, 4)
      .map((group) => ({
        kind: "group" as const,
        id: group.id,
        label: group.shortLabel,
        meta: `${chamberName(group.chamber)} · ${group.memberCount} persone`,
      }));
    return [...people, ...groups].slice(0, 10);
  }, [query, snapshot.groups, snapshot.people]);

  const selectedMembers = selectedGroup ? peopleByGroup.get(selectedGroup.id) ?? [] : [];
  const personIndex = selectedPerson
    ? snapshot.people.findIndex((person) => person.id === selectedPerson.id)
    : -1;

  function choose(next: PoliticiSelection) {
    setSelection(next);
    setQuery("");
    setTab("connections");
    if (next.kind === "person") {
      setNews({ state: "idle", articles: [], connections: [] });
    } else {
      setNews({ state: "idle", articles: [], connections: [] });
    }
    if (next.kind === "person") setChamberFilter("all");
    const url = new URL(window.location.href);
    url.searchParams.delete("person");
    url.searchParams.delete("group");
    url.searchParams.delete("deputy");
    if (next.kind === "person") url.searchParams.set("person", next.personId);
    if (next.kind === "group") url.searchParams.set("group", next.groupId);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase("it-IT") === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      } else if (event.key === "Escape" && document.activeElement === searchInput.current) {
        setQuery("");
        searchInput.current?.blur();
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    if (!selectedPerson) return;
    const cached = newsCache.current.get(selectedPerson.id);
    if (cached) {
      const cachedUpdate = window.setTimeout(() => setNews(cached), 0);
      return () => window.clearTimeout(cachedUpdate);
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setNews({ state: "loading", articles: [], connections: [] });
      try {
        const response = await fetch(`/api/politici/${encodeURIComponent(selectedPerson.id)}/news`, {
          signal: controller.signal,
        });
        const body = await response.json() as {
          ok: boolean;
          articles?: NewsArticle[];
          connections?: NewsConnection[];
          observedAt?: string;
          error?: string;
        };
        if (!response.ok || !body.ok) throw new Error(body.error ?? "Notizie non disponibili");
        const ready: Extract<NewsState, { state: "ready" }> = {
          state: "ready",
          articles: body.articles ?? [],
          connections: body.connections ?? [],
          observedAt: body.observedAt ?? new Date().toISOString(),
        };
        newsCache.current.set(selectedPerson.id, ready);
        setNews(ready);
      } catch (error) {
        if (controller.signal.aborted) return;
        setNews({
          state: "error",
          articles: [],
          connections: [],
          message: error instanceof Error ? error.message : "Notizie non disponibili",
        });
      }
    }, 450);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [selectedPerson]);

  const focusPoint = selectedPerson
    ? layout.personPoints.get(selectedPerson.id)
    : selectedGroup
      ? layout.groupPoints.get(selectedGroup.id)
      : null;
  const focusScale = zoom * (focusPoint ? 1.42 : 1);
  const focusX = focusPoint?.x ?? WIDTH / 2;
  const focusY = focusPoint?.y ?? 470;

  return (
    <div className={styles.explorer}>
      <header className={styles.explorerHeader}>
        <button type="button" className={styles.brandButton} onClick={() => choose({ kind: "overview" })}>
          <span className={styles.brandMark} aria-hidden="true">◎</span>
          <span><strong>Politici</strong><small>Parlamento · XIX legislatura</small></span>
        </button>
        <div className={styles.commandSearch}>
          <span aria-hidden="true">⌕</span>
          <label htmlFor="politici-search">Cerca nel grafo</label>
          <input
            id="politici-search"
            ref={searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca una persona o un gruppo…"
            autoComplete="off"
          />
          <kbd>⌘ K</kbd>
          {query.trim().length >= 2 ? (
            <div className={styles.searchPopover} role="listbox">
              {searchHits.length ? searchHits.map((hit) => (
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  key={`${hit.kind}:${hit.id}`}
                  onClick={() => choose(hit.kind === "person"
                    ? { kind: "person", personId: hit.id }
                    : { kind: "group", groupId: hit.id })}
                >
                  <span className={styles.resultAvatar} aria-hidden="true">
                    {hit.kind === "person" ? hit.label.split(" ").map((part) => part[0]).slice(0, 2).join("") : "G"}
                  </span>
                  <span><strong>{hit.label}</strong><small>{hit.meta}</small></span>
                </button>
              )) : <p>Nessun risultato. Prova con nome, cognome o gruppo.</p>}
            </div>
          ) : null}
        </div>
        <div className={styles.headerStats} aria-label="Copertura del grafo">
          <span><strong>{snapshot.coverage.people}</strong> persone</span>
          <span><strong>2</strong> rami</span>
        </div>
      </header>

      <div className={styles.explorerBody}>
        <aside className={styles.detailPanel} aria-label="Dettaglio selezione">
          <div className={styles.detailTopbar}>
            <p>{selection.kind === "overview" ? "Parlamento" : selectedPerson ? "Persona" : "Gruppo parlamentare"}</p>
            <div>
              <button
                type="button"
                aria-label="Persona precedente"
                disabled={personIndex < 0}
                onClick={() => choose({
                  kind: "person",
                  personId: snapshot.people[(personIndex - 1 + snapshot.people.length) % snapshot.people.length].id,
                })}
              >←</button>
              <button
                type="button"
                aria-label="Persona successiva"
                disabled={personIndex < 0}
                onClick={() => choose({
                  kind: "person",
                  personId: snapshot.people[(personIndex + 1) % snapshot.people.length].id,
                })}
              >→</button>
            </div>
          </div>

          {selectedPerson ? (
            <>
              <div className={styles.personHero}>
                {/* Both chambers publish one official portrait URL per current member. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={portraitUrl(selectedPerson.id)} alt={`Ritratto ufficiale di ${selectedPerson.displayName}`} />
                <div>
                  <p className={styles.eyebrow}>{chamberName(selectedPerson.chamber)} · XIX legislatura</p>
                  <h2>{selectedPerson.displayName}</h2>
                  <p>{selectedPerson.roleLabel} · {selectedGroup?.shortLabel ?? selectedPerson.groupLabel}</p>
                </div>
              </div>
              <p className={styles.biography}>{selectedPerson.biography}</p>
            </>
          ) : (
            <div className={styles.overviewHero}>
              <p className={styles.eyebrow}>Fonti ufficiali dei due rami</p>
              <h2>{selectedGroup ? selectedGroup.shortLabel : "Parlamento italiano"}</h2>
              <p>
                {selectedGroup
                  ? `${selectedGroup.memberCount} persone al ${chamberName(selectedGroup.chamber)}.`
                  : `${snapshot.coverage.cameraMembers} deputati e ${snapshot.coverage.senateMembers} senatori nello stesso explorer.`}
              </p>
            </div>
          )}

          <div className={styles.primaryActions}>
            {selectedPerson ? (
              <a href={selectedPerson.officialPage} target="_blank" rel="noreferrer">
                Scheda {chamberName(selectedPerson.chamber)} <span aria-hidden="true">↗</span>
              </a>
            ) : null}
            <a
              href={selectedGroup?.uri ?? snapshot.chambers[0].sourceUrl}
              target="_blank"
              rel="noreferrer"
            >Fonte ufficiale <span aria-hidden="true">↗</span></a>
          </div>

          <div className={styles.detailTabs} role="tablist" aria-label="Informazioni sulla selezione">
            <button type="button" role="tab" aria-selected={tab === "connections"} onClick={() => setTab("connections")}>
              Collegamenti
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "news"}
              disabled={!selectedPerson}
              onClick={() => setTab("news")}
            >News</button>
          </div>

          <div className={styles.detailContent}>
            {tab === "connections" ? (
              <Connections
                snapshot={snapshot}
                selectedPerson={selectedPerson}
                selectedGroup={selectedGroup}
                groupMembers={selectedMembers}
                newsConnections={news.connections}
                choose={choose}
              />
            ) : selectedPerson ? <NewsPanel person={selectedPerson} news={news} /> : null}
          </div>
        </aside>

        <section className={styles.canvas} aria-label="Esploratore del Parlamento">
          <div className={styles.canvasToolbar}>
            <div className={styles.viewSwitch} role="group" aria-label="Vista">
              <button type="button" aria-pressed={viewMode === "graph"} onClick={() => setViewMode("graph")}>Grafo</button>
              <button type="button" aria-pressed={viewMode === "directory"} onClick={() => setViewMode("directory")}>Elenco</button>
            </div>
            <div className={styles.chamberSwitch} role="group" aria-label="Ramo del Parlamento">
              {(["all", "camera", "senato"] as const).map((chamber) => (
                <button
                  type="button"
                  key={chamber}
                  aria-pressed={chamberFilter === chamber}
                  onClick={() => setChamberFilter(chamber)}
                >{chamber === "all" ? "Tutto" : chamberName(chamber)}</button>
              ))}
            </div>
            {viewMode === "graph" ? (
              <div className={styles.zoomControls}>
                <button type="button" aria-label="Riduci grafo" onClick={() => setZoom((value) => Math.max(0.72, value - 0.12))}>−</button>
                <button type="button" aria-label="Reimposta zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
                <button type="button" aria-label="Ingrandisci grafo" onClick={() => setZoom((value) => Math.min(1.5, value + 0.12))}>+</button>
              </div>
            ) : null}
          </div>

          {viewMode === "graph" ? (
            <div className={styles.graphViewport}>
              <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.graph} role="img" aria-labelledby="graph-title graph-description">
                <title id="graph-title">Doppio emiciclo del Parlamento italiano</title>
                <desc id="graph-description">
                  Camera e Senato con un punto per ogni componente in carica, raggruppati per appartenenza parlamentare.
                </desc>
                <g transform={`translate(${WIDTH / 2} ${HEIGHT / 2})`}>
                  <g transform={`scale(${focusScale})`}>
                    <g transform={`translate(${-focusX} ${-focusY})`}>
                      {snapshot.groups.flatMap((group) => group.relatedGroupIds
                        .filter((relatedId) => group.id < relatedId)
                        .map((relatedId) => {
                          const start = layout.groupPoints.get(group.id);
                          const end = layout.groupPoints.get(relatedId);
                          if (!start || !end) return null;
                          return (
                            <line
                              key={`${group.id}:${relatedId}`}
                              x1={start.x}
                              y1={start.y}
                              x2={end.x}
                              y2={end.y}
                              className={styles.crossChamberEdge}
                            />
                          );
                        }))}

                      {news.state === "ready" && selectedPerson ? news.connections.map((connection) => {
                        const start = layout.personPoints.get(selectedPerson.id);
                        const end = layout.personPoints.get(connection.person.id);
                        if (!start || !end) return null;
                        return (
                          <line
                            key={`news:${connection.person.id}`}
                            x1={start.x}
                            y1={start.y}
                            x2={end.x}
                            y2={end.y}
                            className={styles.newsEdge}
                          />
                        );
                      }) : null}

                      {(["camera", "senato"] as const).map((chamber) => {
                        const center = CHAMBER_CENTERS[chamber];
                        const chamberData = snapshot.chambers.find((item) => item.id === chamber)!;
                        const dimmed = chamberFilter !== "all" && chamberFilter !== chamber;
                        return (
                          <g key={chamber} data-dimmed={dimmed || undefined} className={styles.chamberHemicycle}>
                            {ROW_RADII[chamber].map((radius) => (
                              <path
                                key={radius}
                                d={`M ${center.x - radius} ${center.y} A ${radius} ${radius} 0 0 1 ${center.x + radius} ${center.y}`}
                                className={styles.guideRing}
                              />
                            ))}
                            <g className={styles.chamberNode} transform={`translate(${center.x} ${center.y})`}>
                              <circle r={58} />
                              <text y={-13} textAnchor="middle">{chamber === "camera" ? "CAMERA" : "SENATO"}</text>
                              <text y={10} textAnchor="middle" className={styles.chamberCount}>{chamberData.memberCount}</text>
                              <text y={29} textAnchor="middle" className={styles.chamberSub}>IN CARICA</text>
                            </g>
                          </g>
                        );
                      })}

                      {snapshot.groups.map((group) => {
                        const point = layout.groupPoints.get(group.id);
                        const center = CHAMBER_CENTERS[group.chamber];
                        if (!point) return null;
                        const active = selectedGroup?.id === group.id;
                        const dimmed = (chamberFilter !== "all" && chamberFilter !== group.chamber)
                          || Boolean(selectedGroup && !active && !selectedGroup.relatedGroupIds.includes(group.id));
                        return (
                          <g key={group.id}>
                            <line
                              x1={center.x}
                              y1={center.y}
                              x2={point.x}
                              y2={point.y}
                              className={styles.groupEdge}
                              data-dimmed={dimmed || undefined}
                            />
                            <g
                              transform={`translate(${point.x} ${point.y})`}
                              className={styles.groupNode}
                              data-active={active || undefined}
                              data-dimmed={dimmed || undefined}
                              style={{ "--node-color": PARTY_COLORS[group.partyFamily] ?? "#6f7479" } as CSSProperties}
                              onClick={() => choose({ kind: "group", groupId: group.id })}
                            >
                              <circle r={20 + Math.sqrt(group.memberCount) * 0.8} />
                              <text y={4} textAnchor="middle">{group.memberCount}</text>
                              <title>{`${group.shortLabel} · ${chamberName(group.chamber)} · ${group.memberCount}`}</title>
                            </g>
                          </g>
                        );
                      })}

                      {snapshot.people.map((person) => {
                        const point = layout.personPoints.get(person.id);
                        const group = snapshot.groups.find((item) => item.id === person.groupId);
                        if (!point || !group) return null;
                        const active = selectedPerson?.id === person.id;
                        const newsRelated = news.connections.some((connection) => connection.person.id === person.id);
                        const dimmed = (chamberFilter !== "all" && chamberFilter !== person.chamber)
                          || Boolean(selectedGroup && selectedGroup.id !== person.groupId
                            && !selectedGroup.relatedGroupIds.includes(person.groupId) && !newsRelated);
                        return (
                          <g
                            key={person.id}
                            transform={`translate(${point.x} ${point.y})`}
                            className={styles.personNode}
                            data-active={active || undefined}
                            data-related={newsRelated || undefined}
                            data-dimmed={dimmed || undefined}
                            style={{ "--node-color": PARTY_COLORS[group.partyFamily] ?? "#6f7479" } as CSSProperties}
                            onClick={() => choose({ kind: "person", personId: person.id })}
                          >
                            <circle r={active ? 7.5 : newsRelated ? 6 : 4.2} />
                            <title>{`${person.displayName} · ${chamberName(person.chamber)} · ${group.shortLabel}`}</title>
                          </g>
                        );
                      })}
                    </g>
                  </g>
                </g>
              </svg>
              <div className={styles.graphLabels} aria-hidden="true">
                <span>Camera dei deputati</span>
                <span>Senato della Repubblica</span>
              </div>
              <p className={styles.graphHint}>Seleziona una persona: l’emiciclo si sposta e mostra le co-citazioni trovate nei titoli delle news.</p>
            </div>
          ) : (
            <Directory snapshot={snapshot} peopleByGroup={peopleByGroup} choose={choose} />
          )}

          <div className={styles.legendBar}>
            <span><i className={styles.legendChamber} /> Ramo</span>
            <span><i className={styles.legendGroup} /> Gruppo</span>
            <span><i className={styles.legendPerson} /> Persona</span>
            <span><i className={styles.legendNews} /> Co-citazione news</span>
            <button type="button" onClick={() => choose({ kind: "overview" })}>Reimposta selezione</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Connections({
  snapshot,
  selectedPerson,
  selectedGroup,
  groupMembers,
  newsConnections,
  choose,
}: {
  snapshot: PoliticiParlamentoSnapshot;
  selectedPerson: ParliamentPerson | null;
  selectedGroup: ParliamentaryGroup | null;
  groupMembers: ParliamentPerson[];
  newsConnections: NewsConnection[];
  choose: (selection: PoliticiSelection) => void;
}) {
  if (selectedPerson && selectedGroup) {
    const peers = groupMembers.filter((person) => person.id !== selectedPerson.id).slice(0, 6);
    const relatedGroups = selectedGroup.relatedGroupIds
      .map((id) => snapshot.groups.find((group) => group.id === id))
      .filter((group): group is ParliamentaryGroup => Boolean(group));
    return (
      <>
        <section className={styles.relationSection}>
          <h3>Relazioni istituzionali</h3>
          <button type="button" className={styles.relationCard} onClick={() => choose({ kind: "group", groupId: selectedGroup.id })}>
            <span className={styles.relationIcon}>G</span>
            <span><small>Appartiene a · {chamberName(selectedGroup.chamber)}</small><strong>{selectedGroup.shortLabel}</strong></span>
            <span aria-hidden="true">›</span>
          </button>
          {relatedGroups.map((group) => (
            <button type="button" className={styles.relationCard} key={group.id} onClick={() => choose({ kind: "group", groupId: group.id })}>
              <span className={styles.relationIcon}>↔</span>
              <span><small>Gruppo omologo · {chamberName(group.chamber)}</small><strong>{group.shortLabel}</strong></span>
              <span aria-hidden="true">›</span>
            </button>
          ))}
        </section>
        {newsConnections.length ? (
          <section className={styles.relationSection}>
            <h3>Co-citati nelle notizie</h3>
            <ul className={styles.peopleList}>
              {newsConnections.slice(0, 8).map((connection) => (
                <PersonListItem
                  key={connection.person.id}
                  person={snapshot.people.find((person) => person.id === connection.person.id)!}
                  meta={`${connection.articleCount} titoli condivisi · ${chamberName(connection.person.chamber)}`}
                  choose={choose}
                />
              ))}
            </ul>
          </section>
        ) : null}
        <section className={styles.relationSection}>
          <h3>Nello stesso gruppo</h3>
          <ul className={styles.peopleList}>
            {peers.map((person) => <PersonListItem key={person.id} person={person} choose={choose} />)}
          </ul>
        </section>
      </>
    );
  }

  if (selectedGroup) {
    const relatedGroups = selectedGroup.relatedGroupIds
      .map((id) => snapshot.groups.find((group) => group.id === id))
      .filter((group): group is ParliamentaryGroup => Boolean(group));
    return (
      <>
        {relatedGroups.map((group) => (
          <button type="button" className={styles.relationCard} key={group.id} onClick={() => choose({ kind: "group", groupId: group.id })}>
            <span className={styles.relationIcon}>↔</span>
            <span><small>Gruppo omologo · {chamberName(group.chamber)}</small><strong>{group.shortLabel}</strong></span>
            <span aria-hidden="true">›</span>
          </button>
        ))}
        <section className={styles.relationSection}>
          <div className={styles.sectionHeading}><h3>Membri del gruppo</h3><span>{groupMembers.length}</span></div>
          <ul className={styles.peopleList}>
            {groupMembers.map((person) => <PersonListItem key={person.id} person={person} choose={choose} />)}
          </ul>
        </section>
      </>
    );
  }

  return (
    <>
      <section className={styles.coverageGrid} aria-label="Copertura">
        <div><strong>{snapshot.coverage.cameraMembers}</strong><span>Camera in carica</span></div>
        <div><strong>{snapshot.coverage.senateMembers}</strong><span>Senato in carica</span></div>
      </section>
      <section className={styles.relationSection}>
        <h3>Esplora i due rami</h3>
        <ul className={styles.groupList}>
          {snapshot.groups
            .slice()
            .sort((a, b) => a.chamber.localeCompare(b.chamber) || partyRank(a) - partyRank(b))
            .map((group) => (
              <li key={group.id}>
                <button type="button" onClick={() => choose({ kind: "group", groupId: group.id })}>
                  <span><strong>{group.shortLabel}</strong><small>{chamberName(group.chamber)} · {group.memberCount} persone</small></span>
                  <span aria-hidden="true">›</span>
                </button>
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}

function PersonListItem({
  person,
  meta,
  choose,
}: {
  person: ParliamentPerson;
  meta?: string;
  choose: (selection: PoliticiSelection) => void;
}) {
  return (
    <li>
      <button type="button" onClick={() => choose({ kind: "person", personId: person.id })}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={portraitUrl(person.id)} alt="" loading="lazy" />
        <span><strong>{person.displayName}</strong><small>{meta ?? `${chamberName(person.chamber)} · ${person.groupLabel}`}</small></span>
        <span aria-hidden="true">›</span>
      </button>
    </li>
  );
}

function NewsPanel({ person, news }: { person: ParliamentPerson; news: NewsState }) {
  const searchUrl = `https://news.google.com/search?q=${encodeURIComponent(`"${person.displayName}"`)}&hl=it&gl=IT&ceid=IT:it`;
  return (
    <section className={styles.newsPanel} aria-live="polite">
      <div className={styles.sectionHeading}>
        <div><h3>Notizie collegate</h3><p>Ultimi 3 mesi · indice GDELT</p></div>
        <a href={searchUrl} target="_blank" rel="noreferrer">Tutte ↗</a>
      </div>
      {news.state === "idle" || news.state === "loading" ? (
        <div className={styles.loadingNews}><i /><i /><i /></div>
      ) : news.state === "error" ? (
        <div className={styles.emptyState}>
          <strong>News temporaneamente non disponibili</strong>
          <p>{news.message}</p>
          <a href={searchUrl} target="_blank" rel="noreferrer">Cerca comunque su Google News ↗</a>
        </div>
      ) : news.articles.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>Nessun risultato recente verificato</strong>
          <p>L’assenza di risultati non significa assenza di copertura giornalistica.</p>
          <a href={searchUrl} target="_blank" rel="noreferrer">Allarga la ricerca ↗</a>
        </div>
      ) : (
        <ul className={styles.newsList}>
          {news.articles.map((article) => (
            <li key={article.url}>
              <a href={article.url} target="_blank" rel="noreferrer">
                <span className={styles.newsMeta}>{article.source} · {formatNewsDate(article.publishedAt)}</span>
                <strong>{article.title}</strong>
                <span className={styles.newsLink}>Apri l’articolo ↗</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.newsDisclaimer}>
        Un collegamento tra persone indica solo che i loro nomi compaiono nello stesso titolo indicizzato. Non prova relazioni, responsabilità, influenza o presenza nel testo integrale.
      </p>
    </section>
  );
}

function Directory({
  snapshot,
  peopleByGroup,
  choose,
}: {
  snapshot: PoliticiParlamentoSnapshot;
  peopleByGroup: Map<string, ParliamentPerson[]>;
  choose: (selection: PoliticiSelection) => void;
}) {
  return (
    <div className={styles.directory}>
      <div className={styles.directoryIntro}>
        <p className={styles.eyebrow}>Elenco completo</p>
        <h2>Camera e Senato, per gruppo</h2>
        <p>La vista testuale contiene tutte le persone del doppio emiciclo ed è più rapida con tastiera o su schermi piccoli.</p>
      </div>
      {(["camera", "senato"] as const).map((chamber) => (
        <section key={chamber}>
          <h3>{chamber === "camera" ? "Camera dei deputati" : "Senato della Repubblica"}</h3>
          {snapshot.groups.filter((group) => group.chamber === chamber).map((group) => (
            <section key={group.id}>
              <button type="button" className={styles.directoryGroup} onClick={() => choose({ kind: "group", groupId: group.id })}>
                <span><strong>{group.shortLabel}</strong><small>{group.memberCount} persone</small></span><span>Apri gruppo →</span>
              </button>
              <div className={styles.directoryPeople}>
                {(peopleByGroup.get(group.id) ?? []).map((person) => (
                  <button type="button" key={person.id} onClick={() => choose({ kind: "person", personId: person.id })}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={portraitUrl(person.id)} alt="" loading="lazy" />
                    <span>{person.displayName}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </section>
      ))}
    </div>
  );
}
