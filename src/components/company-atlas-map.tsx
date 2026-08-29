"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ITALY_REGIONS_VIEWBOX, italyRegionGeometry } from "@/data/generated/italy-regions";
import { integer } from "@/lib/format";
import styles from "./company-atlas-map.module.css";

type RegionPoint = Readonly<{ code: string; name: string; value: number | null }>;

type CompanyAtlasMapProps = Readonly<{
  regions: RegionPoint[];
  selectedRegion: string;
  metricUnit: string;
  valueFormat?: "thousand-euro" | "integer" | "decimal" | "euro-per-employee";
  mapTitle?: string;
  mapDescription?: string;
}>;

function quantile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0;
}

export function CompanyAtlasMap({
  regions,
  selectedRegion,
  metricUnit,
  valueFormat,
  mapTitle = "Valori regionali dell'Atlante Imprese Italia",
  mapDescription = "Mappa regionale degli aggregati dell'Atlante Imprese Italia. Usa Tab per entrare nella mappa, i tasti freccia per muoverti e Invio per fissare una regione.",
}: CompanyAtlasMapProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [focusedCode, setFocusedCode] = useState<string | null>(selectedRegion === "all" ? null : selectedRegion);
  const pathRefs = useRef(new Map<string, SVGPathElement>());
  const byCode = useMemo(() => new Map(regions.map((region) => [region.code, region])), [regions]);
  const values = useMemo(
    () => regions.map((region) => region.value).filter((value): value is number => value !== null).sort((a, b) => a - b),
    [regions],
  );
  const thresholds = useMemo(() => [0.2, 0.4, 0.6, 0.8].map((fraction) => quantile(values, fraction)), [values]);

  function selectRegion(code: string | null) {
    const params = new URLSearchParams(window.location.search);
    if (code) params.set("region", code);
    else params.delete("region");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    setFocusedCode(code);
    setHoveredCode(null);
  }

  function level(value: number | null): number | null {
    if (value === null) return null;
    const index = thresholds.findIndex((threshold) => value <= threshold);
    return index < 0 ? thresholds.length : index;
  }

  function moveFocus(event: React.KeyboardEvent<SVGPathElement>, code: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectRegion(code);
      return;
    }
    const codes: string[] = italyRegionGeometry.map((geometry) => geometry.code);
    const index = codes.indexOf(code);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % codes.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + codes.length) % codes.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = codes.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextCode = codes[nextIndex]!;
    setFocusedCode(nextCode);
    setHoveredCode(nextCode);
    pathRefs.current.get(nextCode)?.focus();
  }

  const activeFocusCode = selectedRegion === "all" ? focusedCode : selectedRegion;
  const displayedCode = hoveredCode ?? activeFocusCode;
  const displayedRegion = displayedCode ? byCode.get(displayedCode) : null;
  const outlinedCodes = [selectedRegion === "all" ? null : selectedRegion, hoveredCode].filter(
    (code, index, all): code is string => Boolean(code) && all.indexOf(code) === index,
  );

  function displayValue(value: number): string {
    if (valueFormat === "thousand-euro") {
      const absolute = Math.abs(value);
      if (absolute >= 1_000_000) {
        return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1, useGrouping: "always" })} mld €`;
      }
      if (absolute >= 1_000) {
        return `${(value / 1_000).toLocaleString("it-IT", { maximumFractionDigits: 1, useGrouping: "always" })} mln €`;
      }
      return `${integer(value)} mila €`;
    }
    if (valueFormat === "euro-per-employee") {
      const absolute = Math.abs(value);
      if (absolute >= 1_000_000) {
        return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 2, useGrouping: "always" })} mln € / addetto`;
      }
      if (absolute >= 1_000) {
        return `${(value / 1_000).toLocaleString("it-IT", { maximumFractionDigits: 1, useGrouping: "always" })} mila € / addetto`;
      }
      return `${integer(Math.round(value))} € / addetto`;
    }
    if (valueFormat === "decimal") {
      return value.toLocaleString("it-IT", { maximumFractionDigits: 1 });
    }
    return integer(Math.round(value));
  }

  return (
    <div className={styles.layout}>
      <div className={styles.mapColumn}>
        <svg
          className={styles.map}
          viewBox={ITALY_REGIONS_VIEWBOX}
          role="group"
          data-region-map="true"
          aria-labelledby="company-map-title company-map-description"
        >
          <title id="company-map-title">{mapTitle}</title>
          <desc id="company-map-description">{mapDescription}</desc>
          {italyRegionGeometry.map((geometry) => {
            const region = byCode.get(geometry.code);
            const colorLevel = level(region?.value ?? null);
            const selected = selectedRegion === geometry.code;
            const focusable = (activeFocusCode ?? italyRegionGeometry[0]?.code) === geometry.code;
            const hovered = hoveredCode === geometry.code;
            return (
              <path
                ref={(node) => {
                  if (node) pathRefs.current.set(geometry.code, node);
                  else pathRefs.current.delete(geometry.code);
                }}
                key={geometry.code}
                d={geometry.path}
                className={`${styles.region} ${colorLevel === null ? styles.noData : styles[`level${colorLevel}`]}`}
                tabIndex={focusable ? 0 : -1}
                role="button"
                aria-pressed={selected}
                aria-label={`${region?.name ?? geometry.name}: ${region?.value === null || region?.value === undefined ? "dato non disponibile" : `${displayValue(region.value)} (unità: ${metricUnit})`}`}
                data-hovered={hovered ? "true" : undefined}
                data-selected={selected ? "true" : undefined}
                onPointerEnter={() => setHoveredCode(geometry.code)}
                onPointerLeave={() => setHoveredCode((current) => current === geometry.code ? null : current)}
                onFocus={() => {
                  setFocusedCode(geometry.code);
                  setHoveredCode(geometry.code);
                }}
                onBlur={() => setHoveredCode((current) => current === geometry.code ? null : current)}
                onClick={() => selectRegion(geometry.code)}
                onKeyDown={(event) => moveFocus(event, geometry.code)}
              />
            );
          })}
          {outlinedCodes.map((code) => {
            const geometry = italyRegionGeometry.find((item) => item.code === code);
            if (!geometry) return null;
            return <path key={`outline-${code}`} d={geometry.path} className={styles.outline} aria-hidden="true" focusable="false" pointerEvents="none" />;
          })}
        </svg>

        <label className={styles.mobileSelector}>
          <span>Scegli una regione</span>
          <select value={selectedRegion === "all" ? "" : selectedRegion} onChange={(event) => selectRegion(event.target.value || null)}>
            <option value="">Tutta Italia</option>
            {[...regions].sort((a, b) => a.name.localeCompare(b.name, "it")).map((region) => (
              <option value={region.code} key={region.code}>{region.name}</option>
            ))}
          </select>
        </label>

        <div className={styles.legend} aria-label="Scala relativa dei valori regionali">
          <span>Meno</span>
          {[0, 1, 2, 3, 4].map((index) => <i key={index} className={styles[`level${index}`]} aria-hidden="true" />)}
          <span>Più</span>
        </div>

        <div className={styles.detail} aria-live="polite">
          <strong>{displayedRegion?.name ?? "Seleziona una regione"}</strong>
          <span>{displayedRegion?.value === null || displayedRegion?.value === undefined ? "n.d." : displayValue(displayedRegion.value)}</span>
          <small>{displayedRegion ? metricUnit : "valore regionale"}</small>
        </div>
      </div>
    </div>
  );
}
