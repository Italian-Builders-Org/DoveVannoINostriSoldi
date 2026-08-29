"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ItalyRegionsMap, type MapMetric } from "@/components/italy-regions-map";
import { compactEuro, exactEuro } from "@/lib/format";
import type { SiopeProvincePoint, SiopeRegionPoint } from "@/lib/siope-snapshot";
import styles from "@/app/home.module.css";

export function HomeMapPanel({
  className,
  regions,
  provinces,
  period,
  year,
  nationalTotal,
  nationalPerCapita,
  municipalitiesWithoutRegion,
  paymentsWithoutRegion,
}: Readonly<{
  className?: string;
  regions: SiopeRegionPoint[];
  provinces: SiopeProvincePoint[];
  period: string;
  year: number;
  nationalTotal: number;
  nationalPerCapita: number | null;
  municipalitiesWithoutRegion: number;
  paymentsWithoutRegion: number;
}>) {
  const [metric, setMetric] = useState<MapMetric>("per-capita");
  const rankedRegions = [...regions]
    .filter((region) => metric === "total" || region.perCapita !== null)
    .sort((left, right) => {
      const leftValue = metric === "total" ? left.value : left.perCapita ?? 0;
      const rightValue = metric === "total" ? right.value : right.perCapita ?? 0;
      return rightValue - leftValue;
    })
    .slice(0, 10);
  const formatValue = (region: SiopeRegionPoint) => metric === "total"
    ? compactEuro(region.value)
    : region.perCapita === null ? "n.d." : exactEuro(region.perCapita);
  const nationalValue = metric === "total"
    ? compactEuro(nationalTotal)
    : nationalPerCapita === null ? "n.d." : exactEuro(nationalPerCapita);

  return (
    <section className={`${styles.panel} ${styles.mapPanel} ${className ?? ""}`}>
      <div className={styles.panelHead}>
        <h2>Mappa dei pagamenti comunali</h2>
        <div className={styles.segmented} role="group" aria-label="Metrica della mappa">
          <button type="button" aria-pressed={metric === "total"} onClick={() => setMetric("total")}>Pagamenti</button>
          <button type="button" aria-pressed={metric === "per-capita"} onClick={() => setMetric("per-capita")}>Pro capite</button>
        </div>
      </div>
      <ItalyRegionsMap
        compact
        metric={metric}
        provinces={provinces}
        regions={regions}
        period={period}
        aside={
          <div className={styles.mapRanking}>
            <div className={styles.mapRankingHead}>
              <span>Classifica regioni</span>
              <span>{metric === "total" ? "Pagamenti" : "Pagamenti pro capite"}</span>
            </div>
            {rankedRegions.map((region) => <div key={region.region}><strong>{region.region}</strong><span>{formatValue(region)}</span></div>)}
            <div className={styles.mapRankingTotal}><strong>Italia</strong><span>{nationalValue}</span></div>
            <small className={styles.mapScope}>SIOPE · {period}. Il totale Italia include {municipalitiesWithoutRegion} Comuni non regionalizzati ({compactEuro(paymentsWithoutRegion)}).</small>
            <Link href={`/territori?anno=${year}`}>Vedi tutte le regioni <HugeiconsIcon icon={ArrowRight01Icon} size={12} aria-hidden="true" /></Link>
          </div>
        }
      />
    </section>
  );
}
