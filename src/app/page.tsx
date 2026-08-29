import { Fragment, type CSSProperties } from "react";
import Link from "next/link";
import {
  Alert02Icon, ArrowDown01Icon, ArrowRight01Icon,
  Building03Icon, CheckmarkCircle02Icon, Database01Icon, FilterHorizontalIcon,
  Location01Icon, Money03Icon, UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { HomeMapPanel } from "@/components/home-map-panel";
import { HomeTrendPanel } from "@/components/home-trend-panel";
import { RegionCrest } from "@/components/region-crest";
import { SourceIdentityMark } from "@/components/source-identity-mark";
import { anacCigSnapshot } from "@/lib/anac-cig-snapshot";
import { auditReviewedAt, auditSignals, getHomeAnomalySignals, procurementReducedCompetition2025, type AuditSignal } from "@/lib/audit-data";
import { compactEuro, exactEuro, integer, longDate, percent } from "@/lib/format";
import { getSiopeProvincePoints } from "@/lib/siope-municipality-detail";
import { HOME_SPENDING_BUCKETS } from "@/lib/siope-titles";
import { availableSiopeYears, getSiopeMunicipalSnapshot, regionsByPerCapita } from "@/lib/siope-snapshot";
import { istatCodeOfRegion } from "@/lib/italy-regions";
import { publicSources, sourceCounts } from "@/lib/sources";
import styles from "./home.module.css";

const CHART_COLORS = ["#315edb", "#68a1ef", "#32b979", "#f2ad3d", "#536579"];
const HOME_SOURCE_MARKS = [
  { slug: "siope", mark: "rgs", label: "Comuni" },
  { slug: "ipa", mark: "ipa", label: "Anagrafe PA" },
  { slug: "anac", mark: "anac", label: "Contratti" },
  { slug: "istat", mark: "istat", label: "Confini" },
] as const;

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
  const provinces = getSiopeProvincePoints(year);
  const monthLabel = siope.latestMonthLabel.toLocaleLowerCase("it-IT");
  const period = `da gennaio a ${monthLabel} ${year}`;
  const periodLabel = siope.distribution.period.completeness === "partial"
    ? `${year} · gen-${monthLabel.slice(0, 3)}`
    : String(year);
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
  const rankedRegions = regionsByPerCapita(siope);
  const benchmarkRegions = [...rankedRegions.slice(0, 5), ...rankedRegions.slice(-2)];
  const regionMax = Math.max(...benchmarkRegions.map((region) => region.perCapita ?? 0), 1);
  const anomalySignals = getHomeAnomalySignals();
  const extraSignalIds = new Set(["tax-expenditures", "off-budget-debt"]);
  const anomalyRows = [...anomalySignals, ...auditSignals.filter((signal) => extraSignalIds.has(signal.id))].slice(0, 5);
  const homeSources = HOME_SOURCE_MARKS.map((presentation) => {
    const source = publicSources.find((candidate) => candidate.slug === presentation.slug);
    if (!source) throw new Error(`Fonte homepage non registrata: ${presentation.slug}`);
    return { ...presentation, source };
  });

  return (
    <main className={`shell ${styles.dashboard}`} data-dashboard-home>
      <header className={styles.dashboardHeader}>
        <div className={styles.dashboardTitle}>
          <span className={styles.dashboardTitleIcon} aria-hidden="true">
            <svg viewBox="0 0 48 36"><path d="M1 18h5l4-10 6 21 7-26 7 31 6-18h5l6-7" /></svg>
          </span>
          <div><h1>Panoramica Italia</h1><p>Pagamenti comunali e altri dati pubblici, con perimetri separati.</p><small>SIOPE comunale aggiornato al {longDate(siope.source.siopeMovementsLastModified)}</small></div>
        </div>
        <div className={styles.dashboardFilters}>
          <details className={styles.filterBox}>
            <summary><span>Periodo SIOPE</span><strong>{periodLabel}</strong><HugeiconsIcon icon={ArrowDown01Icon} size={13} aria-hidden="true" /></summary>
            <div>{availableSiopeYears.map((option) => <Link key={option} href={`/?anno=${option}`}>{option}</Link>)}</div>
          </details>
          <div className={styles.filterBoxStatic}><span>Livello geografico</span><strong>Nazionale</strong></div>
          <Link className={styles.advancedFilter} href="/cerca"><HugeiconsIcon icon={FilterHorizontalIcon} size={15} strokeWidth={1.7} aria-hidden="true" />Filtri avanzati</Link>
        </div>
      </header>

      <section className={styles.summaryGrid} aria-label="Indicatori principali">
        <article><span><HugeiconsIcon icon={Money03Icon} size={15} aria-hidden="true" /> Pagamenti comunali</span><strong>{compactEuro(siope.totalPaid)}</strong><small className={styles.positive}>flussi di cassa SIOPE {year}</small><Sparkline values={siope.monthly.map((point) => point.flow)} tone="green" /><Link className={styles.summaryCardTarget} href={`/spese?anno=${year}`} aria-label={`Esplora i pagamenti comunali SIOPE ${year}`}><HugeiconsIcon icon={ArrowRight01Icon} size={13} aria-hidden="true" /></Link></article>
        <article><span><HugeiconsIcon icon={Building03Icon} size={15} aria-hidden="true" /> Comuni con pagamenti</span><strong>{integer(siope.coverage.withMovements)}</strong><small>su {integer(siope.coverage.activeSiopeMunicipalities)} Comuni SIOPE validi</small><Link className={styles.summaryCardTarget} href={`/territori?anno=${year}`} aria-label={`Esplora i Comuni con pagamenti nel ${year}`}><HugeiconsIcon icon={ArrowRight01Icon} size={13} aria-hidden="true" /></Link></article>
        <article><span><HugeiconsIcon icon={Database01Icon} size={15} aria-hidden="true" /> Contratti 2025</span><strong>{integer(anacCigSnapshot.population.records)}</strong><small>CIG unici nello snapshot annuale ANAC</small><Link className={styles.summaryCardTarget} href="/appalti" aria-label="Esplora i contratti pubblici ANAC 2025"><HugeiconsIcon icon={ArrowRight01Icon} size={13} aria-hidden="true" /></Link></article>
        <article><span><HugeiconsIcon icon={UserMultiple02Icon} size={15} aria-hidden="true" /> Popolazione associata</span><strong>{integer(siope.populationCovered)}</strong><small>denominatore dei Comuni inclusi nello snapshot</small><Link className={styles.summaryCardTarget} href={`/territori?anno=${year}`} aria-label={`Esplora la copertura territoriale SIOPE ${year}`}><HugeiconsIcon icon={ArrowRight01Icon} size={13} aria-hidden="true" /></Link></article>
        <article className={styles.warningMetric}><span><HugeiconsIcon icon={Alert02Icon} size={15} aria-hidden="true" /> Confronto ridotto · ANAC 2025</span><strong>{procurementReducedCompetition2025.totalBillion.toLocaleString("it-IT", { maximumFractionDigits: 1 })} mld €</strong><small>{procurementReducedCompetition2025.byValue.toLocaleString("it-IT")}% del valore delle procedure da 40.000 € in su; non spreco provato</small><Link className={styles.summaryCardTarget} href="/controlli" aria-label="Approfondisci il confronto ridotto ANAC 2025"><HugeiconsIcon icon={ArrowRight01Icon} size={13} aria-hidden="true" /></Link></article>
        <article className={styles.warningMetric}><span><HugeiconsIcon icon={Alert02Icon} size={15} aria-hidden="true" /> Segnali mostrati</span><strong>{integer(anomalyRows.length)}</strong><small>fenomeni documentati con perimetri distinti</small><Link className={styles.summaryCardTarget} href="/controlli" aria-label="Esplora tutti i segnali da approfondire"><HugeiconsIcon icon={ArrowRight01Icon} size={13} aria-hidden="true" /></Link></article>
      </section>

      <HomeMapPanel
        className={styles.mapStage}
        regions={siope.regions}
        provinces={provinces}
        period={period}
        year={year}
        nationalTotal={siope.totalPaid}
        nationalPerCapita={siope.nationalPerCapita}
        municipalitiesWithoutRegion={siope.coverage.withoutRegion}
        paymentsWithoutRegion={siope.coverage.paymentsWithoutRegion}
      />

      <section className={`${styles.panel} ${styles.anomalyPanel}`}>
        <div className={styles.panelHead}><h2>Segnali pubblici da approfondire</h2><Link href="/controlli">Vedi tutti <HugeiconsIcon icon={ArrowRight01Icon} size={12} aria-hidden="true" /></Link></div>
        <div className={styles.anomalyGallery}>
          {anomalyRows.map((signal) => (
            <a key={signal.id} href={signal.source.url} target="_blank" rel="noreferrer" className={styles.anomalyRow} title={signal.source.title}>
              <i className={styles.anomalyMarker}><HugeiconsIcon icon={Alert02Icon} size={13} aria-hidden="true" /></i>
              <span><b>{signal.area.toLocaleUpperCase("it-IT")}</b><small>{signal.label}</small></span>
              <span><strong>{signal.source.institution}</strong><small>{signal.referenceDate} · {signal.coverage}</small></span>
              <em>{anomalyValue(signal)}</em><mark>VERIFICA</mark><HugeiconsIcon icon={ArrowRight01Icon} size={12} aria-hidden="true" />
            </a>
          ))}
        </div>
        <p className={styles.anomalyCaveat}>Report ufficiali rivisti manualmente il {longDate(`${auditReviewedAt}T00:00:00Z`)}. Segnale da verificare, non prova; perimetri diversi e non additivi.</p>
        {anomalySignals.length < 3 ? <Link className={styles.fallbackLink} href="/controlli">Esplora gli altri controlli</Link> : null}
      </section>

      <section className={`${styles.panel} ${styles.categoryPanel}`}>
        <div className={styles.panelHead}><div><h2>Pagamenti per titolo contabile</h2><small className={styles.panelContext}>SIOPE · {period}; include le partite di giro</small></div></div>
        <div className={styles.donutLayout}>
          <div className={styles.donut} style={{ "--donut": `conic-gradient(${donutGradient})` } as CSSProperties}><span><strong>{compactEuro(siope.totalPaid)}</strong><small>Totale</small></span></div>
          <ul>{buckets.map((bucket, index) => <li key={bucket.name}><i style={{ background: CHART_COLORS[index] }} /><span>{bucket.name}</span><b>{percent((bucket.value / bucketTotal) * 100)}</b><small>{compactEuro(bucket.value)}</small></li>)}</ul>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.benchmarkPanel}`}>
        <div className={styles.panelHead}><h2>Regioni per pagamenti pro capite</h2></div>
        <p className={styles.metricSelect}>Valore per abitante coperto · SIOPE {year}</p>
        <ul className={styles.benchmarkList}>{benchmarkRegions.map((region, index) => { const value = region.perCapita ?? 0; const below = siope.nationalPerCapita !== null && value < siope.nationalPerCapita; const regionCode = istatCodeOfRegion(region.region); return <Fragment key={region.region}>{index === 5 && siope.nationalPerCapita !== null ? <li className={styles.benchmarkAverage}><i aria-hidden="true" /><span>Media Italia</span><i /><strong>{exactEuro(siope.nationalPerCapita)}</strong></li> : null}<li><RegionCrest className={styles.benchmarkCrest} regionCode={regionCode} regionName={region.region} decorative /><span title={region.region}>{region.region}</span><i><b data-below={below || undefined} style={{ width: `${Math.max(4, (value / regionMax) * 100)}%` }} /></i><strong>{exactEuro(value)}</strong></li></Fragment>; })}</ul>
        <Link className={styles.panelLink} href="/confronti">Esplora tutti i confronti <HugeiconsIcon icon={ArrowRight01Icon} size={8} aria-hidden="true" /></Link>
      </section>

      <HomeTrendPanel monthly={siope.monthly} period={period} year={year} />

      <section className={`${styles.panel} ${styles.sourcesPanel}`}>
        <div><h2>Da dove provengono i dati</h2><p>Le quattro fonti usate in questa panoramica; tutte le altre sono nel registro.</p></div>
        <div className={styles.sourceMarks}>
          {homeSources.map(({ slug, mark, label, source }) => <Link key={slug} href={`/fonti#${slug}`} title={`${source.name} · ${source.owner}`}><SourceIdentityMark source={mark} className={styles.sourceMarkSvg} /><span>{label.split("\n").map((line) => <span key={line}>{line}</span>)}</span></Link>)}
          <Link href="/fonti"><b>+{sourceCounts.total - homeSources.length}</b><span>altre fonti<br/>registrate</span></Link>
        </div>
      </section>
      <section className={`${styles.panel} ${styles.reportPanel}`}><HugeiconsIcon icon={Location01Icon} size={19} aria-hidden="true" /><div><h2>Segnala un’anomalia</h2><p>Aiutaci a migliorare la trasparenza.</p></div><Link href="/supporto">Fai una segnalazione <HugeiconsIcon icon={ArrowRight01Icon} size={12} aria-hidden="true" /></Link></section>
      <section className={`${styles.panel} ${styles.commitmentPanel}`}><h2>Il nostro impegno</h2><ul><li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} aria-hidden="true" /> Dati pubblici e aperti</li><li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} aria-hidden="true" /> Nessun interesse politico</li><li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} aria-hidden="true" /> Fonti e limiti visibili</li><li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} aria-hidden="true" /> Tecnologia al servizio dei cittadini</li></ul></section>
    </main>
  );
}
