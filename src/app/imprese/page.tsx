import type { Metadata } from "next";
import Link from "next/link";
import { CompanyAtlasFilters } from "@/components/company-atlas-filters";
import { CompanyAtlasMap } from "@/components/company-atlas-map";
import { RegionCrest, RegionCrestAttribution } from "@/components/region-crest";
import { integer, longDate, percent } from "@/lib/format";
import {
  COMPANY_ATLAS_ALL,
  companyAtlasBandOptions,
  companyAtlasMetricOptions,
  companyAtlasPeriodOptions,
  companyAtlasRegionOptions,
  companyAtlasSectorOptions,
  getCompanyAtlasView,
} from "@/lib/company-atlas";
import {
  getIstatTurnoverView,
  istatTurnoverRegionOptions,
  istatTurnoverSectorOptions,
} from "@/lib/istat-turnover";
import styles from "./imprese.module.css";

export const metadata: Metadata = {
  title: "Atlante Imprese Italia",
  description:
    "Mappa e dati aggregati del tessuto produttivo italiano: imprese attive, addetti, localizzazioni, fasce di valore della produzione e fatturato ISTAT.",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function compactCount(value: number | null): string {
  if (value === null) return "n.d.";
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mln`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mila`;
  }
  return integer(value);
}

function compactTurnover(value: number | null): string {
  if (value === null) return "n.d.";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1, useGrouping: "always" })} mld €`;
  }
  if (absolute >= 1_000) {
    return `${(value / 1_000).toLocaleString("it-IT", { maximumFractionDigits: 1, useGrouping: "always" })} mln €`;
  }
  return `${integer(value)} mila €`;
}

function RegionalIdentity({
  region,
}: {
  region: Readonly<{ code: string; name: string }>;
}) {
  return (
    <span className={styles.regionIdentity}>
      <RegionCrest regionCode={region.code} regionName={region.name} decorative />
      <span>{region.name}</span>
    </span>
  );
}

function atlasHref(view: { metric: string; period: string; region: string; sector: string; band?: string }, region?: string) {
  const params = new URLSearchParams({ metric: view.metric, period: view.period });
  if (view.sector && view.sector !== COMPANY_ATLAS_ALL && view.sector !== "ALL") params.set("sector", view.sector);
  if (view.band && view.band !== COMPANY_ATLAS_ALL) params.set("band", view.band);
  if (region && region !== COMPANY_ATLAS_ALL && region !== "ALL") params.set("region", region);
  return `/imprese?${params.toString()}`;
}

function searchMatch(query: string | undefined) {
  const normalized = query?.trim().toLocaleLowerCase("it-IT");
  if (!normalized) return {};
  const region = companyAtlasRegionOptions().find((item) =>
    item.name.toLocaleLowerCase("it-IT").includes(normalized),
  );
  if (region) return { region: region.code };
  const sector = companyAtlasSectorOptions().find((item) =>
    `${item.code} ${item.label}`.toLocaleLowerCase("it-IT").includes(normalized),
  );
  return sector ? { sector: sector.code } : {};
}

export default async function ImpresePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const requestedMetric = first(params.metric);
  const isTurnover = requestedMetric === "turnover";
  const match = searchMatch(first(params.q));

  const allMetricOptions = [
    ...companyAtlasMetricOptions().map((item) => ({ id: item.id, label: item.label })),
    { id: "turnover", label: "Fatturato aggregato (ISTAT)" },
  ];

  if (isTurnover) {
    const turnoverView = getIstatTurnoverView({
      region: first(params.region) ?? match.region,
      sector: first(params.sector),
    });
    const source = turnoverView.sources[0];
    const topSectors = turnoverView.sectorBreakdown;
    const sectorTotal = turnoverView.sectorBreakdown.reduce((sum, item) => sum + (item.value ?? 0), 0);
    const topRegions = turnoverView.ranking.slice(0, 10);
    const visibleRegion = turnoverView.selectedRegion;
    const filterOptions = {
      metrics: allMetricOptions,
      periods: [{ id: "2024", label: "Anno 2024" }],
      regions: istatTurnoverRegionOptions().map((item) => ({ id: item.code, label: item.name })),
      sectors: istatTurnoverSectorOptions()
        .filter((item) => item.code !== "ALL")
        .map((item) => ({ id: item.code, label: item.label })),
      bands: [],
    };

    return (
      <main className={`shell ${styles.dashboard}`}>
        <header className={styles.hero}>
          <div>
            <span className={styles.kicker}>Modulo Imprese · Stima anticipata ISTAT 2024</span>
            <h1>Atlante Imprese Italia</h1>
            <p>
              Dove si concentra il fatturato del sistema produttivo? Esplora i dati aggregati del
              Registro Frame Territoriale Anticipato 2024 per regione e macro-settore economico.
            </p>
          </div>
          <div className={styles.heroMeta}>
            <span className="tag tag-accent">Solo dati aggregati</span>
            <span>ATECO 2007 agg. 2022 · 20 regioni</span>
            <Link href="/metodologia">Come leggiamo i numeri →</Link>
          </div>
        </header>

        <CompanyAtlasFilters
          filters={{
            metric: "turnover",
            period: turnoverView.period,
            region: turnoverView.region === "ALL" ? "all" : turnoverView.region,
            sector: turnoverView.sector === "ALL" ? "all" : turnoverView.sector,
            band: "all",
          }}
          {...filterOptions}
          showBand={false}
          sectorLabel="Macro-settore (ATECO 2007 agg. 2022)"
        />

        <div className={styles.dashboardGrid}>
          <div className={styles.column}>
            <section className="panel" aria-labelledby="scope-title">
              <div className={styles.panelHead}>
                <h2 id="scope-title" className="panel-title">Perimetro selezionato</h2>
                <span className="status status-attiva">Snapshot ISTAT</span>
              </div>
              <strong className={styles.headline}>{compactTurnover(turnoverView.nationalValue)}</strong>
              <p className={styles.headlineNote}>{turnoverView.metricUnit} · {turnoverView.periodLabel}</p>

              <dl className={styles.factRows}>
                <div><dt>Metrica</dt><dd>{turnoverView.metricLabel}</dd></div>
                <div><dt>Territorio</dt><dd>{visibleRegion?.name ?? "Tutta Italia"}</dd></div>
                <div><dt>Settore</dt><dd>{turnoverView.selectedSectorLabel}</dd></div>
                <div><dt>Classificazione</dt><dd>ATECO 2007 agg. 2022</dd></div>
              </dl>

              <p className={styles.definition}>{turnoverView.metricDescription}</p>
              <Link className="btn btn-block" href="/metodologia">Metodo e definizioni</Link>
            </section>

            <section className="panel" aria-labelledby="sector-title">
              <div className={styles.panelHead}>
                <h2 id="sector-title" className="panel-title">Distribuzione per macro-settore</h2>
                <span className={styles.headNote}>Industria e Servizi</span>
              </div>
              <ul className={styles.sectorList}>
                {topSectors.map((sector) => {
                  const share = sector.value !== null && sectorTotal > 0 ? (sector.value / sectorTotal) * 100 : 0;
                  return (
                    <li key={sector.code}>
                      <div className={`${styles.sectorLabel} ${styles.sectorLabelPlain}`}>
                        <span>{sector.label}</span>
                        <strong>{compactTurnover(sector.value)}</strong>
                      </div>
                      <i aria-hidden="true"><b style={{ width: `${share}%` }} /></i>
                      <small>{sector.value === null ? "n.d." : percent(share)} del perimetro osservato</small>
                    </li>
                  );
                })}
              </ul>
              <p className={styles.note}>
                I dati ISTAT coprono le unità locali con almeno un dipendente. Industria e Servizi
                rappresentano la ripartizione macro-settoriale ufficiale (Tavola 2).
              </p>
            </section>
          </div>

          <div className={styles.column}>
            <section className={`panel ${styles.mapPanel}`} aria-labelledby="map-panel-title">
              <div className={styles.panelHead}>
                <h2 id="map-panel-title" className="panel-title">{turnoverView.metricLabel} per regione</h2>
                <span className={styles.headNote}>{turnoverView.periodLabel}</span>
              </div>
              <CompanyAtlasMap
                regions={turnoverView.regionPoints}
                selectedRegion={turnoverView.region === "ALL" ? "all" : turnoverView.region}
                metricUnit={turnoverView.metricUnit}
                valueFormat="thousand-euro"
              />
              <p className={styles.attribution}>
                Confini amministrativi a fini statistici: <a href="https://www.istat.it/storage/cartografia/confini_amministrativi/generalizzati/2026/Limiti01012026_g.zip" target="_blank" rel="noreferrer">ISTAT, 1 gennaio 2026</a>, CC BY 4.0. La scala della mappa è relativa al perimetro visualizzato.
              </p>
            </section>

            <section className="panel" aria-labelledby="ranking-title">
              <div className={styles.panelHead}>
                <h2 id="ranking-title" className="panel-title">Prime 10 regioni</h2>
                <span className={styles.headNote}>valori compatti in euro</span>
              </div>
              <div className="table-scroll" role="region" aria-label="Prime 10 regioni ordinate per valore assoluto" tabIndex={0}>
                <table className="table">
                  <thead><tr><th scope="col">#</th><th scope="col">Regione</th><th scope="col" className="num">Fatturato</th></tr></thead>
                  <tbody>
                    {topRegions.map((region, index) => (
                      <tr key={region.code}>
                        <td className="num">{index + 1}</td>
                        <th scope="row"><Link href={atlasHref(turnoverView, region.code)}><RegionalIdentity region={region} /></Link></th>
                        <td className="num">{compactTurnover(region.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles.note}>Sono mostrate le prime 10 regioni per fatturato aggregato. Clicca una regione per fissarla nella mappa e nel perimetro.</p>
            </section>
          </div>

          <div className={styles.column}>
            <section className="panel" aria-labelledby="detail-title">
              <div className={styles.panelHead}>
                <h2 id="detail-title" className="panel-title">Lettura rapida</h2>
                <span className="tag tag-neutral">{turnoverView.matchedObservationCount} territorio</span>
              </div>
              <div className={styles.detailCard}>
                <span className={styles.detailLabel}>Regione in evidenza</span>
                {visibleRegion ? (
                  <div className={styles.detailRegion}>
                    <RegionCrest regionCode={visibleRegion.code} regionName={visibleRegion.name} decorative />
                    <strong>{visibleRegion.name}</strong>
                  </div>
                ) : <strong>Italia</strong>}
                <b>{compactTurnover(visibleRegion?.value ?? turnoverView.nationalValue)}</b>
                <small>{turnoverView.metricUnit} · {turnoverView.selectedSectorLabel}</small>
              </div>
              <dl className={styles.factRows}>
                <div><dt>Ultimo aggiornamento fonte</dt><dd>{longDate(source.updatedAt)}</dd></div>
                <div><dt>Controllo snapshot</dt><dd>{longDate(source.observedAt)}</dd></div>
                <div><dt>Cadenza prevista</dt><dd>{source.cadence}</dd></div>
                <div><dt>Copertura</dt><dd>{source.coverage}</dd></div>
              </dl>
            </section>

            <section className="panel" aria-labelledby="source-title">
              <div className={styles.panelHead}>
                <h2 id="source-title" className="panel-title">Fonte del numero</h2>
                <span className="status status-attiva">CC BY 4.0</span>
              </div>
              <h3 className={styles.sourceTitle}>{source.label}</h3>
              <p className={styles.sourcePublisher}>{source.publisher}</p>
              <p className={styles.sourceCaveat}>{source.caveat}</p>
              <a className="btn btn-block" href={source.url} target="_blank" rel="noreferrer">Scarica le tavole ufficiali ISTAT ↗</a>
            </section>

            <aside className={`notice ${styles.boundaryNotice}`}>
              <strong>Confine del modulo</strong>
              <p>
                Qui non troverai nomi di aziende, identificativi, codici fiscali, partite IVA o fatturato
                esatto di singole imprese. Il dato è un aggregato regionale e per macro-settore (Industria/Servizi)
                proveniente dalla stima anticipata ISTAT (Registro Frame Territoriale Anticipato 2024, ATECO 2007 agg. 2022),
                riferito alle unità locali con almeno un dipendente.
              </p>
              <Link href="/fonti">Vedi tutte le fonti e le licenze →</Link>
            </aside>
          </div>
        </div>
        <RegionCrestAttribution />
      </main>
    );
  }

  const view = getCompanyAtlasView({
    metric: first(params.metric),
    period: first(params.period),
    region: first(params.region) ?? match.region,
    sector: first(params.sector) ?? match.sector,
    band: first(params.band),
  });
  const source = view.sources[0]!;
  const topSectors = view.sectorBreakdown.slice(0, 7);
  const sectorTotal = view.sectorBreakdown.reduce((sum, item) => sum + (item.value ?? 0), 0);
  const topRegions = view.ranking.slice(0, 10);
  const visibleRegion = view.selectedRegion;
  const filterOptions = {
    metrics: allMetricOptions,
    periods: companyAtlasPeriodOptions(view.metric),
    regions: companyAtlasRegionOptions().map((item) => ({ id: item.code, label: item.name })),
    sectors: companyAtlasSectorOptions().map((item) => ({ id: item.code, label: item.label })),
    bands: companyAtlasBandOptions().map((item) => ({ id: item.code, label: item.label })),
  };

  return (
    <main className={`shell ${styles.dashboard}`}>
      <header className={styles.hero}>
        <div>
          <span className={styles.kicker}>Modulo Imprese · Atlante Economico Italiano</span>
          <h1>Atlante Imprese Italia</h1>
          <p>
            Dove si concentra il tessuto produttivo italiano? Esplora imprese attive, addetti,
            localizzazioni e fasce di valore della produzione, regione per regione.
          </p>
        </div>
        <div className={styles.heroMeta}>
          <span className="tag tag-accent">Solo dati aggregati</span>
          <span>ATECO 2025 · 20 regioni</span>
          <Link href="/metodologia">Come leggiamo i numeri →</Link>
        </div>
      </header>

      <CompanyAtlasFilters
        filters={{ metric: view.metric, period: view.period, region: view.region, sector: view.sector, band: view.band }}
        {...filterOptions}
        showBand={view.metric === "production_value_band_count"}
        sectorLabel="Settore ATECO 2025"
      />

      <div className={styles.dashboardGrid}>
        <div className={styles.column}>
          <section className="panel" aria-labelledby="scope-title">
            <div className={styles.panelHead}>
              <h2 id="scope-title" className="panel-title">Perimetro selezionato</h2>
              <span className="status status-attiva">Snapshot</span>
            </div>
            <strong className={styles.headline}>{compactCount(view.nationalValue)}</strong>
            <p className={styles.headlineNote}>{view.metricUnit} · {view.periodLabel}</p>

            <dl className={styles.factRows}>
              <div><dt>Metrica</dt><dd>{view.metricLabel}</dd></div>
              <div><dt>Territorio</dt><dd>{visibleRegion?.name ?? "Tutta Italia"}</dd></div>
              <div><dt>Settore</dt><dd>{view.selectedSectorLabel}</dd></div>
              {view.metric === "production_value_band_count" ? (
                <div><dt>Fascia</dt><dd>{view.selectedBandLabel}</dd></div>
              ) : null}
            </dl>

            <p className={styles.definition}>{view.metricDescription}</p>
            <Link className="btn btn-block" href="/metodologia">Metodo e definizioni</Link>
          </section>

          <section className="panel" aria-labelledby="sector-title">
            <div className={styles.panelHead}>
              <h2 id="sector-title" className="panel-title">Dove si concentra l&apos;attività</h2>
              <span className={styles.headNote}>prime 7 sezioni</span>
            </div>
            <ul className={styles.sectorList}>
              {topSectors.map((sector) => {
                const share = sector.value !== null && sectorTotal > 0 ? (sector.value / sectorTotal) * 100 : 0;
                return (
                  <li key={sector.code}>
                    <div className={styles.sectorLabel}><b>{sector.code}</b><span>{sector.label}</span><strong>{compactCount(sector.value)}</strong></div>
                    <i aria-hidden="true"><b style={{ width: `${share}%` }} /></i>
                    <small>{sector.value === null ? "n.d." : percent(share)} del perimetro settoriale</small>
                  </li>
                );
              })}
            </ul>
            <p className={styles.note}>La sezione ATECO descrive l&apos;attività economica, non una singola impresa.</p>
          </section>
        </div>

        <div className={styles.column}>
          <section className={`panel ${styles.mapPanel}`} aria-labelledby="map-panel-title">
            <div className={styles.panelHead}>
              <h2 id="map-panel-title" className="panel-title">{view.metricLabel} per regione</h2>
              <span className={styles.headNote}>{view.periodLabel}</span>
            </div>
            <CompanyAtlasMap
              regions={view.regionPoints}
              selectedRegion={view.region}
              metricUnit={view.metricUnit}
            />
            <p className={styles.attribution}>
              Confini amministrativi a fini statistici: <a href="https://www.istat.it/storage/cartografia/confini_amministrativi/generalizzati/2026/Limiti01012026_g.zip" target="_blank" rel="noreferrer">ISTAT, 1 gennaio 2026</a>, CC BY 4.0. La scala della mappa è relativa al perimetro visualizzato.
            </p>
          </section>

          <section className="panel" aria-labelledby="ranking-title">
            <div className={styles.panelHead}>
              <h2 id="ranking-title" className="panel-title">Prime 10 regioni</h2>
              <span className={styles.headNote}>valore assoluto</span>
            </div>
            <div className="table-scroll" role="region" aria-label="Prime 10 regioni ordinate per valore assoluto" tabIndex={0}>
              <table className="table">
                <thead><tr><th scope="col">#</th><th scope="col">Regione</th><th scope="col" className="num">Valore</th></tr></thead>
                <tbody>
                  {topRegions.map((region, index) => (
                    <tr key={region.code}>
                      <td className="num">{index + 1}</td>
                      <th scope="row"><Link href={atlasHref(view, region.code)}><RegionalIdentity region={region} /></Link></th>
                      <td className="num">{compactCount(region.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.note}>Sono mostrate le prime 10 regioni per valore assoluto. Clicca una regione per fissarla nella mappa e nel perimetro.</p>
          </section>
        </div>

        <div className={styles.column}>
          <section className="panel" aria-labelledby="detail-title">
            <div className={styles.panelHead}>
              <h2 id="detail-title" className="panel-title">Lettura rapida</h2>
              <span className="tag tag-neutral">{view.matchedObservationCount} righe</span>
            </div>
            <div className={styles.detailCard}>
              <span className={styles.detailLabel}>Regione in evidenza</span>
              {visibleRegion ? (
                <div className={styles.detailRegion}>
                  <RegionCrest regionCode={visibleRegion.code} regionName={visibleRegion.name} decorative />
                  <strong>{visibleRegion.name}</strong>
                </div>
              ) : <strong>Italia</strong>}
              <b>{compactCount(visibleRegion?.value ?? view.nationalValue)}</b>
              <small>{view.metricUnit} · {view.selectedSectorLabel}</small>
            </div>
            <dl className={styles.factRows}>
              <div><dt>Ultimo aggiornamento fonte</dt><dd>{longDate(source.updatedAt)}</dd></div>
              <div><dt>Controllo snapshot</dt><dd>{longDate(source.observedAt)}</dd></div>
              <div><dt>Cadenza prevista</dt><dd>{source.cadence}</dd></div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="source-title">
            <div className={styles.panelHead}>
              <h2 id="source-title" className="panel-title">Fonte del numero</h2>
              <span className="status status-attiva">CC BY 4.0</span>
            </div>
            <h3 className={styles.sourceTitle}>{source.label}</h3>
            <p className={styles.sourcePublisher}>{source.publisher}</p>
            <p className={styles.sourceCaveat}>{source.caveat}</p>
            <a className="btn btn-block" href={source.url} target="_blank" rel="noreferrer">Apri il dataset ufficiale ↗</a>
          </section>

          <aside className={`notice ${styles.boundaryNotice}`}>
            <strong>Confine del modulo</strong>
            <p>
              Qui non troverai nomi di aziende, identificativi o fatturato esatto. Il dato business
              più vicino è una fascia di valore della produzione derivata dai bilanci, quindi resta
              una distribuzione aggregata e non una classifica di società.
            </p>
            <Link href="/fonti">Vedi tutte le fonti e le licenze →</Link>
          </aside>
        </div>
      </div>
        <RegionCrestAttribution />
      </main>
  );
}
