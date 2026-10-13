"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BoardTile, BoardTileFilters, BoardTileView } from "@/lib/data/boards-document";
import { projectLocalTable } from "@/lib/boards/local-csv";
import {
  resolveActiveSeriesIds,
  type BoardTileSeriesPayload,
} from "@/lib/boards/tile-series";
import styles from "./board-tile-chart.module.css";

const SERIES_COLORS = ["var(--boards-chart-1)", "var(--boards-chart-2)", "var(--boards-chart-3)"];

function seriesColors(accent?: string): string[] {
  if (accent && /^#[0-9a-fA-F]{6}$/u.test(accent)) {
    return [accent, SERIES_COLORS[1]!, SERIES_COLORS[2]!];
  }
  return SERIES_COLORS;
}

const euroCompact = new Intl.NumberFormat("it-IT", {
  notation: "compact",
  maximumFractionDigits: 1,
});

type Props = {
  tile: BoardTile;
  onFiltersChange?: (filters: BoardTileFilters) => void;
  /** Token share unlisted: permette la lettura senza sessione. */
  shareToken?: string;
  /** Serie già proiettate (es. CSV locale): salta il fetch MCP. */
  inlinePayload?: BoardTileSeriesPayload | null;
};

type ViewProps = {
  tile: BoardTile;
  onFiltersChange?: (filters: BoardTileFilters) => void;
  payload: BoardTileSeriesPayload | null;
  loading: boolean;
  error: string | null;
};

function BoardTileChartView({ tile, onFiltersChange, payload, loading, error }: ViewProps) {
  const colors = seriesColors(tile.color);

  const activeIds = useMemo(
    () => (payload ? resolveActiveSeriesIds(payload, tile.filters ?? {}) : []),
    [payload, tile.filters],
  );

  const chartRows = useMemo(() => {
    if (!payload) return [];
    return payload.points.map((point) => {
      const row: Record<string, string | number> = { label: point.label };
      for (const id of activeIds) {
        const value = point.values[id];
        if (typeof value === "number") row[id] = value;
      }
      return row;
    });
  }, [payload, activeIds]);

  if (loading) {
    return <div className={styles.state}>Caricamento dati…</div>;
  }
  if (error) {
    const needsCode = /filtro code|code è obbligatorio/i.test(error);
    return (
      <div className={styles.state} role="alert">
        <p>{error}</p>
        {needsCode ? (
          <p className={styles.hint}>
            Apri l&apos;inspector a destra e inserisci il filtro <code>code</code> (codice
            amministrazione OpenBDAP), poi la serie si carica.
          </p>
        ) : null}
      </div>
    );
  }
  if (!payload || (payload.points.length === 0 && !payload.kpi)) {
    return (
      <div className={styles.state}>
        {payload?.caveat ?? "Nessuna serie disponibile per questa tile."}
      </div>
    );
  }

  return (
    <div className={styles.root} data-testid="board-tile-chart">
      {tile.view === "kpi" && payload.kpi ? (
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>{payload.kpi.label}</p>
          <p className={styles.kpiValue}>{payload.kpi.formatted}</p>
          <p className={styles.kpiPeriod}>{payload.periodLabel}</p>
        </div>
      ) : null}

      {tile.view === "table" ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Periodo</th>
                {activeIds.map((id) => (
                  <th key={id} scope="col">
                    {payload.series.find((item) => item.id === id)?.label ?? id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payload.points.slice(-8).map((point) => (
                <tr key={point.label}>
                  <th scope="row">{point.label}</th>
                  {activeIds.map((id) => (
                    <td key={id}>
                      {typeof point.values[id] === "number"
                        ? euroCompact.format(point.values[id]!)
                        : "n.d."}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {(tile.view === "line" || tile.view === "bar") && chartRows.length > 0 ? (
        <div className={styles.chart} role="img" aria-label={`${tile.view} ${payload.title}`}>
          <ResponsiveContainer width="100%" height="100%">
            {tile.view === "line" ? (
              <LineChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--boards-chart-grid)" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--boards-muted)", fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  width={48}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--boards-muted)", fontSize: 10 }}
                  tickFormatter={(value) => euroCompact.format(Number(value))}
                />
                <Tooltip
                  isAnimationActive={false}
                  formatter={(value, name) => [
                    euroCompact.format(Number(value)),
                    payload.series.find((item) => item.id === name)?.label ?? String(name),
                  ]}
                />
                {activeIds.map((id, index) => (
                  <Line
                    key={id}
                    type="monotone"
                    dataKey={id}
                    stroke={colors[index % colors.length]}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            ) : (
              <BarChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--boards-chart-grid)" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--boards-muted)", fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  width={48}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--boards-muted)", fontSize: 10 }}
                  tickFormatter={(value) => euroCompact.format(Number(value))}
                />
                <Tooltip
                  isAnimationActive={false}
                  formatter={(value, name) => [
                    euroCompact.format(Number(value)),
                    payload.series.find((item) => item.id === name)?.label ?? String(name),
                  ]}
                />
                {activeIds.map((id, index) => (
                  <Bar
                    key={id}
                    dataKey={id}
                    fill={colors[index % colors.length]}
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      ) : null}

      {payload.series.length > 1 && onFiltersChange ? (
        <label className={styles.seriesPick}>
          <span>Serie</span>
          <select
            value={
              typeof tile.filters?.series_key === "string"
                ? tile.filters.series_key
                : payload.series[0]?.id ?? ""
            }
            onChange={(event) => {
              const series_key = event.target.value;
              onFiltersChange({ ...(tile.filters ?? {}), series_key });
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {payload.series.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
            {payload.datasetId === "openbdap_ssn_storico_nazionale" ? (
              <option value="">Tutte le serie</option>
            ) : null}
          </select>
        </label>
      ) : null}

      <p className={styles.meta}>
        {payload.periodLabel}
        {payload.caveat ? ` · ${payload.caveat}` : ""}
        {payload.provenance?.readAt
          ? ` · letto ${new Intl.DateTimeFormat("it-IT", {
              dateStyle: "short",
              timeStyle: "short",
            }).format(new Date(payload.provenance.readAt))}`
          : ""}
      </p>
    </div>
  );
}

function BoardTileChartRemote({
  tile,
  onFiltersChange,
  shareToken,
}: Omit<Props, "inlinePayload">) {
  const [payload, setPayload] = useState<BoardTileSeriesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tile.datasetId) return;
    let cancelled = false;
    const controller = new AbortController();
    fetch("/api/boards/tile-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        datasetId: tile.datasetId,
        filters: tile.filters,
        ...(shareToken ? { shareToken } : {}),
      }),
      signal: controller.signal,
      credentials: "same-origin",
    })
      .then(async (response) => {
        const data = (await response.json()) as {
          error?: string;
          payload?: BoardTileSeriesPayload;
        };
        if (cancelled) return;
        if (!response.ok || !data.payload) {
          setError(data.error ?? "Dati non disponibili.");
          setPayload(null);
          return;
        }
        setPayload(data.payload);
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setError("Lettura dati non riuscita.");
        setPayload(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [tile.datasetId, tile.filters, shareToken]);

  return (
    <BoardTileChartView
      tile={tile}
      onFiltersChange={onFiltersChange}
      payload={payload}
      loading={loading}
      error={error}
    />
  );
}

export function BoardTileChart({ tile, onFiltersChange, shareToken, inlinePayload }: Props) {
  const filterKey = JSON.stringify(tile.filters ?? {});
  const localKey = tile.localTable
    ? `${tile.localTable.filename}:${tile.localTable.labelColumn}:${tile.localTable.valueColumns.join(",")}:${tile.localTable.rows.length}`
    : "";

  if (inlinePayload) {
    return (
      <BoardTileChartView
        tile={tile}
        onFiltersChange={onFiltersChange}
        payload={inlinePayload}
        loading={false}
        error={null}
      />
    );
  }
  if (!tile.datasetId) {
    return (
      <BoardTileChartView
        tile={tile}
        onFiltersChange={onFiltersChange}
        payload={null}
        loading={false}
        error="Dataset mancante."
      />
    );
  }
  const remoteKey = `${tile.datasetId}|${filterKey}|${shareToken ?? ""}|${localKey}`;
  return (
    <BoardTileChartRemote
      key={remoteKey}
      tile={tile}
      onFiltersChange={onFiltersChange}
      shareToken={shareToken}
    />
  );
}

/** Tile CSV locale: proietta la tabella senza chiamare MCP. */
export function BoardLocalTileChart({ tile }: { tile: BoardTile }) {
  const inlinePayload = useMemo((): BoardTileSeriesPayload | null => {
    if (!tile.localTable) return null;
    try {
      return projectLocalTable(tile.localTable, tile.title ?? "Dati importati");
    } catch (error) {
      return {
        datasetId: "local_csv",
        title: tile.title ?? "Dati importati",
        periodLabel: "n.d.",
        unitLabel: "valore",
        caveat: error instanceof Error ? error.message : "CSV non plotabile.",
        provenance: {
          readAt: tile.localTable.importedAt,
          periodLabel: "n.d.",
          caveat: null,
          sourceIds: [],
          datasetId: "local_csv",
        },
        series: [],
        points: [],
        kpi: null,
      };
    }
  }, [tile.localTable, tile.title]);

  return <BoardTileChart tile={tile} inlinePayload={inlinePayload} />;
}

export function recommendedViewForSeries(
  view: BoardTileView,
  hasTimeSeries: boolean,
): BoardTileView {
  if (view === "kpi" || view === "table") return view;
  return hasTimeSeries ? view : "bar";
}
