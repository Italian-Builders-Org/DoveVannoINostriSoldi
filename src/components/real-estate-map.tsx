"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { italyRegionGeometry } from "@/data/generated/italy-regions";
import { decimal, integer } from "@/lib/format";
import type { RealEstateMunicipalityIndex, RealEstateRegionData } from "@/lib/real-estate-map-points";
import styles from "./real-estate-map.module.css";

const USES = ["Non utilizzato", "Inutilizzabile", "In ristrutturazione/manutenzione"] as const;
const SUMMARY_LABEL: Record<string, string> = {
  "Non utilizzato": "Non utilizzati",
  "Inutilizzabile": "Inutilizzabili",
  "In ristrutturazione/manutenzione": "In ristrutturazione",
};
const USE_COLOR: Record<string, string> = {
  "Non utilizzato": "var(--chart-map-5)",
  "Inutilizzabile": "var(--chart-category-amber)",
  "In ristrutturazione/manutenzione": "var(--chart-category-purple)",
};
// MEF labels too long for a list row; the full label stays in the title attribute.
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
const PAGE = 20;
// Below this, a couple of buildings already make an extreme ratio: those municipalities stay out of that ranking.
const MIN_TAXPAYERS = 1_000;

type Metric = "count" | "ratio";
type Data = Readonly<{
  total: number;
  byRegion: Readonly<Record<string, number>>;
  byUse: Readonly<Record<string, number>>;
  municipalities: RealEstateMunicipalityIndex;
}>;
/** What the page shows, read from and written to the URL so it can be shared and navigated back. */
type View = Readonly<{ region: string | null; comuni: readonly string[]; types: readonly string[]; metric: Metric }>;

const NATIONAL_VIEW: View = { region: null, comuni: [], types: [], metric: "count" };

const regionName = (code: string) => italyRegionGeometry.find((item) => item.code === code)?.name ?? code;
const searchLabel = (name: string, region: string) => `${name} (${regionName(region)})`;
const perThousand = (total: number, taxpayers: number) => (taxpayers ? decimal((total * 1000) / taxpayers, 1) : "n.d.");

function viewFrom(params: URLSearchParams): View {
  const region = params.get("regione");
  if (!italyRegionGeometry.some((item) => item.code === region)) return NATIONAL_VIEW;
  return {
    region,
    comuni: [...new Set((params.get("comuni") ?? "").split(",").filter(Boolean))],
    types: params.getAll("tipo"),
    metric: params.get("ordina") === "contribuenti" ? "ratio" : "count",
  };
}

// The native History API keeps the prerendered page: no server round trip, and useSearchParams follows.
function go(view: View, mode: "push" | "replace") {
  const params = new URLSearchParams();
  if (view.region) {
    params.set("regione", view.region);
    if (view.comuni.length) params.set("comuni", view.comuni.join(","));
    for (const type of view.types) params.append("tipo", type);
    if (view.metric === "ratio") params.set("ordina", "contribuenti");
  }
  const url = params.size ? `?${params}` : window.location.pathname;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

/** Reads the view from the URL: wrap it in Suspense, the static fallback being the national view. */
export function RealEstateExplorer(props: Data) {
  const view = viewFrom(new URLSearchParams(useSearchParams().toString()));
  // A new region starts from a clean state: no stale data, page size or search text.
  return <RealEstateMap key={view.region ?? "italia"} {...props} view={view} />;
}

export function RealEstateMap({ total, byRegion, byUse, municipalities, view = NATIONAL_VIEW }: Data & Readonly<{ view?: View }>) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const typePicker = useRef<HTMLDetailsElement>(null);
  const { region, metric } = view;
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0, width: 0 });
  const [data, setData] = useState<RealEstateRegionData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  // Types that are not in this region, from an edited URL, would hide every building.
  const typeFilter = useMemo(() => (data ? view.types.filter((type) => data.types.includes(type)) : view.types), [data, view.types]);

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
    () => municipalities.name.map((name, i) => ({ label: searchLabel(name, municipalities.region[i]), code: municipalities.code[i], region: municipalities.region[i] })),
    [municipalities],
  );
  const searchList = useMemo(() => searchOptions.map((option) => <option key={option.label} value={option.label} />), [searchOptions]);

  const typeCounts = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    data.cells.type.forEach((type, index) => counts.set(data.types[type], (counts.get(data.types[type]) ?? 0) + data.cells.buildings[index]));
    return [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
  }, [data]);
  // Every municipality keeps its entry, so a selection survives a type filter that empties it.
  const stats = useMemo(() => {
    if (!data) return [];
    const wanted = typeFilter.length ? new Set(typeFilter) : null;
    const entries = data.municipalities.map(({ code, name, taxpayers }, id) => ({
      id, code, name, taxpayers, total: 0, area: 0, uses: {} as Record<string, number>, types: {} as Record<string, number>,
    }));
    data.cells.municipality.forEach((id, index) => {
      const type = data.types[data.cells.type[index]];
      if (wanted && !wanted.has(type)) return;
      const entry = entries[id], count = data.cells.buildings[index], use = data.uses[data.cells.use[index]];
      entry.total += count;
      entry.area += data.cells.area[index];
      entry.uses[use] = (entry.uses[use] ?? 0) + count;
      entry.types[type] = (entry.types[type] ?? 0) + count;
    });
    return entries;
  }, [data, typeFilter]);
  const statsByCode = useMemo(() => new Map(stats.map((entry) => [entry.code, entry])), [stats]);
  const selectedSet = useMemo(() => new Set(view.comuni), [view.comuni]);
  const regionTotals = useMemo(() => {
    const totals: Record<string, number> = { all: 0 };
    stats.forEach((entry) => {
      totals.all += entry.total;
      for (const [use, count] of Object.entries(entry.uses)) totals[use] = (totals[use] ?? 0) + count;
    });
    return totals;
  }, [stats]);
  const ranking = useMemo(() => {
    const withBuildings = stats.filter((entry) => entry.total > 0);
    const rows = withBuildings
      .map((entry) => ({
        entry,
        value: metric === "count" ? entry.total : entry.taxpayers !== null && entry.taxpayers >= MIN_TAXPAYERS ? (entry.total * 1000) / entry.taxpayers : null,
      }))
      .filter((row): row is { entry: (typeof stats)[number]; value: number } => row.value !== null)
      .sort((a, b) => b.value - a.value || a.entry.name.localeCompare(b.entry.name, "it"));
    return { rows, excluded: withBuildings.length - rows.length };
  }, [stats, metric]);

  useEffect(() => {
    if (!region) return;
    const controller = new AbortController();
    fetch(`/api/patrimonio/punti?regione=${region}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((payload: RealEstateRegionData) => setData(payload))
      .catch((error: Error) => { if (error.name !== "AbortError") setLoadError("Dati della regione non disponibili."); });
    return () => controller.abort();
  }, [region]);

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

  function enterRegion(code: string, comune: string | null = null) {
    go({ ...NATIONAL_VIEW, region: code, comuni: comune ? [comune] : [] }, "push");
  }

  function toggle(code: string) {
    go({ ...view, comuni: selectedSet.has(code) ? view.comuni.filter((item) => item !== code) : [...view.comuni, code] }, "push");
  }

  function setTypeFilter(types: readonly string[]) {
    go({ ...view, types }, "replace");
  }

  function setMetric(next: Metric) {
    go({ ...view, metric: next }, "replace");
  }

  function onSearch(value: string) {
    setSearch(value);
    const option = searchOptions.find((item) => item.label === value);
    if (!option) return;
    setSearch("");
    if (option.region !== region) enterRegion(option.region, option.code);
    else if (!selectedSet.has(option.code)) toggle(option.code);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const rect = wrapRef.current!.getBoundingClientRect();
    setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width });
    setHoveredRegion((event.target as Element).closest("path[data-region]")?.getAttribute("data-region") ?? null);
  }

  function onClick(event: MouseEvent<HTMLDivElement>) {
    const code = (event.target as Element).closest("path[data-region]")?.getAttribute("data-region");
    if (code) enterRegion(code);
  }

  const selected = view.comuni.map((code) => statsByCode.get(code)).filter((item) => item !== undefined);
  const sum = (pick: (item: (typeof stats)[number]) => number) => selected.reduce((total, item) => total + pick(item), 0);
  const selectedTypes = [...new Set(selected.flatMap((item) => Object.keys(item.types)))]
    .map((type) => ({ type, total: sum((item) => item.types[type] ?? 0) }))
    .sort((a, b) => b.total - a.total || typeLabel(a.type).localeCompare(typeLabel(b.type), "it"));
  const typeSummary = typeFilter.length === 0 ? "Tutti i tipi" : typeFilter.length === 1 ? typeLabel(typeFilter[0]) : `${typeFilter.length} tipi`;
  const known = selected.filter((item) => item.taxpayers !== null);
  const totals: Record<string, number> = region ? regionTotals : { all: total, ...byUse };
  const largest = ranking.rows[0]?.value ?? 1;
  const format = (value: number) => (metric === "count" ? integer(value) : decimal(value, 1));
  const TIP_WIDTH = 230;

  return (
    <div className={styles.layout}>
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
            {region ? <button type="button" className="btn btn-secondary" onClick={() => go(NATIONAL_VIEW, "push")}>Torna all’Italia</button> : null}
          </div>
          <small id="patrimonio-cerca-nota">
            {region
              ? "Se è in questa regione si aggiunge al confronto, altrimenti si apre la sua regione."
              : "Si apre la sua regione con il Comune selezionato."}
          </small>
          <datalist id="patrimonio-comuni">{searchList}</datalist>
        </div>
        {!region || data ? (
          <dl className={styles.summary} aria-label={`Riepilogo: ${region ? regionName(region) : "Italia"}`}>
            <div>
              <dt>Fabbricati fermi</dt>
              <dd>{integer(totals.all)}</dd>
              <small>{region ? regionName(region) : "Italia"}{typeFilter.length ? ` · ${typeSummary.toLowerCase()}` : ""}</small>
            </div>
            {USES.map((use) => (
              <div key={use}>
                <dt>{SUMMARY_LABEL[use]}</dt>
                <dd>{integer(totals[use] ?? 0)}</dd>
                {totals.all ? <small>{decimal(((totals[use] ?? 0) / totals.all) * 100, 1)}%</small> : null}
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      {region ? (
        <section className={styles.ranking} aria-labelledby="patrimonio-classifica" aria-busy={!data && !loadError}>
          <h3 id="patrimonio-classifica" className={styles.caption}>
            Fabbricati fermi per Comune · {regionName(region)}
            <small>Clicca un Comune per aggiungerlo al confronto o toglierlo.</small>
          </h3>
          {data ? (
            <>
              <div className={styles.controls}>
                <details ref={typePicker} className={styles.typePicker}>
                  <summary className="btn btn-secondary">Tipo di edificio: {typeSummary}</summary>
                  <fieldset className={styles.typePanel}>
                    <legend>Tipi da mostrare</legend>
                    {typeFilter.length ? (
                      <button type="button" className={styles.linkButton} onClick={() => setTypeFilter([])}>Mostra tutti i tipi</button>
                    ) : null}
                    <ul className={styles.checkList}>
                      {typeCounts.map(({ type, count }) => (
                        <li key={type}>
                          <label title={type || undefined}>
                            <input
                              type="checkbox"
                              checked={typeFilter.includes(type)}
                              onChange={() => setTypeFilter(typeFilter.includes(type) ? typeFilter.filter((item) => item !== type) : [...typeFilter, type])}
                            />
                            <span>{typeLabel(type)}</span>
                            <b>{integer(count)}</b>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                </details>
                <div className={styles.metric} role="radiogroup" aria-labelledby="patrimonio-ordina">
                  <span id="patrimonio-ordina">Ordina per</span>
                  <span className={styles.segments}>
                    <label>
                      <input type="radio" name="patrimonio-metrica" checked={metric === "count"} onChange={() => setMetric("count")} />
                      Numero
                    </label>
                    <label>
                      <input type="radio" name="patrimonio-metrica" checked={metric === "ratio"} onChange={() => setMetric("ratio")} />
                      Per 1.000 contribuenti
                    </label>
                  </span>
                </div>
              </div>
              <p className={styles.legend}>
                {USES.map((use) => (
                  <span key={use}><i className={styles.swatch} style={{ background: USE_COLOR[use] }} aria-hidden="true" />{SUMMARY_LABEL[use]}</span>
                ))}
              </p>
              {ranking.rows.length ? (
                <ol className={styles.bars}>
                  {ranking.rows.slice(0, limit).map(({ entry, value }) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className={styles.bar}
                        aria-pressed={selectedSet.has(entry.code)}
                        onClick={() => toggle(entry.code)}
                        aria-label={`${entry.name}: ${format(value)}${metric === "ratio" ? " fabbricati fermi ogni 1.000 contribuenti" : " fabbricati fermi"}`}
                      >
                        <span className={styles.barName}>{entry.name}</span>
                        <b className={styles.barValue}>{format(value)}</b>
                        <span className={styles.barTrack} aria-hidden="true">
                          {USES.map((use) => (
                            <i key={use} style={{ width: `${((entry.uses[use] ?? 0) / entry.total) * (value / largest) * 100}%`, background: USE_COLOR[use] }} />
                          ))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={styles.empty}>Nessun fabbricato fermo di questo tipo nella regione.</p>
              )}
              <div className={styles.more}>
                {ranking.rows.length > limit ? (
                  <button type="button" className="btn btn-secondary" onClick={() => setLimit(limit + PAGE)}>
                    Mostra altri {integer(Math.min(PAGE, ranking.rows.length - limit))}
                  </button>
                ) : null}
                <small>
                  {integer(Math.min(limit, ranking.rows.length))} di {integer(ranking.rows.length)} Comuni
                  {metric === "ratio"
                    ? `. Contribuenti IRPEF 2024 del Comune, che non sono i residenti; ${
                      ranking.excluded ? `esclusi ${integer(ranking.excluded)} Comuni sotto i ${integer(MIN_TAXPAYERS)} contribuenti o soppressi` : "nessun Comune escluso"}.`
                    : "."}
                </small>
              </div>
            </>
          ) : (
            <p className={styles.empty}>{loadError ?? "Caricamento dei Comuni…"}</p>
          )}
        </section>
      ) : (
        <>
          <figure className={styles.figure}>
            <div
              ref={wrapRef}
              className={styles.frame}
              onPointerMove={onPointerMove}
              onPointerLeave={() => setHoveredRegion(null)}
              onClick={onClick}
            >
              <svg viewBox="0 0 560 640" className={styles.map} role="img" aria-label={`${integer(total)} fabbricati pubblici fermi in Italia, per regione`}>
                {italyRegionGeometry.map((item) => (
                  <path
                    key={item.code}
                    d={item.path}
                    data-region={item.code}
                    className={styles.nationalRegion}
                    style={{ fill: `var(--chart-map-${classOf(byRegion[item.code] ?? 0)})` } as CSSProperties}
                  />
                ))}
                {/* Drawn last: neighbours painted afterwards would cover part of the hovered outline. */}
                {hoveredRegion ? (
                  <path d={italyRegionGeometry.find((item) => item.code === hoveredRegion)?.path} className={styles.hoverOutline} />
                ) : null}
              </svg>
              {hoveredRegion ? (
                <div
                  className={styles.tooltip}
                  style={{
                    left: Math.max(4, Math.min(pointer.x + 14, pointer.width - TIP_WIDTH - 4)),
                    top: pointer.y + 16,
                    width: TIP_WIDTH,
                  }}
                  aria-hidden="true"
                >
                  <strong>{regionName(hoveredRegion)}</strong>
                  <span>{integer(byRegion[hoveredRegion] ?? 0)} fabbricati fermi · clicca per aprire</span>
                </div>
              ) : null}
            </div>
            <figcaption className={styles.legend}>
              <span>Colore più scuro: più fabbricati fermi dichiarati nella regione (quintili).</span>
            </figcaption>
          </figure>
          <div className={styles.side}>
            <div className="table-scroll">
              <table className="table">
                <caption className={styles.caption}>Fabbricati fermi per regione<small>Clicca una regione, qui o sulla mappa, per vedere i suoi Comuni.</small></caption>
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
          </div>
        </>
      )}

      {region && selected.length ? (
        <div className={styles.comparison}>
          <button type="button" className={styles.linkButton} onClick={() => go({ ...view, comuni: [] }, "push")}>Deseleziona tutti</button>
          <div className="table-scroll">
            <table className="table">
              <caption className={styles.caption}>Confronto tra i Comuni selezionati</caption>
              <thead>
                <tr>
                  <th scope="col">Comune</th>
                  <th scope="col" className="num">Fermi</th>
                  <th scope="col" className="num">Ogni 1.000 contrib.</th>
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
                    <td className="num">{perThousand(item.total, item.taxpayers ?? 0)}</td>
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
                    <td className="num">
                      {perThousand(known.reduce((total, item) => total + item.total, 0), known.reduce((total, item) => total + item.taxpayers!, 0))}
                    </td>
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
