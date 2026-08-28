import type { CSSProperties } from "react";
import Link from "next/link";
import {
  Alert02Icon, ArrowDown01Icon, ArrowRight01Icon,
  Building03Icon, CheckmarkCircle02Icon, Database01Icon, FilterHorizontalIcon,
  Location01Icon, Money03Icon, UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ItalyRegionsMap } from "@/components/italy-regions-map";
import { anacCigSnapshot } from "@/lib/anac-cig-snapshot";
import { auditSignals, getHomeAnomalySignals, procurementReducedCompetition2025, type AuditSignal } from "@/lib/audit-data";
import { compactEuro, exactEuro, integer, longDate, percent } from "@/lib/format";
import { HOME_SPENDING_BUCKETS } from "@/lib/siope-titles";
import { availableSiopeYears, getSiopeMunicipalSnapshot, regionsByPerCapita } from "@/lib/siope-snapshot";
import styles from "./home.module.css";

const CHART_COLORS = ["#315edb", "#68a1ef", "#32b979", "#f2ad3d", "#536579"];

function selectedYear(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] ?? "" : value ?? "", 10);
  return availableSiopeYears.includes(parsed) ? parsed : availableSiopeYears[0];
}

function anomalyValue(signal: AuditSignal): string {
  const base = signal.unit === "percent" ? percent(signal.value)
    : signal.unit === "billion-euro" ? `${signal.value.toLocaleString("it-IT", { maximumFractionDigits: 1 })} mld €`
      : signal.unit === "million-euro" ? `${signal.value.toLocaleString("it-IT", { maximumFractionDigits: 1 })} mln €`
        : integer(signal.value);
  if (signal.valueQualifier === "over") return `oltre ${base}`;
  if (signal.valueQualifier === "about") return `circa ${base}`;
  return base;
}

function points(values: readonly number[], width = 104, height = 34): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 3 - ((value - min) / span) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function Sparkline({ values, tone = "blue" }: { values: readonly number[]; tone?: "blue" | "green" | "red" }) {
  return <svg className={styles.sparkline} viewBox="0 0 104 34" aria-hidden="true"><polyline className={styles[tone]} points={points(values)} /></svg>;
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ anno?: string | string[] }> }) {
  const year = selectedYear((await searchParams).anno);
  const siope = getSiopeMunicipalSnapshot(year);
  const monthLabel = siope.latestMonthLabel.toLocaleLowerCase("it-IT");
  const valueByCode = new Map(siope.titles.map((title) => [title.code, title.value]));
  const buckets = HOME_SPENDING_BUCKETS.map((bucket) => ({
    name: bucket.shortName,
    value: bucket.codes.reduce((sum, code) => sum + (valueByCode.get(code) ?? 0), 0),
  })).sort((left, right) => right.value - left.value);
  const bucketTotal = buckets.reduce((sum, bucket) => sum + bucket.value, 0) || 1;
  const donutGradient = buckets.map((bucket, index) => {
    const start = buckets.slice(0, index).reduce((sum, item) => sum + item.value, 0) / bucketTotal * 100;
    const end = start + (bucket.value / bucketTotal) * 100;
    return `${CHART_COLORS[index]} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  }).join(", ");
  const rankedRegions = regionsByPerCapita(siope).slice(0, 10);
  const benchmarkRegions = rankedRegions.slice(0, 7);
  const regionMax = Math.max(...benchmarkRegions.map((region) => region.perCapita ?? 0), 1);
  const anomalySignals = getHomeAnomalySignals();
  const extraSignalIds = new Set(["tax-expenditures", "off-budget-debt"]);
  const anomalyRows = [...anomalySignals, ...auditSignals.filter((signal) => extraSignalIds.has(signal.id))].slice(0, 5);
  const trendPoints = points(siope.monthly.map((point) => point.cumulative), 414, 106).split(" ").map((point) => {
    const [x, y] = point.split(",").map(Number);
    return `${x + 36},${y + 15}`;
  });

  return (
    <main className={`shell ${styles.dashboard}`} data-dashboard-home>
      <header className={styles.dashboardHeader}>
        <div className={styles.dashboardTitle}>
          <span className={styles.dashboardTitleIcon} aria-hidden="true">
            <svg viewBox="0 0 48 36"><path d="M1 18h5l4-10 6 21 7-26 7 31 6-18h5l6-7" /></svg>
          </span>
          <div><h1>Panoramica Italia</h1><p>Scopri come vengono spesi i soldi pubblici.</p><small>Dati comunali aggiornati al {longDate(siope.source.siopeMovementsLastModified)}</small></div>
        </div>
        <div className={styles.dashboardFilters}>
          <details className={styles.filterBox}>
            <summary><span>Periodo</span><strong>{year} {year === availableSiopeYears[0] ? "(YTD)" : ""}</strong><HugeiconsIcon icon={ArrowDown01Icon} size={13} /></summary>
            <div>{availableSiopeYears.map((option) => <Link key={option} href={`/?anno=${option}`}>{option}</Link>)}</div>
          </details>
          <div className={styles.filterBoxStatic}><span>Livello geografico</span><strong>Nazionale</strong><HugeiconsIcon icon={ArrowDown01Icon} size={13} /></div>
          <Link className={styles.advancedFilter} href="/cerca"><HugeiconsIcon icon={FilterHorizontalIcon} size={15} strokeWidth={1.7} />Filtri avanzati</Link>
        </div>
      </header>

      <section className={styles.summaryGrid} aria-label="Indicatori principali">
        <article><span><HugeiconsIcon icon={Money03Icon} size={15} /> Spesa pubblica totale</span><strong>{compactEuro(siope.totalPaid)}</strong><small className={styles.positive}>↑ pagamenti comunali {year}</small><Sparkline values={siope.monthly.map((point) => point.flow)} tone="green" /></article>
        <article><span><HugeiconsIcon icon={Building03Icon} size={15} /> Enti coinvolti</span><strong>{integer(siope.coverage.withMovements)}</strong><small>{integer(siope.coverage.activeSiopeMunicipalities)} Comuni validi</small></article>
        <article><span><HugeiconsIcon icon={Database01Icon} size={15} /> Contratti 2025</span><strong>{integer(anacCigSnapshot.population.records)}</strong><small>CIG unici · ANAC</small><Sparkline values={[34, 38, 43, 48, 52, 61, 68, 74]} /></article>
        <article><span><HugeiconsIcon icon={UserMultiple02Icon} size={15} /> Persone coperte</span><strong>{integer(siope.populationCovered)}</strong><small>residenti nei Comuni inclusi</small><Sparkline values={[58, 59, 59, 60, 61, 61, 62]} tone="green" /></article>
        <article className={styles.warningMetric}><span><HugeiconsIcon icon={Alert02Icon} size={15} /> Spesa da verificare</span><strong>{procurementReducedCompetition2025.totalBillion.toLocaleString("it-IT", { maximumFractionDigits: 1 })} mld €</strong><small>concorrenza ridotta, non spreco provato</small><Sparkline values={[38, 41, 44, 43, 50, 54, 60]} tone="red" /></article>
        <article className={styles.warningMetric}><span><HugeiconsIcon icon={Alert02Icon} size={15} /> Segnali pubblici</span><strong>{integer(anomalyRows.length)}</strong><small>fenomeni distinti da approfondire</small></article>
      </section>

      <section className={`${styles.panel} ${styles.mapPanel}`}>
        <div className={styles.panelHead}><h2>Mappa della spesa pubblica</h2><div className={styles.segmented}><b>Totale spesa</b><span>Pro capite</span></div></div>
        <ItalyRegionsMap compact regions={siope.regions} period={`da gennaio a ${monthLabel} ${year}`} aside={
          <div className={styles.mapRanking}>
            <div className={styles.mapRankingHead}><span>Regione</span><span>Spesa pro capite</span></div>
            {rankedRegions.map((region) => <div key={region.region}><strong>{region.region}</strong><span>{region.perCapita === null ? "n.d." : exactEuro(region.perCapita)}</span></div>)}
            <div className={styles.mapRankingTotal}><strong>Italia</strong><span>{siope.nationalPerCapita === null ? "n.d." : exactEuro(siope.nationalPerCapita)}</span></div>
            <Link href={`/territori?anno=${year}`}>Vedi tutte le regioni <HugeiconsIcon icon={ArrowRight01Icon} size={12} /></Link>
          </div>
        } />
      </section>

      <section className={`${styles.panel} ${styles.anomalyPanel}`}>
        <div className={styles.panelHead}><h2>Anomalie e potenziali sprechi</h2><Link href="/controlli">Vedi tutte <HugeiconsIcon icon={ArrowRight01Icon} size={12} /></Link></div>
        <div className={styles.anomalyGallery}>
          {anomalyRows.map((signal, index) => (
            <a key={signal.id} href={signal.source.url} target="_blank" rel="noreferrer" className={styles.anomalyRow}>
              <i className={styles.anomalyMarker} data-level={index < 2 ? "high" : "medium"}><HugeiconsIcon icon={Alert02Icon} size={13} /></i>
              <span><b>{signal.area.toLocaleUpperCase("it-IT")}</b><small>{signal.label}</small></span>
              <span><strong>{signal.source.institution}</strong><small>{signal.coverage}</small></span>
              <em>{anomalyValue(signal)}</em><mark data-level={index < 2 ? "high" : "medium"}>{index < 2 ? "ALTO" : "MEDIO"}</mark><HugeiconsIcon icon={ArrowRight01Icon} size={12} />
            </a>
          ))}
        </div>
        <p className={styles.anomalyCaveat}>Segnale da verificare, non prova. Le righe hanno perimetri diversi e non sono additive.</p>
        {anomalySignals.length < 3 ? <Link className={styles.fallbackLink} href="/controlli">Esplora gli altri controlli</Link> : null}
      </section>

      <section className={`${styles.panel} ${styles.categoryPanel}`}>
        <div className={styles.panelHead}><h2>Spesa per categoria</h2></div>
        <div className={styles.donutLayout}>
          <div className={styles.donut} style={{ "--donut": `conic-gradient(${donutGradient})` } as CSSProperties}><span><strong>{compactEuro(siope.totalPaid)}</strong><small>Totale</small></span></div>
          <ul>{buckets.map((bucket, index) => <li key={bucket.name}><i style={{ background: CHART_COLORS[index] }} /><span>{bucket.name}</span><b>{percent((bucket.value / bucketTotal) * 100)}</b><small>{compactEuro(bucket.value)}</small></li>)}</ul>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.benchmarkPanel}`}>
        <div className={styles.panelHead}><h2>Confronti e benchmark</h2></div>
        <div className={styles.metricSelect}>Spesa pro capite <HugeiconsIcon icon={ArrowDown01Icon} size={12} /></div>
        <ul className={styles.benchmarkList}>{benchmarkRegions.map((region) => { const value = region.perCapita ?? 0; const below = siope.nationalPerCapita !== null && value < siope.nationalPerCapita; return <li key={region.region}><span>{region.region}</span><i><b data-below={below || undefined} style={{ width: `${Math.max(4, (value / regionMax) * 100)}%` }} /></i><strong>{exactEuro(value)}</strong></li>; })}</ul>
        <Link className={styles.panelLink} href="/confronti">Vai al confronto completo <HugeiconsIcon icon={ArrowRight01Icon} size={12} /></Link>
      </section>

      <section className={`${styles.panel} ${styles.trendPanel}`}>
        <div className={styles.panelHead}><h2>Trend spesa pubblica</h2><div className={styles.segmented}><b>Assoluta</b><span>Pro capite</span></div></div>
        <svg className={styles.trendChart} viewBox="0 0 460 150" role="img" aria-label={`Andamento cumulato dei pagamenti comunali nel ${year}`}>
          <defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c8ced9" stopOpacity=".55"/><stop offset="1" stopColor="#f7f8fa" stopOpacity=".1"/></linearGradient></defs>
          <path className={styles.trendGrid} d="M36 20H450 M36 72H450 M36 124H450" /><polygon className={styles.trendFill} points={`36,124 ${trendPoints.join(" ")} 450,124`} /><polyline className={styles.trendLine} points={trendPoints.join(" ")} />
          {siope.monthly.map((point, index) => { const [x, y] = trendPoints[index].split(",").map(Number); return <g key={point.month}><circle cx={x} cy={y} r="3"/><text x={x} y="143">{point.label.slice(0, 3)}</text></g>; })}
          <text x="4" y="24">{compactEuro(siope.totalPaid)}</text><text x="16" y="76">50%</text><text x="25" y="128">0</text>
        </svg>
      </section>

      <section className={`${styles.panel} ${styles.sourcesPanel}`}>
        <div><h2>Da dove provengono i dati</h2><p>Fonti pubbliche integrate e aggiornate con perimetro dichiarato</p></div>
        <div className={styles.sourceMarks}><Link href="/fonti"><b>RGS</b><span>SIOPE<br/>Pagamenti comunali</span></Link><Link href="/fonti"><b>IPA</b><span>Indice delle<br/>PA</span></Link><Link href="/fonti"><b>ANAC</b><span>Contratti<br/>pubblici</span></Link><Link href="/fonti"><b>OC</b><span>OpenCoesione<br/>Progetti</span></Link><Link href="/fonti">+ altre<br/>fonti</Link></div>
      </section>
      <section className={`${styles.panel} ${styles.reportPanel}`}><HugeiconsIcon icon={Location01Icon} size={19} /><div><h2>Segnala un’anomalia</h2><p>Aiutaci a migliorare la trasparenza.</p></div><Link href="/supporto">Fai una segnalazione <HugeiconsIcon icon={ArrowRight01Icon} size={12} /></Link></section>
      <section className={`${styles.panel} ${styles.commitmentPanel}`}><h2>Il nostro impegno</h2><ul><li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} /> Dati pubblici e aperti</li><li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} /> Nessun interesse politico</li><li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} /> Fonti e limiti visibili</li><li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} /> Tecnologia al servizio dei cittadini</li></ul></section>
    </main>
  );
}
