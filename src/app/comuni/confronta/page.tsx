import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { SitePageLink } from "@/components/site-page-link";
import {
  COMPARE_MAX_COMPARED,
  buildComuniComparison,
  compareAddPrefix,
  compareHref,
  parseCompareParams,
  type CompareMember,
  type CompareMetric,
  type CompareMetricGroup,
  type CompareStat,
  type ComuniComparison,
} from "@/lib/comuni-compare";
import { DEFAULT_COMUNI_IPA } from "@/lib/comuni-footprint";
import { ComuniSearch } from "../comuni-search";
import chrome from "../comuni.module.css";
import styles from "./confronta.module.css";

// Combinations of Comuni and filters are unbounded: none of them is indexed or
// cached as HTML. The work per request is an in-memory filter over one index.
export const metadata: Metadata = {
  title: "Confronta i Comuni simili",
  description:
    "Metti a confronto un Comune con quelli della stessa fascia di popolazione: pagamenti, entrate, spesa per servizio e contesto, rispetto alla mediana del gruppo.",
  robots: { index: false, follow: true },
};

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const GROUP_ORDER: readonly CompareMetricGroup[] = [
  "Quanto spende",
  "Come spende",
  "Da dove arrivano i soldi",
  "Spesa per servizio",
  "Contesto",
];

const GROUP_INTRO: Readonly<Record<CompareMetricGroup, string>> = {
  "Quanto spende": "Pagamenti di cassa per abitante, per grandi voci.",
  "Come spende": "Come si dividono i pagamenti tra funzionamento e investimenti.",
  "Da dove arrivano i soldi": "Incassi di cassa per abitante e peso delle entrate raccolte dal Comune.",
  "Spesa per servizio": "Spesa storica per abitante delle funzioni fondamentali. I Comuni di Sicilia, Sardegna, Valle d'Aosta, Trentino-Alto Adige e Friuli-Venezia Giulia non sono coperti.",
  "Contesto": "Elementi che aiutano a leggere le differenze di spesa.",
};

const euroFormat = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const numberFormat = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function formatValue(metric: CompareMetric, value: number | null): string {
  if (value === null) return "n.d.";
  switch (metric.unit) {
    case "euroPerCapita": return `${euroFormat.format(value)}`;
    case "euro": return euroFormat.format(value);
    case "percent": return `${decimalFormat.format(value)}%`;
    case "perHundred": return decimalFormat.format(value);
    case "perKm2": return `${numberFormat.format(value)} ab/km²`;
  }
}

/** Distance from the group median, in the unit a reader expects. */
function formatDelta(metric: CompareMetric, value: number | null, stat: CompareStat | null): string | null {
  if (value === null || !stat) return null;
  if (metric.unit === "percent" || metric.unit === "perHundred") {
    const points = value - stat.median;
    if (Math.abs(points) < 0.05) return "in linea con la mediana";
    return `${points > 0 ? "+" : "−"}${decimalFormat.format(Math.abs(points))} punti`;
  }
  if (stat.median <= 0) return null;
  const pct = (value / stat.median - 1) * 100;
  if (Math.abs(pct) < 0.5) return "in linea con la mediana";
  return `${pct > 0 ? "+" : "−"}${numberFormat.format(Math.abs(pct))}% sulla mediana`;
}

type Marker = Readonly<{ key: string; label: string; value: number; base: boolean; name: string }>;

/**
 * One metric: the group's P10-P90 range, the P25-P75 box, the median and the
 * chosen Comuni. Positions are percentages so markers keep their size on any
 * screen. Values outside a widened range are pinned to the edge with an arrow
 * so one outlier cannot flatten the group.
 */
function PositionStrip({ metric, stat, markers }: { metric: CompareMetric; stat: CompareStat; markers: readonly Marker[] }) {
  const spread = Math.max(stat.p90 - stat.p10, Math.abs(stat.median) * 0.1, 1e-6);
  const low = Math.min(stat.p10, ...markers.map((m) => m.value));
  const high = Math.max(stat.p90, ...markers.map((m) => m.value));
  const min = Math.max(low, stat.p10 - spread * 0.8);
  const max = Math.min(high, stat.p90 + spread * 0.8);
  const span = max - min || 1;
  // 3%-97% keeps edge markers fully visible inside the track.
  const pos = (value: number) => 3 + ((Math.min(max, Math.max(min, value)) - min) / span) * 94;
  const placed: { x: number; lane: number }[] = [];
  const ordered = [...markers].sort((a, b) => Number(a.base) - Number(b.base));
  return (
    <div
      className={styles.strip}
      role="img"
      aria-label={`${metric.label}: ${markers.map((m) => `${m.name} ${formatValue(metric, m.value)}`).join(", ")}; mediana del gruppo ${formatValue(metric, stat.median)}`}
    >
      <span className={styles.stripAxis} aria-hidden="true" />
      <span className={styles.stripRange} style={{ left: `${pos(stat.p10)}%`, width: `${Math.max(0.5, pos(stat.p90) - pos(stat.p10))}%` }} aria-hidden="true" />
      <span className={styles.stripBox} style={{ left: `${pos(stat.p25)}%`, width: `${Math.max(0.5, pos(stat.p75) - pos(stat.p25))}%` }} aria-hidden="true" />
      <span className={styles.stripMedian} style={{ left: `${pos(stat.median)}%` }} aria-hidden="true" />
      {ordered.map((marker) => {
        const x = pos(marker.value);
        // Overlapping markers move to a lane above or below (about 4% apart).
        const lane = [0, -1, 1].find((candidate) => !placed.some((p) => p.lane === candidate && Math.abs(p.x - x) < 4)) ?? 0;
        placed.push({ x, lane });
        const edge = marker.value > max ? "high" : marker.value < min ? "low" : undefined;
        return (
          <span
            key={marker.key}
            className={marker.base ? styles.markerBase : styles.markerPeer}
            style={{ left: `${x}%`, top: `calc(50% + ${lane * 15}px)` }}
            data-edge={edge}
            title={`${marker.name}: ${formatValue(metric, marker.value)}`}
            aria-hidden="true"
          >
            {marker.label}
          </span>
        );
      })}
    </div>
  );
}

function Composition({ members }: { members: readonly (CompareMember & { label: string })[] }) {
  const parts = [
    { key: "correnti", label: "Spese correnti", className: styles.partCorrenti },
    { key: "investimenti", label: "Investimenti", className: styles.partInvestimenti },
    { key: "prestiti", label: "Rimborso prestiti", className: styles.partPrestiti },
    { key: "altro", label: "Altro (partite di giro, anticipazioni, da classificare)", className: styles.partAltro },
  ] as const;
  return (
    <figure className={styles.composition}>
      <ul className={styles.compositionLegend} aria-hidden="true">
        {parts.map((part) => <li key={part.key}><span className={part.className} />{part.label}</li>)}
      </ul>
      <ul className={styles.compositionRows}>
        {members.map((member) => (
          <li key={member.codiceIpa}>
            <span className={styles.compositionName}><Badge label={member.label} />{member.name}</span>
            {member.composition ? (
              <span className={styles.compositionBar} role="img" aria-label={parts.map((p) => `${p.label} ${decimalFormat.format(member.composition![p.key])}%`).join(", ")}>
                {parts.map((part) => (
                  <span key={part.key} className={part.className} style={{ width: `${member.composition![part.key]}%` }}>
                    {member.composition![part.key] >= 9 ? `${numberFormat.format(member.composition![part.key])}%` : ""}
                  </span>
                ))}
              </span>
            ) : <span className={styles.muted}>Composizione non pubblicata</span>}
          </li>
        ))}
      </ul>
      <figcaption className={styles.muted}>Pagamenti di cassa per titolo SIOPE, quota sul totale pagato nell&apos;anno.</figcaption>
    </figure>
  );
}

function EmptyState({ requested }: { requested: string | null }) {
  return (
    <section className={styles.empty}>
      <h1>Confronta il tuo Comune</h1>
      <p>
        {requested
          ? `Nessun Comune confrontabile per il Codice IPA «${requested}». Cercane un altro.`
          : "Scegli un Comune: lo mettiamo a confronto con quelli della stessa fascia di popolazione."}
      </p>
      <ComuniSearch hrefPrefix="/comuni/confronta?ente=" label="Scegli il Comune da confrontare" submitLabel="Confronta" pickOnly />
      <p><Link href={`/comuni/confronta?ente=${DEFAULT_COMUNI_IPA}`}>Prova con Mantova</Link></p>
    </section>
  );
}

/** The chosen Comune is a plain dot; compared Comuni carry their number. */
function Badge({ label }: { label: string }) {
  return label ? <b className={styles.badge}>{label}</b> : <b className={styles.badge} data-base="" aria-hidden="true" />;
}

function ComparisonView({ comparison }: { comparison: ComuniComparison }) {
  const { base, compared, group, request, stats, basePercentile } = comparison;
  const filters = request.filters;
  const codes = compared.map((m) => m.codiceIpa);
  const members = [
    { ...base, label: "" },
    ...compared.map((m, i) => ({ ...m, label: String(i + 1) })),
  ];
  const full = codes.length >= COMPARE_MAX_COMPARED;
  const toggle = (key: "region" | "altitude" | "coast") =>
    compareHref(base.codiceIpa, codes, { ...filters, [key]: !filters[key] });
  const searchPrefix = compareAddPrefix(base.codiceIpa, codes, filters);
  const filterOptions = [
    { key: "region" as const, on: filters.region, label: "Stessa regione", detail: base.region ?? "n.d." },
    { key: "altitude" as const, on: filters.altitude, label: "Stessa zona altimetrica", detail: base.altimetricZoneLabel ?? "n.d." },
    { key: "coast" as const, on: filters.coast, label: base.coastal ? "Solo comuni costieri" : "Solo comuni non costieri", detail: base.coastal ? `${base.name} è sulla costa` : `${base.name} non è sulla costa` },
  ];
  const spesa = comparison.metrics.find((m) => m.id === "spesaTotale")!;
  const spesaStat = stats.spesaTotale;
  const spesaRows = members.flatMap((m) => (m.values.spesaTotale === null ? [] : [{ ...m, value: m.values.spesaTotale }]));
  const spesaMax = Math.max(1, ...spesaRows.map((r) => r.value), spesaStat?.median ?? 0);

  return (
    <>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>
          {base.province}, {base.region}{base.population ? ` · ${numberFormat.format(base.population)} abitanti` : ""}
        </p>
        <h1>{base.name} e i comuni simili</h1>
        <p className={styles.lede}>
          Pagamenti e incassi di cassa {comparison.year} a confronto con <strong>{numberFormat.format(group.size)} comuni</strong>:{" "}
          {group.criteria.join(", ")}. La mediana è il valore centrale del gruppo e non include {base.name}.
        </p>
        <p className={styles.heroLinks}>
          <Link href={`/comuni?ente=${encodeURIComponent(base.codiceIpa)}`}>← Scheda di {base.name}</Link>
          <Link href="/comuni/confronta">Cambia comune</Link>
        </p>
      </header>

      <section className={styles.setup} aria-label="Impostazioni del confronto">
        <div className={styles.setupColumn}>
          <h2 className={styles.setupTitle}>Il gruppo</h2>
          <p className={styles.groupSize}><strong>{numberFormat.format(group.size)}</strong> comuni</p>
          <ul className={styles.filterList}>
            {filterOptions.map((option) => (
              <li key={option.key}>
                <Link href={toggle(option.key)} className={styles.filterOption} aria-pressed={option.on} data-on={option.on || undefined} scroll={false}>
                  <span className={styles.checkbox} aria-hidden="true" />
                  <span>{option.label}<small>{option.detail}</small></span>
                </Link>
              </li>
            ))}
          </ul>
          {group.size < 20 ? (
            <p className={styles.warning} role="status">
              Con {group.size} comuni mediana e intervalli sono poco stabili.
            </p>
          ) : null}
        </div>

        <div className={styles.setupColumn}>
          <h2 className={styles.setupTitle}>
            A confronto <span className={styles.muted}>{codes.length} di {COMPARE_MAX_COMPARED}</span>
          </h2>
          <ol className={styles.selected}>
            <li className={styles.selectedItem}>
              <Badge label="" />
              <span className={styles.selectedName}><strong>{base.name}</strong><small>comune scelto</small></span>
            </li>
            {compared.map((member, i) => (
              <li key={member.codiceIpa} className={styles.selectedItem}>
                <Badge label={String(i + 1)} />
                <span className={styles.selectedName}>
                  <strong>{member.name}</strong>
                  <small>
                    {member.province}
                    {member.population ? ` · ${numberFormat.format(member.population)} ab.` : ""}
                    {member.inGroup ? "" : " · fuori dal gruppo"}
                  </small>
                </span>
                <Link
                  className={styles.rowAction}
                  href={compareHref(base.codiceIpa, codes.filter((c) => c !== member.codiceIpa), filters)}
                  aria-label={`Togli ${member.name} dal confronto`}
                  scroll={false}
                >
                  Togli
                </Link>
              </li>
            ))}
          </ol>
          {comparison.missing.length || request.rejected.length || request.truncated ? (
            <p className={styles.warning} role="status">
              {comparison.missing.length ? `Codici senza dati SIOPE ${comparison.year}: ${comparison.missing.join(", ")}. ` : ""}
              {request.rejected.length ? "Alcuni codici non erano validi e sono stati ignorati. " : ""}
              {request.truncated ? `Si confrontano al massimo ${COMPARE_MAX_COMPARED} comuni.` : ""}
            </p>
          ) : null}
          {full ? null : (
            <>
              <h3 className={styles.subTitle}>Più vicini per popolazione</h3>
              <ul className={styles.suggestions}>
                {comparison.suggestions.map((s) => (
                  <li key={s.codiceIpa}>
                    <span className={styles.selectedName}>
                      <strong>{s.name}</strong>
                      <small>{s.province}{s.population ? ` · ${numberFormat.format(s.population)} ab.` : ""}</small>
                    </span>
                    <Link className={styles.rowAction} href={compareHref(base.codiceIpa, codes, filters, s.codiceIpa)} scroll={false} aria-label={`Aggiungi ${s.name} al confronto`}>
                      Aggiungi
                    </Link>
                  </li>
                ))}
              </ul>
              <div className={styles.searchRow}>
                <ComuniSearch
                  hrefPrefix={searchPrefix}
                  inputId="confronta-search"
                  label="Aggiungi un altro Comune al confronto"
                  placeholder="Cerca un altro comune"
                  submitLabel="Aggiungi"
                  pickOnly
                />
              </div>
            </>
          )}
        </div>
      </section>

      {spesaStat ? (
        <section className={styles.headline} aria-labelledby="headline-title">
          <h2 id="headline-title" className={styles.groupTitle}>Quanto pagano per abitante</h2>
          <p className={styles.muted}>{spesa.description}</p>
          <ul className={styles.barList}>
            {spesaRows.map((row) => {
              const delta = formatDelta(spesa, row.value, spesaStat);
              return (
                <li key={row.codiceIpa} data-base={row.label === "" || undefined}>
                  <span className={styles.barName}><Badge label={row.label} />{row.name}</span>
                  <span className={styles.barTrack} aria-hidden="true">
                    <span className={styles.barFill} style={{ width: `${(row.value / spesaMax) * 100}%` }} />
                    <span className={styles.barMedian} style={{ left: `${(spesaStat.median / spesaMax) * 100}%` }} />
                  </span>
                  <span className={styles.barValue}>
                    <strong>{euroFormat.format(row.value)}</strong>
                    {delta ? <small>{delta}</small> : null}
                  </span>
                </li>
              );
            })}
            <li className={styles.barMedianRow}>
              <span className={styles.barName}><b className={styles.badge} data-median="" aria-hidden="true" />Mediana del gruppo</span>
              <span className={styles.barTrack} aria-hidden="true">
                <span className={styles.barMedian} style={{ left: `${(spesaStat.median / spesaMax) * 100}%` }} />
              </span>
              <span className={styles.barValue}>
                <strong>{euroFormat.format(spesaStat.median)}</strong>
                <small>metà dei comuni tra {euroFormat.format(spesaStat.p25)} e {euroFormat.format(spesaStat.p75)}</small>
              </span>
            </li>
          </ul>
        </section>
      ) : null}

      <section className={styles.legendBlock} aria-label="Come leggere i grafici">
        <span><i className={styles.legendRange} /> 80% centrale del gruppo</span>
        <span><i className={styles.legendBox} /> metà centrale</span>
        <span><i className={styles.legendMedian} /> mediana</span>
        <span><Badge label="" /> {base.name}</span>
        {compared.map((m, i) => <span key={m.codiceIpa}><Badge label={String(i + 1)} /> {m.name}</span>)}
      </section>

      {GROUP_ORDER.map((groupName) => {
        const metrics = comparison.metrics.filter((metric) => metric.group === groupName);
        return (
          <section key={groupName} className={styles.metricGroup} aria-labelledby={`g-${groupName}`}>
            <header className={styles.metricGroupHeader}>
              <h2 id={`g-${groupName}`} className={styles.groupTitle}>{groupName}</h2>
              <p className={styles.muted}>{GROUP_INTRO[groupName]}</p>
            </header>
            {groupName === "Come spende" ? <Composition members={members} /> : null}
            <ul className={styles.metricList}>
              {metrics.map((metric) => {
                const stat = stats[metric.id];
                const own = base.values[metric.id];
                const markers: Marker[] = members.flatMap((member) => {
                  const value = member.values[metric.id];
                  return value === null ? [] : [{ key: member.codiceIpa, label: member.label, value, base: member.label === "", name: member.name }];
                });
                const delta = formatDelta(metric, own, stat);
                const percentile = basePercentile[metric.id];
                return (
                  <li key={metric.id} className={styles.metricRow}>
                    <div className={styles.metricHead}>
                      <h3>{metric.label}</h3>
                      <p className={styles.metricValue}>
                        <strong>{formatValue(metric, own)}</strong>
                        {stat ? <span>mediana {formatValue(metric, stat.median)}</span> : null}
                      </p>
                      {delta ? <p className={styles.metricDelta}>{delta}{percentile !== null ? `, supera il ${numberFormat.format(percentile)}% del gruppo` : ""}</p> : null}
                    </div>
                    {stat && markers.length ? (
                      <PositionStrip metric={metric} stat={stat} markers={markers} />
                    ) : (
                      <p className={styles.muted}>Dato non disponibile per questo gruppo.</p>
                    )}
                    <p className={styles.metricNote}>{metric.description}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <section className={styles.tableSection} aria-labelledby="tabella-titolo">
        <h2 id="tabella-titolo" className={styles.groupTitle}>Tutti i valori</h2>
        <div className={styles.tableScroll} role="region" aria-labelledby="tabella-titolo" tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Indicatore</th>
                {members.map((m) => <th key={m.codiceIpa} scope="col"><span className={styles.thName}><Badge label={m.label} />{m.name}</span></th>)}
                <th scope="col">Mediana del gruppo</th>
              </tr>
            </thead>
            <tbody>
              {comparison.metrics.map((metric) => (
                <tr key={metric.id}>
                  <th scope="row">{metric.label}<small>{metric.source}</small></th>
                  {members.map((m) => <td key={m.codiceIpa}>{formatValue(metric, m.values[metric.id])}</td>)}
                  <td>{stats[metric.id] ? formatValue(metric, stats[metric.id]!.median) : "n.d."}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.method} aria-labelledby="metodo-titolo">
        <h2 id="metodo-titolo" className={styles.groupTitle}>Come leggere il confronto</h2>
        <ul>
          <li>Non è una classifica né un giudizio: spendere di più può voler dire più servizi, più turisti, più investimenti PNRR o più partite di giro.</li>
          <li>Pagamenti e incassi sono flussi di cassa SIOPE {comparison.year}, anno completo. Non sono impegni né accertamenti di bilancio.</li>
          <li>I valori per abitante usano la popolazione dell&apos;anagrafica SIOPE; fasce, densità e contribuenti usano la popolazione ISTAT.</li>
          <li>La spesa per servizio viene da OpenCivitas, anno di riferimento 2022, ed esiste solo per i Comuni delle Regioni a statuto ordinario.</li>
          <li>Il reddito medio è il reddito complessivo dichiarato diviso per i dichiaranti, non il reddito di una famiglia.</li>
          <li>Le statistiche del gruppo richiedono almeno 5 comuni con il dato; mediana e percentili usano l&apos;interpolazione lineare.</li>
        </ul>
      </section>
    </>
  );
}

export default async function ConfrontaPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = parseCompareParams(params);
  const comparison = buildComuniComparison(request);
  const requested = typeof params.ente === "string" ? params.ente.slice(0, 40) : null;

  return (
    <main className={chrome.immersivePage} data-immersive-page="comuni-confronta">
      <a className={chrome.skipLink} href="#confronta-contenuto">Vai al contenuto</a>
      <header className={chrome.immersiveChrome}>
        <div className={chrome.brandLockup}>
          <SitePageLink className={chrome.immersiveBrand} href="/" aria-label="DoveVannoINostriSoldi, pagina iniziale">
            DVNS
          </SitePageLink>
          <span className={chrome.brandSeparator} aria-hidden="true" />
          <Link className={chrome.brandTitle} href="/comuni">Comuni</Link>
          <span className={chrome.brandSeparator} aria-hidden="true" />
          <p className={chrome.brandTitle}>Confronta</p>
        </div>
        <div className={chrome.immersiveActions}>
          <SitePageLink className={chrome.immersiveHomeLink} href="/" aria-label="Torna al sito DoveVannoINostriSoldi">
            <span aria-hidden="true">←</span>
            <span className={chrome.homeLinkLabel}>Torna al sito</span>
          </SitePageLink>
          <ThemeToggle />
        </div>
      </header>
      <div id="confronta-contenuto" className={styles.page} tabIndex={-1}>
        {comparison ? <ComparisonView comparison={comparison} /> : <EmptyState requested={requested} />}
      </div>
    </main>
  );
}
