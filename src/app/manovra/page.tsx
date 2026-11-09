import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCommittedBudgetLawMissionSeries } from "@/lib/bdap-legge-bilancio";
import {
  detailCompetenza,
  formatBillions,
  formatReadableMoney,
  formatSignedBillions,
  formatSignedPct,
  getEdition,
  getManovraSnapshot,
  manovraShareSorted,
  topDetailRows,
  type FirstYearComparison,
  type ManovraEdition,
} from "@/lib/manovra-bilancio-breve";

import {
  CompositionChart,
  EntrateSpeseCompareChart,
  ManovraShareChart,
  MissionDeltaChart,
  MissionHistoryChart,
  MissionSpendChart,
  PilPathChart,
} from "./manovra-charts";
import styles from "./manovra.module.css";

export const metadata: Metadata = {
  title: "Manovra — confronto tra edizioni | Dove vanno i nostri soldi",
  description:
    "Quanto spende e incassa lo Stato, dove vanno i soldi e come cambia la manovra. Dati ufficiali RGS, in mld €.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pickParam(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function pickEditionId(
  raw: string | string[] | undefined,
  editions: ManovraEdition[],
  latestEditionId: string,
): string {
  const value = pickParam(raw);
  if (value && editions.some((edition) => edition.id === value)) {
    return value;
  }
  return latestEditionId;
}

function pickCompareYear(
  raw: string | string[] | undefined,
  available: number[],
  fallback: number,
): number {
  const value = Number(pickParam(raw));
  if (Number.isInteger(value) && available.includes(value)) {
    return value;
  }
  return available.includes(fallback) ? fallback : (available.at(-1) ?? fallback);
}

function comparisonFor(
  comparisons: FirstYearComparison[],
  editionId: string,
): FirstYearComparison | null {
  return comparisons.find((row) => row.toEditionId === editionId) ?? null;
}

function deltaClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 1e-12) {
    return styles.flat;
  }
  return value > 0 ? styles.up : styles.down;
}

function metricForYear(
  edition: ManovraEdition,
  key: keyof ManovraEdition["summary"],
  year: number,
): number | null {
  return edition.summary[key]?.byYear[String(year)]?.competenzaEur ?? null;
}

function toMld(eur: number, digits = 1): number {
  return Number((eur / 1_000_000_000).toFixed(digits));
}

function cleanDetailLabel(label: string): string {
  return label.replace(/\d+$/u, "").trim();
}

function hrefFor(editionId: string, confronta?: number): string {
  const params = new URLSearchParams({ edizione: editionId });
  if (confronta != null) params.set("confronta", String(confronta));
  return `/manovra?${params.toString()}`;
}

export default async function ManovraPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const snapshot = getManovraSnapshot();
  const editions = snapshot.editions;
  if (editions.length === 0) {
    notFound();
  }

  const editionId = pickEditionId(
    params.edizione,
    editions,
    snapshot.latestEditionId,
  );
  const edition = getEdition(editionId);
  const comparison = comparisonFor(snapshot.firstYearComparisons, edition.id);
  const share = manovraShareSorted(edition, edition.firstYear);

  const missionSeries = getCommittedBudgetLawMissionSeries(12);
  const compareYears = missionSeries.years.filter(
    (year) => year < edition.firstYear,
  );
  const compareFromYear = pickCompareYear(
    params.confronta,
    compareYears,
    edition.firstYear - 1,
  );

  const amountByYearMission = new Map(
    missionSeries.allocations.map((row) => [
      `${row.year}::${row.mission}`,
      row.amountEur,
    ]),
  );

  const missionSpend = missionSeries.allocations
    .filter((row) => row.year === edition.firstYear)
    .sort((a, b) => b.amountEur - a.amountEur)
    .slice(0, 10)
    .map((row) => ({
      mission: row.mission,
      short: row.mission,
      amountMld: toMld(row.amountEur),
    }));

  const missionDeltas = missionSeries.missions
    .map((mission) => {
      const fromEur = amountByYearMission.get(`${compareFromYear}::${mission}`);
      const toEur = amountByYearMission.get(`${edition.firstYear}::${mission}`);
      if (fromEur == null || toEur == null) return null;
      return {
        mission,
        short: mission,
        deltaMld: toMld(toEur - fromEur, 2),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null)
    .sort((a, b) => Math.abs(b.deltaMld) - Math.abs(a.deltaMld))
    .slice(0, 12)
    .sort((a, b) => a.deltaMld - b.deltaMld);

  const yearCompare = editions.map((row) => ({
    year: row.firstYear,
    label: row.label,
    entrateMld: toMld(row.headline.entrateFinaliCompetenzaEur),
    speseMld: toMld(row.headline.speseFinaliCompetenzaEur),
    saldoMld: toMld(row.headline.saldoNettoDaFinanziareCompetenzaEur),
  }));

  const composition = edition.years.map((year) => ({
    year,
    tributarieMld: toMld(metricForYear(edition, "entrateTributarie", year) ?? 0),
    extraMld: toMld(metricForYear(edition, "entrateExtraTributarie", year) ?? 0),
    alienazioniMld: toMld(metricForYear(edition, "alienazioniAmmortamenti", year) ?? 0),
    correntiMld: toMld(metricForYear(edition, "speseCorrenti", year) ?? 0),
    interessiMld: toMld(metricForYear(edition, "interessi", year) ?? 0),
    capitaleMld: toMld(metricForYear(edition, "speseContoCapitale", year) ?? 0),
  }));

  const programmaticRows = edition.programmatic.available
    ? edition.programmatic.series
    : null;
  const pilPoints = programmaticRows
    ? [
        ...new Set(
          Object.values(programmaticRows).flatMap((series) =>
            Object.keys(series.byYear).map(Number),
          ),
        ),
      ]
        .sort((a, b) => a - b)
        .map((year) => ({
          year,
          indebitamento:
            programmaticRows.indebitamentoNettoPilPct?.byYear[String(year)] ?? null,
          primario: programmaticRows.saldoPrimarioPilPct?.byYear[String(year)] ?? null,
          debito: programmaticRows.debitoPubblicoPilPct?.byYear[String(year)] ?? null,
        }))
    : [];

  const openBdapTotals = missionSeries.years.map((year) => ({
    year,
    totalMld: toMld(
      missionSeries.allocations
        .filter((row) => row.year === year)
        .reduce((sum, row) => sum + row.amountEur, 0),
    ),
  }));

  const revenueTop = topDetailRows(edition.revenueDetail, edition.firstYear, 8).map(
    (row) => ({ ...row, label: cleanDetailLabel(row.label) }),
  );
  const spendTop = topDetailRows(edition.spendDetail, edition.firstYear, 8).map(
    (row) => ({ ...row, label: cleanDetailLabel(row.label) }),
  );
  const irpef = detailCompetenza(
    edition.revenueDetail,
    "Imposta sul reddito delle persone fisiche",
    edition.firstYear,
  );
  const iva =
    detailCompetenza(
      edition.revenueDetail,
      "Imposta sul valore aggiunto2",
      edition.firstYear,
    ) ??
    detailCompetenza(
      edition.revenueDetail,
      "Imposta sul valore aggiunto",
      edition.firstYear,
    );
  const interessi = detailCompetenza(
    edition.spendDetail,
    "Interessi passivi e altri oneri finanziari",
    edition.firstYear,
  );

  const missionHistoryTotals = edition.missionHistory.available
    ? edition.missionHistory.years.map((year) => ({
        year,
        totalMld: toMld(
          edition.missionHistory.missions.reduce(
            (sum, mission) =>
              sum + (mission.byYearMillionEur[String(year)] ?? 0) * 1_000_000,
            0,
          ),
        ),
      }))
    : [];

  const firstYear = editions[0]?.firstYear ?? 2023;
  const latestYear = editions[editions.length - 1]?.firstYear ?? 2026;

  return (
    <main className={`shell page ${styles.page}`}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span>Manovra a confronto</span>
      </nav>

      <header className={styles.hero}>
        <span className={styles.kicker}>
          Bilancio in Breve · RGS · {firstYear}→{latestYear}
        </span>
        <h1>Manovra a confronto</h1>
        <p className={styles.answer}>
          Nel {edition.firstYear} lo Stato prevede di spendere{" "}
          {formatBillions(edition.headline.speseFinaliCompetenzaEur)} e di
          incassare {formatBillions(edition.headline.entrateFinaliCompetenzaEur)}.
        </p>
        <p className={styles.lede}>
          Dati ufficiali RGS. Le tavole confrontabili partono dal 2023; la storia
          più lunga arriva da OpenBDAP e dalle missioni ripubblicate in Tav. A.3.
        </p>
        <div className={styles.heroMeta}>
          <a href={edition.xlsx.url} target="_blank" rel="noreferrer">
            Fonte XLSX {edition.label}
          </a>
          <a href={snapshot.coverage.archiveCatalogUrl} target="_blank" rel="noreferrer">
            Archivio RGS
          </a>
          <Link href="/spese/legge-di-bilancio">Simulatore Legge di Bilancio</Link>
        </div>
      </header>

      <div
        className={styles.chips}
        role="navigation"
        aria-label="Edizione della manovra"
      >
        {editions.map((row) => (
          <Link
            key={row.id}
            href={hrefFor(row.id, compareFromYear < row.firstYear ? compareFromYear : undefined)}
            className={styles.chip}
            aria-current={row.id === edition.id ? "page" : undefined}
          >
            {row.firstYear}
            <span>
              {row.id === snapshot.latestEditionId ? "ultima · " : ""}
              {row.years[0]}–{row.years[row.years.length - 1]}
            </span>
          </Link>
        ))}
      </div>

      <section className={styles.pulse} aria-label="Sintesi primo anno">
        <article className={styles.pulseCard}>
          <span>Spese {edition.firstYear}</span>
          <strong>{formatBillions(edition.headline.speseFinaliCompetenzaEur)}</strong>
          <em className={deltaClass(comparison?.speseFinali.deltaPct)}>
            {comparison
              ? `${formatSignedPct(comparison.speseFinali.deltaPct)} vs ${comparison.fromYear}`
              : "Prima edizione"}
          </em>
        </article>
        <article className={styles.pulseCard}>
          <span>Entrate {edition.firstYear}</span>
          <strong>{formatBillions(edition.headline.entrateFinaliCompetenzaEur)}</strong>
          <em className={deltaClass(comparison?.entrateFinali.deltaPct)}>
            {comparison
              ? `${formatSignedPct(comparison.entrateFinali.deltaPct)} vs ${comparison.fromYear}`
              : "Prima edizione"}
          </em>
        </article>
        <article className={styles.pulseCard}>
          <span>Saldo da finanziare</span>
          <strong>
            {formatBillions(edition.headline.saldoNettoDaFinanziareCompetenzaEur)}
          </strong>
          <em className={deltaClass(comparison?.saldoNettoDaFinanziare.deltaEur)}>
            {comparison
              ? formatSignedBillions(comparison.saldoNettoDaFinanziare.deltaEur)
              : "Base della serie"}
          </em>
        </article>
        <article className={styles.pulseCard}>
          <span>Ricorso al mercato</span>
          <strong>
            {formatBillions(edition.headline.ricorsoAlMercatoCompetenzaEur)}
          </strong>
          <em className={deltaClass(comparison?.ricorsoAlMercato.deltaEur)}>
            {comparison
              ? formatSignedBillions(comparison.ricorsoAlMercato.deltaEur)
              : "Base della serie"}
          </em>
        </article>
      </section>

      <section className={styles.section} aria-labelledby="quanto-title">
        <div className={styles.sectionHeader}>
          <h2 id="quanto-title">1. Quanto spendiamo</h2>
          <p>Primo anno di ogni manovra confrontabile.</p>
        </div>
        <EntrateSpeseCompareChart data={yearCompare} />
      </section>

      <section className={styles.section} aria-labelledby="composizione-title">
        <div className={styles.sectionHeader}>
          <h2 id="composizione-title">2. Di che sono fatte entrate e spese</h2>
          <p>Tasse, altre entrate, vendite; spese correnti e investimenti.</p>
        </div>
        <CompositionChart data={composition} />
      </section>

      <section className={styles.section} aria-labelledby="fisco-title">
        <div className={styles.sectionHeader}>
          <h2 id="fisco-title">3. Le voci più grandi</h2>
          <p>
            Top entrate e spese del {edition.firstYear}, in miliardi di euro.
          </p>
        </div>
        <div className={styles.split}>
          <div className={`${styles.panel} ${styles.tableWrap}`}>
            <h3 className={styles.panelTitle}>Entrate</h3>
            {irpef != null || iva != null ? (
              <p className={styles.note}>
                {[
                  irpef != null ? `IRPEF ${formatReadableMoney(irpef)}` : null,
                  iva != null ? `IVA ${formatReadableMoney(iva)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Voce</th>
                  <th className={styles.num}>Importo</th>
                </tr>
              </thead>
              <tbody>
                {revenueTop.map((row, index) => (
                  <tr key={`revenue-${index}-${row.label}`}>
                    <td>{row.label}</td>
                    <td className={styles.num}>{formatReadableMoney(row.amountEur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`${styles.panel} ${styles.tableWrap}`}>
            <h3 className={styles.panelTitle}>Spese</h3>
            {interessi != null ? (
              <p className={styles.note}>
                Interessi sul debito {formatReadableMoney(interessi)}.
              </p>
            ) : null}
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th className={styles.num}>Importo</th>
                </tr>
              </thead>
              <tbody>
                {spendTop.map((row, index) => (
                  <tr key={`spend-${index}-${row.label}`}>
                    <td>{row.label}</td>
                    <td className={styles.num}>{formatReadableMoney(row.amountEur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="dove-title">
        <div className={styles.sectionHeader}>
          <h2 id="dove-title">4. Dove vanno i soldi</h2>
          <p>
            Missione = capitolo di spesa dello Stato (scuola, sanità, debito…).
          </p>
        </div>
        <div className={styles.chartStack}>
          <MissionSpendChart data={missionSpend} year={edition.firstYear} />
          {compareYears.length > 0 ? (
            <div className={styles.compareBar} role="navigation" aria-label="Anno di confronto">
              <span>Confronta {edition.firstYear} con</span>
              <div className={styles.compareChips}>
                {compareYears.map((year) => (
                  <Link
                    key={year}
                    href={hrefFor(edition.id, year)}
                    className={styles.compareChip}
                    aria-current={year === compareFromYear ? "page" : undefined}
                  >
                    {year}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
          <MissionDeltaChart
            data={missionDeltas}
            fromYear={compareFromYear}
            toYear={edition.firstYear}
          />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="storia-title">
        <div className={styles.sectionHeader}>
          <h2 id="storia-title">5. La serie lunga</h2>
          <p>Totale dei capitoli di spesa nel tempo, anche prima del 2023.</p>
        </div>
        <div className={styles.chartStack}>
          <MissionHistoryChart
            data={openBdapTotals}
            title="Totale missioni 2017→oggi"
            lead="Somma di tutti i capitoli di spesa previsti dalla legge di bilancio."
            ariaLabel="Totale stanziamenti OpenBDAP per anno"
          />
          {missionHistoryTotals.length > 0 ? (
            <MissionHistoryChart
              data={missionHistoryTotals}
              title={`Missioni storiche RGS (${edition.label})`}
              lead="Somma ripubblicata da RGS in Tav. A.3, anche per anni prima del 2023."
              ariaLabel="Totale missioni RGS Tavola A.3 per anno"
            />
          ) : null}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="manovra-title">
        <div className={styles.sectionHeader}>
          <h2 id="manovra-title">6. Cosa sposta la manovra</h2>
          <p>Effetto della manovra {edition.firstYear} sugli aggregati RGS.</p>
        </div>
        <ManovraShareChart
          year={edition.firstYear}
          data={share.map((row) => ({
            aggregate: row.aggregate,
            short: row.aggregate,
            manovraPct: Number(row.manovraPct.toFixed(2)),
          }))}
        />
      </section>

      <section className={styles.section} aria-labelledby="finanza-title">
        <div className={styles.sectionHeader}>
          <h2 id="finanza-title">7. Come si chiude</h2>
          <p>Triennio in mld € e percorso % del PIL (saldi a sinistra, debito a destra).</p>
        </div>
        <div className={`${styles.panel} ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Anno</th>
                <th className={styles.num}>Entrate</th>
                <th className={styles.num}>Spese</th>
                <th className={styles.num}>Saldo</th>
                <th className={styles.num}>Ricorso al mercato</th>
              </tr>
            </thead>
            <tbody>
              {edition.years.map((year) => (
                <tr key={year}>
                  <td>
                    {year}
                    {year === edition.firstYear ? " · primo" : ""}
                  </td>
                  <td className={styles.num}>
                    {formatReadableMoney(
                      metricForYear(edition, "entrateFinali", year) ?? 0,
                    )}
                  </td>
                  <td className={styles.num}>
                    {formatReadableMoney(
                      metricForYear(edition, "speseFinali", year) ?? 0,
                    )}
                  </td>
                  <td className={styles.num}>
                    {formatReadableMoney(
                      metricForYear(edition, "saldoNettoDaFinanziare", year) ?? 0,
                    )}
                  </td>
                  <td className={styles.num}>
                    {formatReadableMoney(
                      metricForYear(edition, "ricorsoAlMercato", year) ?? 0,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pilPoints.length > 0 ? <PilPathChart data={pilPoints} /> : null}
      </section>

      <aside className={styles.sources}>
        <strong>Fonti</strong>
        <span>
          {snapshot.holder} ·{" "}
          <a href={edition.xlsx.url} target="_blank" rel="noreferrer">
            {edition.xlsx.fileName}
          </a>
          {" · "}
          <a href={missionSeries.dataset.apiUrl} target="_blank" rel="noreferrer">
            OpenBDAP
          </a>
        </span>
        <span>{snapshot.coverage.note}</span>
      </aside>
    </main>
  );
}
