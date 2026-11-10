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
  manovraShareSorted,
  rgsMissionDeltas,
  rgsMissionsForYear,
  topDetailRows,
  type FirstYearComparison,
  type ManovraEdition,
  type ManovraSnapshot,
} from "@/lib/manovra-bilancio-breve";
import {
  loadManovraSnapshot,
  ManovraSnapshotUnavailableError,
} from "@/lib/manovra-bilancio-breve-store";

import {
  CompositionChart,
  EntrateSpeseCompareChart,
  ManovraShareChart,
  MissionDeltaChart,
  MissionHistoryChart,
  MissionSpendChart,
  PilPathChart,
  RgsMissionSpendChart,
} from "./manovra-charts";
import styles from "./manovra.module.css";

export const metadata: Metadata = {
  title: "Manovra: confronto tra edizioni",
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

function pickFocusYear(
  raw: string | string[] | undefined,
  years: number[],
  fallback: number,
): number {
  const value = Number(pickParam(raw));
  if (Number.isInteger(value) && years.includes(value)) {
    return value;
  }
  return years.includes(fallback) ? fallback : (years[0] ?? fallback);
}

function hrefForEdition(
  editionId: string,
  options: { confronta?: number; anno?: number } = {},
): string {
  const params = new URLSearchParams({ edizione: editionId });
  if (options.confronta != null) params.set("confronta", String(options.confronta));
  if (options.anno != null) params.set("anno", String(options.anno));
  return `/manovra?${params.toString()}`;
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


export default async function ManovraPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  let snapshot: ManovraSnapshot;
  try {
    snapshot = await loadManovraSnapshot();
  } catch (error) {
    if (error instanceof ManovraSnapshotUnavailableError) {
      return (
        <main className={`shell page ${styles.page}`}>
          <nav className={styles.breadcrumb} aria-label="Percorso">
            <Link href="/">Home</Link>
            <span aria-hidden="true">/</span>
            <span>Manovra a confronto</span>
          </nav>
          <header className={styles.hero}>
            <h1>Manovra a confronto</h1>
            <p className={styles.lede}>
              Dati temporaneamente non disponibili. In produzione leggiamo lo
              snapshot verificato collegato al receipt pubblicato; in assenza di
              database o file locale il confronto RGS non può essere caricato.
            </p>
            <div className={styles.heroMeta}>
              <Link href="/spese/legge-di-bilancio">Simulatore Legge di Bilancio</Link>
              <Link href="/stato">Spese dello Stato</Link>
            </div>
          </header>
        </main>
      );
    }
    throw error;
  }
  const editions = snapshot.editions;
  if (editions.length === 0) {
    notFound();
  }

  const editionId = pickEditionId(
    params.edizione,
    editions,
    snapshot.latestEditionId,
  );
  const edition = getEdition(snapshot, editionId);
  const comparison = comparisonFor(snapshot.firstYearComparisons, edition.id);
  const focusYear = pickFocusYear(params.anno, edition.years, edition.firstYear);
  const share = manovraShareSorted(edition, focusYear);

  const missionSeries = getCommittedBudgetLawMissionSeries(12);
  const compareYears = missionSeries.years.filter((year) => year < focusYear);
  const compareFromYear = pickCompareYear(
    params.confronta,
    compareYears,
    focusYear - 1,
  );

  const amountByYearMission = new Map(
    missionSeries.allocations.map((row) => [
      `${row.year}::${row.mission}`,
      row.amountEur,
    ]),
  );

  // OpenBDAP covers committed budget-law years; future LB years may be absent.
  const openBdapFocusYear = missionSeries.years.includes(focusYear)
    ? focusYear
    : edition.firstYear;
  const openBdapCompareYears = missionSeries.years.filter(
    (year) => year < openBdapFocusYear,
  );
  const openBdapCompareFromYear = pickCompareYear(
    params.confronta,
    openBdapCompareYears,
    openBdapFocusYear - 1,
  );

  const missionSpend = missionSeries.allocations
    .filter((row) => row.year === openBdapFocusYear)
    .sort((a, b) => b.amountEur - a.amountEur)
    .slice(0, 10)
    .map((row) => ({
      mission: row.mission,
      short: row.mission,
      amountMld: toMld(row.amountEur),
    }));

  const missionDeltas = missionSeries.missions
    .map((mission) => {
      const fromEur = amountByYearMission.get(
        `${openBdapCompareFromYear}::${mission}`,
      );
      const toEur = amountByYearMission.get(`${openBdapFocusYear}::${mission}`);
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

  const revenueTop = topDetailRows(edition.revenueDetail, focusYear, 8).map(
    (row) => ({ ...row, label: cleanDetailLabel(row.label) }),
  );
  const spendTop = topDetailRows(edition.spendDetail, focusYear, 8).map(
    (row) => ({ ...row, label: cleanDetailLabel(row.label) }),
  );
  const irpef = detailCompetenza(
    edition.revenueDetail,
    "Imposta sul reddito delle persone fisiche",
    focusYear,
  );
  const iva =
    detailCompetenza(
      edition.revenueDetail,
      "Imposta sul valore aggiunto2",
      focusYear,
    ) ??
    detailCompetenza(
      edition.revenueDetail,
      "Imposta sul valore aggiunto",
      focusYear,
    );
  const interessi = detailCompetenza(
    edition.spendDetail,
    "Interessi passivi e altri oneri finanziari",
    focusYear,
  );
  const focusSpese = metricForYear(edition, "speseFinali", focusYear);
  const focusEntrate = metricForYear(edition, "entrateFinali", focusYear);
  const focusSaldo = metricForYear(edition, "saldoNettoDaFinanziare", focusYear);
  const focusRicorso = metricForYear(edition, "ricorsoAlMercato", focusYear);
  const rgsMissions = rgsMissionsForYear(edition, focusYear, 16).map((row) => ({
    mission: row.mission,
    short: row.short,
    amountMld: toMld(row.amountEur),
  }));
  const priorTrienniumYear = edition.years.includes(focusYear - 1)
    ? focusYear - 1
    : null;
  const rgsDeltas =
    priorTrienniumYear == null
      ? []
      : rgsMissionDeltas(edition, priorTrienniumYear, focusYear, 12).map((row) => ({
          mission: row.mission,
          short: row.short,
          deltaMld: toMld(row.deltaEur, 2),
        }));
  const triennioLine = edition.years
    .map((year) => {
      const spese = metricForYear(edition, "speseFinali", year);
      return spese == null ? null : `${year}: ${formatBillions(spese)}`;
    })
    .filter((row): row is string => Boolean(row))
    .join(" · ");

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
          Nel {focusYear} lo Stato prevede di spendere{" "}
          {formatBillions(focusSpese ?? edition.headline.speseFinaliCompetenzaEur)}{" "}
          e di incassare{" "}
          {formatBillions(
            focusEntrate ?? edition.headline.entrateFinaliCompetenzaEur,
          )}
          .
        </p>
        <p className={styles.lede}>
          Qui confronti le leggi di bilancio pubblicate dalla Ragioneria (RGS),
          in miliardi di euro. Ogni legge copre tre anni: prima scegli quale
          legge leggere, poi quale anno di quella legge. Spese nel triennio{" "}
          {edition.years[0]}-{edition.years[edition.years.length - 1]}:{" "}
          {triennioLine}.
        </p>
        <p className={styles.note}>
          La manovra discussa a fine ottobre (disegno di legge di bilancio{" "}
          2027-2029) è già sul sito RGS come «Bilancio finanziario», ma non
          esiste ancora il «Bilancio in Breve» 2027-2029 con le tavole XLSX
          confrontabili. Finché non esce, qui non compare come «Legge 2027»:
          il 2027 che vedi sotto è il 2° anno della legge già approvata
          2026-2028, non la nuova manovra.
        </p>
        <div className={styles.heroMeta}>
          <a href={edition.xlsx.url} target="_blank" rel="noreferrer">
            XLSX {edition.label}
          </a>
          <a href={edition.pdf.url} target="_blank" rel="noreferrer">
            PDF {edition.label}
          </a>
          <a href={edition.landingUrl} target="_blank" rel="noreferrer">
            Pagina ufficiale
          </a>
          <a href={snapshot.coverage.archiveCatalogUrl} target="_blank" rel="noreferrer">
            Archivio RGS
          </a>
          <Link href="/spese/legge-di-bilancio">Simulatore Legge di Bilancio</Link>
        </div>
      </header>

      <div className={styles.controls}>
        <div
          className={styles.controlBlock}
          role="navigation"
          aria-label="Quale legge di bilancio"
        >
          <p className={styles.controlLabel}>
            <strong>1. Quale legge di bilancio</strong>
            <span>
              Ogni riquadro è un documento ufficiale diverso (una manovra). Al
              cambio torni sempre al primo anno di quella legge.
            </span>
          </p>
          <div className={styles.chips}>
            {editions.map((row) => (
              <Link
                key={row.id}
                href={hrefForEdition(row.id, {
                  // Reset to year 1 so switching manovra always changes the headline numbers.
                  anno: row.firstYear,
                })}
                className={styles.chip}
                aria-current={row.id === edition.id ? "page" : undefined}
              >
                Legge {row.firstYear}
                <span>
                  {row.id === snapshot.latestEditionId ? "ultima · " : ""}
                  triennio {row.years[0]}-{row.years[row.years.length - 1]}
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div
          className={styles.controlBlock}
          role="navigation"
          aria-label="Anno dentro la legge scelta"
        >
          <p className={styles.controlLabel}>
            <strong>2. Anno dentro questa legge</strong>
            <span>
              Non è un’altra manovra: sono il 1°, 2° o 3° anno previsti dallo
              stesso documento ({edition.label}).
            </span>
          </p>
          <div className={styles.compareChips}>
            {edition.years.map((year, index) => (
              <Link
                key={year}
                href={hrefForEdition(edition.id, {
                  confronta:
                    compareFromYear < year ? compareFromYear : undefined,
                  anno: year,
                })}
                className={styles.compareChip}
                aria-current={year === focusYear ? "page" : undefined}
              >
                {year}
                <span className={styles.yearChipHint}>
                  {index === 0 ? "1° anno" : `${index + 1}° anno`}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <p className={styles.contextBanner} role="status">
        {focusYear === edition.firstYear ? (
          <>
            Stai confrontando la <strong>legge {edition.firstYear}</strong> con
            le altre manovre sul <strong>primo anno</strong> ({focusYear}
            ).
            {comparison
              ? ` Rispetto alla legge ${comparison.fromYear}: spese ${formatSignedPct(comparison.speseFinali.deltaPct)}, entrate ${formatSignedPct(comparison.entrateFinali.deltaPct)}.`
              : " È la prima edizione della serie confrontabile."}
          </>
        ) : (
          <>
            Stai leggendo il <strong>{edition.years.indexOf(focusYear) + 1}° anno</strong>{" "}
            della stessa legge {edition.firstYear}-{edition.years[edition.years.length - 1]}{" "}
            (anno {focusYear}). Qui non confronti due manovre: vedi la previsione
            interna al documento. Per il confronto tra manovre torna al{" "}
            <Link href={hrefForEdition(edition.id, { anno: edition.firstYear })}>
              1° anno
            </Link>
            .
          </>
        )}
      </p>

      <section className={styles.pulse} aria-label={`Sintesi ${focusYear}`}>
        <article className={styles.pulseCard}>
          <span>
            Spese {focusYear} ·{" "}
            <a href="#glossario-competenza">competenza</a>
          </span>
          <strong>
            {formatBillions(focusSpese ?? edition.headline.speseFinaliCompetenzaEur)}
          </strong>
          <em
            className={deltaClass(
              focusYear === edition.firstYear
                ? comparison?.speseFinali.deltaPct
                : null,
            )}
          >
            {focusYear === edition.firstYear
              ? comparison
                ? `${formatSignedPct(comparison.speseFinali.deltaPct)} vs legge ${comparison.fromYear}`
                : "Prima manovra della serie"
              : `Stessa legge · ${edition.years.indexOf(focusYear) + 1}° anno`}
          </em>
        </article>
        <article className={styles.pulseCard}>
          <span>
            Entrate {focusYear} ·{" "}
            <a href="#glossario-competenza">competenza</a>
          </span>
          <strong>
            {formatBillions(
              focusEntrate ?? edition.headline.entrateFinaliCompetenzaEur,
            )}
          </strong>
          <em
            className={deltaClass(
              focusYear === edition.firstYear
                ? comparison?.entrateFinali.deltaPct
                : null,
            )}
          >
            {focusYear === edition.firstYear
              ? comparison
                ? `${formatSignedPct(comparison.entrateFinali.deltaPct)} vs legge ${comparison.fromYear}`
                : "Prima manovra della serie"
              : `Stessa legge · ${edition.years.indexOf(focusYear) + 1}° anno`}
          </em>
        </article>
        <article className={styles.pulseCard}>
          <span>
            <a href="#glossario-saldo">Saldo da finanziare</a>
          </span>
          <strong>
            {formatBillions(
              focusSaldo ??
                edition.headline.saldoNettoDaFinanziareCompetenzaEur,
            )}
          </strong>
          <em
            className={deltaClass(
              focusYear === edition.firstYear
                ? comparison?.saldoNettoDaFinanziare.deltaEur
                : null,
            )}
          >
            {focusYear === edition.firstYear
              ? comparison
                ? `${formatSignedBillions(comparison.saldoNettoDaFinanziare.deltaEur)} vs legge ${comparison.fromYear}`
                : "Base della serie"
              : "Previsione nella stessa legge"}
          </em>
        </article>
        <article className={styles.pulseCard}>
          <span>
            <a href="#glossario-ricorso">Ricorso al mercato</a>
          </span>
          <strong>
            {formatBillions(
              focusRicorso ?? edition.headline.ricorsoAlMercatoCompetenzaEur,
            )}
          </strong>
          <em
            className={deltaClass(
              focusYear === edition.firstYear
                ? comparison?.ricorsoAlMercato.deltaEur
                : null,
            )}
          >
            {focusYear === edition.firstYear
              ? comparison
                ? `${formatSignedBillions(comparison.ricorsoAlMercato.deltaEur)} vs legge ${comparison.fromYear}`
                : "Base della serie"
              : "Previsione nella stessa legge"}
          </em>
        </article>
      </section>

      <section className={styles.section} aria-labelledby="quanto-title">
        <div className={styles.sectionHeader}>
          <h2 id="quanto-title">1. Quanto spende e quanto incassa lo Stato</h2>
          <p>
            Stai per vedere un confronto tra le diverse leggi (non tra gli anni
            della stessa legge): per ciascuna manovra, entrate e spese del{" "}
            <strong>primo anno</strong>, in miliardi di euro.
          </p>
        </div>
        <EntrateSpeseCompareChart data={yearCompare} />
      </section>

      <section className={styles.section} aria-labelledby="composizione-title">
        <div className={styles.sectionHeader}>
          <h2 id="composizione-title">2. Da dove arrivano i soldi e come si spendono</h2>
          <p>
            Stai per vedere, per ogni anno del triennio, di cosa sono fatte le
            entrate (tasse, altre entrate, vendite) e le spese (correnti,
            interessi, investimenti).
          </p>
        </div>
        <CompositionChart data={composition} />
      </section>

      <section className={styles.section} aria-labelledby="fisco-title">
        <div className={styles.sectionHeader}>
          <h2 id="fisco-title">3. Le singole voci più grandi nel {focusYear}</h2>
          <p>
            Due elenchi in miliardi di euro: a sinistra le entrate più alte
            (IRPEF, IVA…), a destra le categorie di spesa più alte (trasferimenti,
            interessi…).
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
                  <th scope="col">Voce</th>
                  <th scope="col" className={styles.num}>Importo</th>
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
                  <th scope="col">Categoria</th>
                  <th scope="col" className={styles.num}>Importo</th>
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

      <section className={styles.section} aria-labelledby="missioni-title">
        <div className={styles.sectionHeader}>
          <h2 id="missioni-title">4. Dove vanno i soldi: scuola, previdenza, debito…</h2>
          <p>
            Stai per vedere le voci ufficiali del bilancio dello Stato nel{" "}
            {focusYear}, in miliardi di euro (fonte: Ragioneria dello Stato).
            Scuola e salute sono separate. Poi, se c’è l’anno prima nel
            triennio, vedi quanto ciascuna voce cresce o cala.
          </p>
        </div>
        <div className={styles.chartStack}>
          {rgsMissions.length > 0 ? (
            <RgsMissionSpendChart data={rgsMissions} year={focusYear} />
          ) : (
            <p className={styles.note}>
              Per questa edizione non abbiamo ancora l’elenco delle voci di
              spesa.
            </p>
          )}
          {rgsDeltas.length > 0 && priorTrienniumYear != null ? (
            <MissionDeltaChart
              data={rgsDeltas}
              fromYear={priorTrienniumYear}
              toYear={focusYear}
              title={`Cosa cambia nelle voci di spesa dal ${priorTrienniumYear} al ${focusYear}`}
              lead={`Stai per vedere la differenza in miliardi di euro tra ${priorTrienniumYear} e ${focusYear} per le stesse voci del bilancio dello Stato. A destra cresce, a sinistra si riduce.`}
            />
          ) : null}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="dove-title">
        <div className={styles.sectionHeader}>
          <h2 id="dove-title">5. Un altro archivio ufficiale, sugli anni già chiusi</h2>
          <p>
            Stai per vedere lo stesso tipo di lettura (dove vanno i soldi per
            capitolo), ma da un altro dataset pubblico della Ragioneria -
            OpenBDAP, il portale open data del bilancio. Serve per confrontare
            anni già pubblicati come legge di bilancio, non per sostituire i
            grafici della sezione 4.
          </p>
        </div>
        <div className={styles.chartStack}>
          <MissionSpendChart
            data={missionSpend}
            year={openBdapFocusYear}
            title={`Le 10 spese più grandi nel ${openBdapFocusYear} (archivio open data)`}
            lead={`Questo grafico usa i dati open data della Ragioneria (OpenBDAP): le dieci voci di spesa più grandi previste dalla legge di bilancio del ${openBdapFocusYear}, in miliardi di euro.`}
          />
          {openBdapCompareYears.length > 0 ? (
            <div className={styles.compareBar} role="navigation" aria-label="Anno di confronto">
              <span>
                Solo per questo grafico: confronta il {openBdapFocusYear} con
              </span>
              <div className={styles.compareChips}>
                {openBdapCompareYears.map((year) => (
                  <Link
                    key={year}
                    href={hrefForEdition(edition.id, {
                      confronta: year,
                      anno: focusYear,
                    })}
                    className={styles.compareChip}
                    aria-current={year === openBdapCompareFromYear ? "page" : undefined}
                  >
                    {year}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
          <MissionDeltaChart
            data={missionDeltas}
            fromYear={openBdapCompareFromYear}
            toYear={openBdapFocusYear}
            title={`Cosa cambia tra ${openBdapCompareFromYear} e ${openBdapFocusYear} (stesso archivio open data)`}
            lead={`Differenza in miliardi di euro tra i due anni scelti, sempre sui capitoli di spesa dell’archivio open data della Ragioneria. A destra cresce, a sinistra si riduce.`}
          />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="storia-title">
        <div className={styles.sectionHeader}>
          <h2 id="storia-title">6. Come è cambiata la spesa totale nel tempo</h2>
          <p>
            Stai per vedere due linee sul totale delle spese dello Stato negli
            anni: una dall’archivio open data (anche prima del 2023) e, se
            disponibile, una dalla Ragioneria nella stessa edizione che stai
            leggendo.
          </p>
        </div>
        <div className={styles.chartStack}>
          <MissionHistoryChart
            data={openBdapTotals}
            title="Spesa totale dello Stato nel tempo (archivio open data)"
            lead="Somma di tutti i capitoli previsti dalla legge di bilancio, anno per anno. Serve a vedere se il totale cresce o cala nel lungo periodo."
            ariaLabel="Totale stanziamenti OpenBDAP per anno"
          />
          {missionHistoryTotals.length > 0 ? (
            <MissionHistoryChart
              data={missionHistoryTotals}
              title={`Spesa totale ripubblicata in questa edizione (${edition.label})`}
              lead="Stesso concetto (totale delle voci di spesa), preso dalle tavole di questa edizione della Ragioneria, anche per anni storici."
              ariaLabel="Totale missioni RGS Tavola A.3 per anno"
            />
          ) : null}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="manovra-title">
        <div className={styles.sectionHeader}>
          <h2 id="manovra-title">7. Cosa sposta la nuova legge rispetto a prima</h2>
          <p>
            Stai per vedere solo l’effetto della manovra: quanto la nuova legge
            sposta i soldi rispetto alle regole già in vigore, in 9 grandi
            famiglie di spesa (non il dettaglio scuola/sanità della sezione 4).
          </p>
        </div>
        <ManovraShareChart
          year={focusYear}
          data={share.map((row) => ({
            aggregate: row.aggregate,
            short: row.aggregate,
            manovraPct: Number(row.manovraPct.toFixed(2)),
            manovraMld:
              row.manovraEur == null ? null : Number((row.manovraEur / 1e9).toFixed(2)),
            stanziamentoMld:
              row.stanziamentoEur == null
                ? null
                : Number((row.stanziamentoEur / 1e9).toFixed(1)),
          }))}
        />
      </section>

      <section className={styles.section} aria-labelledby="finanza-title">
        <div className={styles.sectionHeader}>
          <h2 id="finanza-title">8. Come si chiude il bilancio (e rispetto al PIL)</h2>
          <p>
            Prima una tabella del triennio in miliardi di euro (entrate, spese,
            saldo, prestito sui mercati). Poi, se disponibile, il peso di debito
            e deficit sull’economia in % del PIL.
          </p>
        </div>
        <div className={`${styles.panel} ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Anno</th>
                <th scope="col" className={styles.num}>Entrate</th>
                <th scope="col" className={styles.num}>Spese</th>
                <th scope="col" className={styles.num}>Saldo</th>
                <th scope="col" className={styles.num}>Ricorso al mercato</th>
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

      <section className={styles.section} aria-labelledby="glossario-title">
        <div className={styles.sectionHeader}>
          <h2 id="glossario-title">9. Parole da conoscere</h2>
          <p>
            Quattro termini del bilancio spiegati in italiano. I numeri di questa
            pagina sono in «competenza» (vedi sotto), non i soldi già usciti dalla
            cassa.
          </p>
        </div>
        <dl className={styles.glossary}>
          <div id="glossario-competenza">
            <dt>Competenza</dt>
            <dd>
              L’importo che lo Stato prevede di accertare o impegnare nell’anno,
              anche se i soldi entrano o escono dopo. È la base del confronto
              tra manovre.
            </dd>
          </div>
          <div id="glossario-cassa">
            <dt>Cassa</dt>
            <dd>
              I soldi che entrano o escono davvero nell’anno. Utile per la
              liquidità; non va sommata alla competenza né confrontata con i
              pagamenti SIOPE come se fossero la stessa cosa.
            </dd>
          </div>
          <div id="glossario-saldo">
            <dt>Saldo netto da finanziare</dt>
            <dd>
              Entrate finali meno spese finali. Se è negativo, quella parte del
              bilancio va coperta con altro finanziamento.
            </dd>
          </div>
          <div id="glossario-ricorso">
            <dt>Ricorso al mercato</dt>
            <dd>
              Quanto il bilancio prevede di prendere a prestito sui mercati per
              chiudere i conti, al netto dei rimborsi già previsti.
            </dd>
          </div>
        </dl>
      </section>

      <aside className={styles.sources} aria-label="Fonti ufficiali">
        <strong>Fonti</strong>
        <span>
          {snapshot.holder} · edizione {edition.label} · natura {edition.nature} ·
          unità {edition.unit}
        </span>
        <span>
          <a href={edition.xlsx.url} target="_blank" rel="noreferrer">
            {edition.xlsx.fileName}
          </a>
          {" · "}
          <a href={edition.pdf.url} target="_blank" rel="noreferrer">
            {edition.pdf.fileName}
          </a>
          {" · "}
          <a href={edition.landingUrl} target="_blank" rel="noreferrer">
            landing RGS
          </a>
          {" · "}
          <a href={missionSeries.dataset.apiUrl} target="_blank" rel="noreferrer">
            OpenBDAP
          </a>
        </span>
        <span>
          SHA-256 XLSX {edition.xlsx.sha256.slice(0, 12)}… · PDF{" "}
          {edition.pdf.sha256.slice(0, 12)}… · acquisito {edition.acquiredAt.slice(0, 10)}
        </span>
        <span>{snapshot.coverage.note}</span>
        {edition.caveats.length > 0 ? (
          <ul className={styles.caveats}>
            {edition.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        ) : null}
      </aside>
    </main>
  );
}
