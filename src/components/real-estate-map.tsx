"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { italyRegionGeometry } from "@/data/generated/italy-regions";
import { decimal, integer } from "@/lib/format";
import type { RealEstateMapPoints, RealEstateMunicipalityIndex } from "@/lib/real-estate-map-points";
import styles from "./real-estate-map.module.css";

const USES = ["Non utilizzato", "Inutilizzabile", "In ristrutturazione/manutenzione"] as const;
const USE_TOKEN: Record<string, string> = {
  "Non utilizzato": "--chart-data-primary",
  "Inutilizzabile": "--color-neutral-800",
  "In ristrutturazione/manutenzione": "--color-neutral-500",
};
const USE_LABEL: Record<string, string> = {
  "Non utilizzato": "Non utilizzato",
  "Inutilizzabile": "Inutilizzabile",
  "In ristrutturazione/manutenzione": "In ristrutturazione o manutenzione",
};
const SUMMARY_LABEL: Record<string, string> = {
  "Non utilizzato": "Non utilizzati",
  "Inutilizzabile": "Inutilizzabili",
  "In ristrutturazione/manutenzione": "In ristrutturazione",
};
// MEF labels too long for a list row; the full label stays in the point detail.
const TYPE_LABEL: Record<string, string> = {
  "": "Non indicato",
  "Cantina, soffitta, rimessa, box, garage, posto auto aperto/scoperto,…": "Box, cantine, garage, posti auto",
  "Edificio scolastico (es.: scuola di ogni ordine e grado, università, scuola di formazione)": "Scuola, università",
  "Fabbricato per attività produttiva (industriale, artigianale o agricola)": "Fabbricato produttivo",
  "Teatro, cinematografo, struttura per concerti e spettacoli e assimilabili": "Teatro, cinema, spettacoli",
  "Carcere, prigione, penitenziario, riformatorio e assimilabili": "Carcere",
  "Faro, torre per segnalazioni marittime": "Faro, torre",
};
const typeLabel = (type: string) => TYPE_LABEL[type] ?? type.replace(/\s*\(.*$/, "").replace(/ ed? assimilabili$/, "");
const FRAME = { w: 560, h: 640 };
const HOME = { x: 0, y: 0, w: FRAME.w, h: FRAME.h };
const MAX_ZOOM = 120;

type View = Readonly<{ x: number; y: number; w: number; h: number }>;
type Props = Readonly<{ total: number; byRegion: Readonly<Record<string, number>>; municipalities: RealEstateMunicipalityIndex }>;

const regionName = (code: string) => italyRegionGeometry.find((item) => item.code === code)?.name ?? code;
const searchLabel = (name: string, region: string) => `${name} (${regionName(region)})`;

/** Frame a box keeping the map proportions, so SVG and canvas share one linear transform. */
function frame(minX: number, minY: number, maxX: number, maxY: number, pad: number, minSize: number): View {
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const ratio = FRAME.h / FRAME.w;
  const w = Math.max(maxX - minX, (maxY - minY) / ratio, minSize) * (1 + pad * 2);
  return { x: cx - w / 2, y: cy - (w * ratio) / 2, w, h: w * ratio };
}

function regionView(code: string): View {
  const numbers = (italyRegionGeometry.find((item) => item.code === code)?.path ?? "").match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [0, 0];
  const xs = numbers.filter((_, i) => i % 2 === 0), ys = numbers.filter((_, i) => i % 2 === 1);
  return frame(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 0.05, 1);
}

export function RealEstateMap({ total, byRegion, municipalities }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>(HOME);
  const [region, setRegion] = useState<string | null>(null);
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const [points, setPoints] = useState<RealEstateMapPoints | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<readonly number[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [typeFilter, setTypeFilter] = useState<readonly string[]>([]);
  const typePicker = useRef<HTMLDetailsElement>(null);

  const regions = useMemo(
    () => Object.entries(byRegion).map(([code, count]) => ({ code, name: regionName(code), count })).sort((a, b) => b.count - a.count),
    [byRegion],
  );
  // Quintile classes over the regional counts, as in the regional map of the home page.
  const classOf = useMemo(() => {
    const sorted = regions.map((item) => item.count).sort((a, b) => a - b);
    const breaks = [1, 2, 3, 4].map((q) => sorted[Math.floor((sorted.length * q) / 5)]);
    return (count: number) => 1 + breaks.filter((limit) => count >= limit).length;
  }, [regions]);
  const searchOptions = useMemo(
    () => municipalities.name.map((name, i) => ({ label: searchLabel(name, municipalities.region[i]), name, region: municipalities.region[i] })),
    [municipalities],
  );

  const typeCounts = useMemo(() => {
    if (!points) return [];
    const counts = new Map<string, number>();
    points.type.forEach((type) => counts.set(points.types[type], (counts.get(points.types[type]) ?? 0) + 1));
    return [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
  }, [points]);
  /** Points kept by the type filter; null when every type is shown. */
  const shown = useMemo(() => {
    if (!points || typeFilter.length === 0) return null;
    const wanted = new Set(typeFilter);
    return points.type.map((type) => wanted.has(points.types[type]));
  }, [points, typeFilter]);
  // Every municipality keeps its entry, so a selection survives a type filter that empties it.
  const stats = useMemo(() => {
    if (!points) return [];
    type Entry = { id: number; name: string; total: number; area: number; uses: Record<string, number>; types: Record<string, number>; indexes: number[] };
    const byId = new Map<number, Entry>();
    points.municipality.forEach((id, index) => {
      const entry = byId.get(id) ?? { id, name: points.municipalities[id], total: 0, area: 0, uses: {}, types: {}, indexes: [] };
      byId.set(id, entry);
      if (shown && !shown[index]) return;
      const use = points.uses[points.use[index]], type = points.types[points.type[index]];
      entry.total += 1;
      entry.area += points.area[index] ?? 0;
      entry.uses[use] = (entry.uses[use] ?? 0) + 1;
      entry.types[type] = (entry.types[type] ?? 0) + 1;
      entry.indexes.push(index);
    });
    return [...byId.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "it"));
  }, [points, shown]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const regionTotals = useMemo(() => {
    const totals: Record<string, number> = { all: 0 };
    points?.use.forEach((use, index) => {
      if (shown && !shown[index]) return;
      totals.all += 1;
      totals[points.uses[use]] = (totals[points.uses[use]] ?? 0) + 1;
    });
    return totals;
  }, [points, shown]);

  const scale = size.w ? size.w / view.w : 1;
  const toScreen = (x: number, y: number) => [(x - view.x) * scale, (y - view.y) * scale] as const;
  function toMap(clientX: number, clientY: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: view.x + (clientX - rect.left) / scale, y: view.y + (clientY - rect.top) / scale };
  }

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!region) return;
    const controller = new AbortController();
    fetch(`/api/patrimonio/punti?regione=${region}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data: RealEstateMapPoints) => setPoints(data))
      .catch((error: Error) => { if (error.name !== "AbortError") setLoadError("Punti della regione non disponibili."); });
    return () => controller.abort();
  }, [region]);

  useEffect(() => {
    if (!points || !pendingFocus.current) return;
    const entry = stats.find((item) => item.name === pendingFocus.current);
    pendingFocus.current = null;
    if (entry) select([entry.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, stats]);

  function zoomAt(factor: number, cx = view.x + view.w / 2, cy = view.y + view.h / 2) {
    setView((current) => {
      const w = Math.min(Math.max(current.w * factor, FRAME.w / MAX_ZOOM), FRAME.w * 1.2);
      const k = w / current.w;
      return { x: cx - (cx - current.x) * k, y: cy - (cy - current.y) * k, w, h: current.h * k };
    });
  }

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    // React registers wheel listeners as passive; a native one can prevent the page from scrolling.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const cursor = toMap(event.clientX, event.clientY);
      zoomAt(event.deltaY > 0 ? 1.25 : 0.8, cursor.x, cursor.y);
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  });

  useEffect(() => {
    // <details> has no light dismiss: close the type picker on an outside click or Escape.
    const close = (event: Event) => {
      const picker = typePicker.current;
      if (!picker?.open) return;
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !picker.contains(event.target as Node)) picker.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  const selectedPoint = pinned ?? hovered;
  // Drawn before paint, so points never lag one frame behind the SVG on zoom and pan.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(size.w * ratio), height = Math.round(size.h * ratio);
    // Assigning the size reallocates the backing store even when unchanged.
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d")!;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.w, size.h);
    if (!region || !points) return;
    const css = getComputedStyle(canvas);
    const fills = points.uses.map((use) => css.getPropertyValue(USE_TOKEN[use] ?? "--color-neutral-600").trim());
    const contextFill = css.getPropertyValue("--color-neutral-300").trim();
    const radius = Math.min(5, 2.2 + Math.log2(FRAME.w / view.w) * 0.35);
    const filtered = selectedSet.size > 0;
    // Context first, then the selection on top.
    for (const pass of filtered ? [false, true] : [true]) {
      for (let i = 0; i < points.x.length; i += 1) {
        if (shown && !shown[i]) continue;
        const inSelection = !filtered || selectedSet.has(points.municipality[i]);
        if (inSelection !== pass) continue;
        const [x, y] = toScreen(points.x[i], points.y[i]);
        if (x < -6 || y < -6 || x > size.w + 6 || y > size.h + 6) continue;
        const fill = inSelection ? fills[points.use[i]] : contextFill;
        context.beginPath();
        context.arc(x, y, inSelection ? radius : radius * 0.7, 0, Math.PI * 2);
        if (points.approximate[i] && inSelection) {
          context.lineWidth = 1.2;
          context.strokeStyle = fill;
          context.stroke();
        } else {
          context.globalAlpha = inSelection ? 0.8 : 0.9;
          context.fillStyle = fill;
          context.fill();
          context.globalAlpha = 1;
        }
      }
    }
    if (selectedPoint !== null) {
      const [x, y] = toScreen(points.x[selectedPoint], points.y[selectedPoint]);
      context.beginPath();
      context.arc(x, y, radius + 4, 0, Math.PI * 2);
      context.lineWidth = 2;
      context.strokeStyle = css.getPropertyValue("--color-text").trim();
      context.stroke();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, view, region, points, selectedSet, selectedPoint, shown]);

  function hitTest(clientX: number, clientY: number): number | null {
    if (!region || !points) return null;
    const rect = wrapRef.current!.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    let best: number | null = null, bestDistance = 10 ** 2;
    for (let i = 0; i < points.x.length; i += 1) {
      if ((shown && !shown[i]) || (selectedSet.size && !selectedSet.has(points.municipality[i]))) continue;
      const [x, y] = toScreen(points.x[i], points.y[i]);
      const distance = (x - px) ** 2 + (y - py) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = i; }
    }
    return best;
  }

  function enterRegion(code: string, focus: string | null = null) {
    pendingFocus.current = focus;
    setPoints(null);
    setLoadError(null);
    setSelection([]);
    setTypeFilter([]);
    setRegion(code);
    setView(regionView(code));
    setHovered(null);
    setPinned(null);
  }

  function leaveRegion() {
    setRegion(null);
    setPoints(null);
    setSelection([]);
    setTypeFilter([]);
    setView(HOME);
    setHovered(null);
    setPinned(null);
  }

  function select(ids: readonly number[]) {
    setSelection(ids);
    setPinned(null);
    const indexes = stats.filter((item) => ids.includes(item.id)).flatMap((item) => item.indexes);
    if (!points || indexes.length === 0) {
      if (region) setView(regionView(region));
      return;
    }
    const xs = indexes.map((i) => points.x[i]), ys = indexes.map((i) => points.y[i]);
    setView(frame(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 0.12, FRAME.w / 60));
  }

  function onSearch(value: string) {
    setSearch(value);
    const option = searchOptions.find((item) => item.label === value);
    if (!option) return;
    setSearch("");
    if (option.region === region) {
      const entry = stats.find((item) => item.name === option.name);
      if (entry && !selectedSet.has(entry.id)) select([...selection, entry.id]);
    } else {
      enterRegion(option.region, option.name);
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    drag.current = { x: event.clientX, y: event.clientY, view, moved: false };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (start && event.buttons) {
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true;
      if (start.moved) setView({ ...start.view, x: start.view.x - dx / scale, y: start.view.y - dy / scale });
      return;
    }
    const rect = wrapRef.current!.getBoundingClientRect();
    setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    if (region) setHovered(hitTest(event.clientX, event.clientY));
    else setHoveredRegion((event.target as Element).closest("path[data-region]")?.getAttribute("data-region") ?? null);
  }

  function onClick(event: MouseEvent<HTMLDivElement>) {
    if (drag.current?.moved) return;
    if (region) {
      setPinned(hitTest(event.clientX, event.clientY));
      return;
    }
    const code = (event.target as Element).closest("path[data-region]")?.getAttribute("data-region");
    if (code) enterRegion(code);
  }

  function toggle(id: number) {
    select(selectedSet.has(id) ? selection.filter((item) => item !== id) : [...selection, id]);
  }

  function filterTypes(types: readonly string[]) {
    setTypeFilter(types);
    setPinned(null);
  }

  const zoom = FRAME.w / view.w;
  const selected = selection.map((id) => stats.find((item) => item.id === id)).filter((item) => item !== undefined);
  const ordered = [...selected, ...stats.filter((item) => !selectedSet.has(item.id) && item.total > 0)];
  const sum = (pick: (item: (typeof stats)[number]) => number) => selected.reduce((total, item) => total + pick(item), 0);
  const selectedTypes = [...new Set(selected.flatMap((item) => Object.keys(item.types)))]
    .map((type) => ({ type, total: sum((item) => item.types[type] ?? 0) }))
    .sort((a, b) => b.total - a.total || typeLabel(a.type).localeCompare(typeLabel(b.type), "it"));
  const typeSummary = typeFilter.length === 0 ? "Tutti i tipi" : typeFilter.length === 1 ? typeLabel(typeFilter[0]) : `${typeFilter.length} tipi`;

  // Hover information floats over the map, so the side column never changes height on hover.
  const tip = !region && hoveredRegion
    ? { title: regionName(hoveredRegion), text: `${integer(byRegion[hoveredRegion] ?? 0)} fabbricati fermi · clicca per aprire` }
    : region && points && hovered !== null && pinned === null
      ? {
          title: typeLabel(points.types[points.type[hovered]]),
          text: `${USE_LABEL[points.uses[points.use[hovered]]] ?? points.uses[points.use[hovered]]} · ${points.municipalities[points.municipality[hovered]]} · clicca per i dettagli`,
        }
      : null;
  const TIP_WIDTH = 230;

  return (
    <div className={styles.layout}>
      <figure className={styles.figure}>
        <div className={styles.toolbar}>
          <div className={styles.searchBlock}>
            <label htmlFor="patrimonio-cerca">Cerca un Comune</label>
            <div className={styles.searchRow}>
              <input
                id="patrimonio-cerca"
                className="input"
                type="search"
                list="patrimonio-comuni"
                value={search}
                placeholder="Per esempio: Napoli"
                aria-describedby="patrimonio-cerca-nota"
                onChange={(event) => onSearch(event.target.value)}
              />
              {region ? <button type="button" className="btn btn-secondary" onClick={leaveRegion}>Torna all’Italia</button> : null}
            </div>
            <small id="patrimonio-cerca-nota">
              {region
                ? "Se è in questa regione si aggiunge al confronto, altrimenti si apre la sua regione."
                : "Si apre la sua regione con il Comune selezionato."}
            </small>
            <datalist id="patrimonio-comuni">
              {searchOptions.map((option) => <option key={option.label} value={option.label} />)}
            </datalist>
            {region && points ? (
              <details ref={typePicker} className={styles.typePicker}>
                <summary className="btn btn-secondary">Tipo di edificio: {typeSummary}</summary>
                <fieldset className={styles.typePanel}>
                  <legend>Tipi da mostrare</legend>
                  {typeFilter.length ? (
                    <button type="button" className={styles.linkButton} onClick={() => filterTypes([])}>Mostra tutti i tipi</button>
                  ) : null}
                  <ul className={styles.checkList}>
                    {typeCounts.map(({ type, count }) => (
                      <li key={type}>
                        <label title={type || undefined}>
                          <input
                            type="checkbox"
                            checked={typeFilter.includes(type)}
                            onChange={() => filterTypes(typeFilter.includes(type) ? typeFilter.filter((item) => item !== type) : [...typeFilter, type])}
                          />
                          <span>{typeLabel(type)}</span>
                          <b>{integer(count)}</b>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              </details>
            ) : null}
          </div>
          {region && points ? (
            <dl className={styles.summary} aria-label={`Riepilogo: ${regionName(region)}`}>
              <div>
                <dt>Fabbricati fermi</dt>
                <dd>{integer(regionTotals.all)}</dd>
                <small>{regionName(region)}{typeFilter.length ? ` · ${typeSummary.toLowerCase()}` : ""}</small>
              </div>
              {USES.map((use) => (
                <div key={use}>
                  <dt>{SUMMARY_LABEL[use]}</dt>
                  <dd>{integer(regionTotals[use] ?? 0)}</dd>
                  {regionTotals.all ? <small>{decimal(((regionTotals[use] ?? 0) / regionTotals.all) * 100, 1)}%</small> : null}
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        <div
          ref={wrapRef}
          className={styles.frame}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerLeave={() => { setHovered(null); setHoveredRegion(null); }}
          onClick={onClick}
        >
          <svg
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            preserveAspectRatio="none"
            className={styles.map}
            role="img"
            aria-label={region
              ? `${integer(byRegion[region] ?? 0)} fabbricati pubblici fermi in ${regionName(region)}`
              : `${integer(total)} fabbricati pubblici fermi in Italia, per regione`}
          >
            {italyRegionGeometry.map((item) => (
              <path
                key={item.code}
                d={item.path}
                data-region={item.code}
                className={!region ? styles.nationalRegion : item.code === region ? styles.focusRegion : styles.region}
                style={!region ? { fill: `var(--chart-map-${classOf(byRegion[item.code] ?? 0)})` } as CSSProperties : undefined}
              />
            ))}
            {/* Drawn last: neighbours painted afterwards would cover part of the hovered outline. */}
            {!region && hoveredRegion ? (
              <path d={italyRegionGeometry.find((item) => item.code === hoveredRegion)?.path} className={styles.hoverOutline} />
            ) : null}
          </svg>
          <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
          {tip ? (
            <div
              className={styles.tooltip}
              style={{
                left: Math.max(4, Math.min(pointer.x + 14, size.w - TIP_WIDTH - 4)),
                top: pointer.y > size.h - 80 ? pointer.y - 64 : pointer.y + 16,
                width: TIP_WIDTH,
              }}
              aria-hidden="true"
            >
              <strong>{tip.title}</strong>
              <span>{tip.text}</span>
            </div>
          ) : null}
          {/* Controls live on the map but must not start a drag or a click on it. */}
          <div className={styles.zoomControls} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="btn btn-secondary" onClick={() => zoomAt(0.6)} aria-label="Avvicina">+</button>
            <button type="button" className="btn btn-secondary" onClick={() => zoomAt(1 / 0.6)} aria-label="Allontana">−</button>
          </div>
          {region && pinned !== null && points ? (
            <aside
              className={styles.card}
              aria-live="polite"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <button type="button" className={styles.close} onClick={() => setPinned(null)} aria-label="Chiudi il dettaglio">×</button>
              <dl>
                <div><dt>Tipologia</dt><dd>{points.types[points.type[pinned]]}</dd></div>
                <div><dt>Stato d’uso dichiarato</dt><dd>{USE_LABEL[points.uses[points.use[pinned]]] ?? points.uses[points.use[pinned]]}</dd></div>
                <div><dt>Comune del bene</dt><dd>{points.municipalities[points.municipality[pinned]]}</dd></div>
                <div><dt>Ente proprietario</dt><dd>{points.entities[points.entity[pinned]]}</dd></div>
                <div>
                  <dt>Superficie dichiarata</dt>
                  <dd>{points.area[pinned] === null ? "Non disponibile" : `${decimal(points.area[pinned]!, 0)} m²`}</dd>
                </div>
                {points.approximate[pinned] ? (
                  <div><dt>Posizione</dt><dd>Solo a livello di Comune: il punto non indica l’edificio.</dd></div>
                ) : null}
              </dl>
            </aside>
          ) : null}
          {region && !points ? <p className={styles.loading}>{loadError ?? "Caricamento dei punti…"}</p> : null}
        </div>
        <figcaption className={styles.legend}>
          {region ? (
            <>
              {USES.map((use) => (
                <span key={use}>
                  <i className={styles.swatch} style={{ background: `var(${USE_TOKEN[use]})`, borderColor: `var(${USE_TOKEN[use]})` }} aria-hidden="true" />
                  {USE_LABEL[use]}
                </span>
              ))}
              <span>
                <i className={styles.swatch} style={{ borderColor: "var(--chart-data-primary)" }} aria-hidden="true" />
                Posizione solo a livello di Comune
              </span>
              {selection.length ? (
                <span>
                  <i className={styles.swatch} style={{ background: "var(--color-neutral-300)", borderColor: "var(--color-neutral-300)" }} aria-hidden="true" />
                  Comuni non selezionati
                </span>
              ) : null}
            </>
          ) : (
            <span>Colore più scuro: più fabbricati fermi dichiarati nella regione (quintili).</span>
          )}
          <span className={styles.zoomLevel}>
            Zoom ×{decimal(zoom, 1)} · rotellina o +/−, trascina per spostare{region ? ", clicca un punto per i dettagli" : ""}
          </span>
        </figcaption>
      </figure>

      <div className={styles.side}>
        {region ? (
          <fieldset className={styles.municipalities} disabled={!points}>
            <legend>
              Comuni · {regionName(region)}
              <small>{selection.length ? ` · ${integer(selection.length)} selezionati` : " · spunta per confrontare"}</small>
            </legend>
            {selection.length ? (
              <button type="button" className={styles.linkButton} onClick={() => select([])}>Deseleziona tutti</button>
            ) : null}
            <ul className={styles.checkList}>
              {ordered.map((item) => (
                <li key={item.id}>
                  <label>
                    <input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => toggle(item.id)} />
                    <span>{item.name}</span>
                    <b>{integer(item.total)}</b>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <caption className={styles.caption}>Fabbricati fermi per regione<small>Clicca una regione, qui o sulla mappa, per vedere i singoli beni.</small></caption>
              <thead><tr><th scope="col">Regione</th><th scope="col" className="num">Fabbricati</th></tr></thead>
              <tbody>
                {regions.map((item) => (
                  <tr key={item.code}>
                    <th scope="row">
                      <button type="button" className={styles.linkButton} onClick={() => enterRegion(item.code)}>{item.name}</button>
                    </th>
                    <td className="num">{integer(item.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {region && selected.length ? (
        <div className={styles.comparison}>
          <div className="table-scroll">
            <table className="table">
              <caption className={styles.caption}>Confronto tra i Comuni selezionati</caption>
              <thead>
                <tr>
                  <th scope="col">Comune</th>
                  <th scope="col" className="num">Fermi</th>
                  <th scope="col" className="num">Non utilizzati</th>
                  <th scope="col" className="num">Inutilizzabili</th>
                  <th scope="col" className="num">In ristrutt.</th>
                  <th scope="col" className="num">Superficie (m²)</th>
                </tr>
              </thead>
              <tbody>
                {selected.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">{item.name}</th>
                    <td className="num">{integer(item.total)}</td>
                    {USES.map((use) => <td key={use} className="num">{integer(item.uses[use] ?? 0)}</td>)}
                    <td className="num">{integer(Math.round(item.area))}</td>
                  </tr>
                ))}
              </tbody>
              {selected.length > 1 ? (
                <tfoot>
                  <tr>
                    <th scope="row">Totale selezione</th>
                    <td className="num">{integer(sum((item) => item.total))}</td>
                    {USES.map((use) => <td key={use} className="num">{integer(sum((item) => item.uses[use] ?? 0))}</td>)}
                    <td className="num">{integer(Math.round(sum((item) => item.area)))}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          <div className="table-scroll">
            <table className="table">
              <caption className={styles.caption}>Tipi di edificio nei Comuni selezionati</caption>
              <thead>
                <tr>
                  <th scope="col">Tipo</th>
                  {selected.map((item) => <th key={item.id} scope="col" className="num">{item.name}</th>)}
                  {selected.length > 1 ? <th scope="col" className="num">Totale</th> : null}
                </tr>
              </thead>
              <tbody>
                {selectedTypes.map(({ type, total: typeTotal }) => (
                  <tr key={type}>
                    <th scope="row" title={type || undefined}>{typeLabel(type)}</th>
                    {selected.map((item) => <td key={item.id} className="num">{integer(item.types[type] ?? 0)}</td>)}
                    {selected.length > 1 ? <td className="num">{integer(typeTotal)}</td> : null}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Totale</th>
                  {selected.map((item) => <td key={item.id} className="num">{integer(item.total)}</td>)}
                  {selected.length > 1 ? <td className="num">{integer(sum((item) => item.total))}</td> : null}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
