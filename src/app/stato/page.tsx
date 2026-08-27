import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SpendingBarChart } from "@/components/charts/spending-bar-chart";
import {
  StateSpendingHistoryFallback,
  StateSpendingHistorySection,
} from "@/components/state-spending-history-section";
import {
  getStateSpendingSnapshot,
  type BdapDataset,
  type StateSpendingSnapshot,
} from "@/lib/bdap-payments";
import {
  parseStateOverviewSelection,
  STATE_CONSUNTIVO_YEAR,
} from "@/lib/data/state-overview-period";
import styles from "./stato.module.css";

export const dynamic = "force-dynamic";

const PAGE_DATA_BUDGET_MS = 8_000;

export const metadata: Metadata = {
  title: "Spese dello Stato",
  description:
    "Pagamenti del Bilancio dello Stato da RGS/OpenBDAP, spiegati con grafici, date e fonti.",
};

const exactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
  useGrouping: "always",
});

function compactEuro(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("it-IT", {
      maximumFractionDigits: 1,
    })} mld €`;
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", {
      maximumFractionDigits: 1,
    })} mln €`;
  }
  return exactEuro.format(value);
}

function formatDateTime(value: string | null): string {
  if (!value) return "non disponibile";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(date);
}

function differenceLabel(value: number | null): string {
  if (value === null) return "non disponibile";
  if (Math.abs(value) < 0.005) return "0,00%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function datasetLabel(dataset: BdapDataset): string {
  if (dataset.dimension === "mission") return "Missione";
  if (dataset.dimension === "missionAdministration") return "Missione e amministrazione";
  return "Amministrazione e tipo di spesa";
}

function SourceRow({ dataset }: { dataset: BdapDataset }) {
  const releaseLabel = dataset.releaseKind === "consuntivo"
    ? "Consuntivo annuale"
    : "Rilascio mensile";
  return (
    <div className={styles.provenanceRow}>
      <div>
        <strong>{datasetLabel(dataset)}</strong>
        <small>{releaseLabel} · {dataset.productCode}</small>
      </div>
      <div>
        <span>{dataset.title}</span>
        <small>Identificativo {dataset.packageId}</small>
      </div>
      <div className={styles.provenanceActions}>
        <a href={dataset.csvUrl} target="_blank" rel="noreferrer" aria-label={`Scarica il CSV RGS ${datasetLabel(dataset)} (si apre in una nuova scheda)`}>CSV RGS ↗</a>
        <a href={dataset.apiUrl} target="_blank" rel="noreferrer" aria-label={`Apri l’API OpenBDAP ${datasetLabel(dataset)} (si apre in una nuova scheda)`}>API ↗</a>
      </div>
    </div>
  );
}

function StatePeriodSelector({ isConsuntivo }: { isConsuntivo: boolean }) {
  return (
    <nav className={styles.periodSelector} aria-label="Seleziona il rilascio della spesa dello Stato">
      <span>Vista del periodo</span>
      <div>
        <Link
          href="/stato"
          aria-current={!isConsuntivo ? "page" : undefined}
        >
          Ultimo rilascio mensile disponibile
        </Link>
        <Link
          href={`/stato?anno=${STATE_CONSUNTIVO_YEAR}`}
          aria-current={isConsuntivo ? "page" : undefined}
        >
          Consuntivo {STATE_CONSUNTIVO_YEAR} · definitivo
        </Link>
      </div>
    </nav>
  );
}

function SpendingDashboard({ snapshot }: { snapshot: StateSpendingSnapshot }) {
  const maxPaymentMethod = Math.max(...snapshot.paymentMethods.map((method) => method.value), 0);
  const sourceUpdatedAt = snapshot.sources.mission.metadataModified;
  const isConsuntivo = snapshot.period.releaseKind === "consuntivo";
  const totalPaidField = isConsuntivo ? "Totale pagato" : "Totale Pagato";
  const chartValueLabel = isConsuntivo ? "totale pagato del consuntivo" : "totale pagato cumulato";
  const administrationQuery = snapshot.period.month === null
    ? `anno=${snapshot.period.year}`
    : `anno=${snapshot.period.year}&mese=${snapshot.period.month}`;

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>RGS / OPENBDAP · PAGAMENTI DEL BILANCIO DELLO STATO</span>
          <h1 className={styles.title}>Dove va la spesa dello Stato.</h1>
          <p className={styles.lead}>
            Leggiamo i dati ufficiali della Ragioneria Generale dello Stato per mostrare come cambia
            la spesa, chi la gestisce e per quale funzione. Non usiamo stime o valori dimostrativi.
          </p>
        </div>

        <aside className={styles.sourceSummary} aria-label="Metadati della fonte">
          <div className={styles.sourceSummaryRow}>
            <span>Periodo</span>
            <strong>
              {isConsuntivo
                ? `Consuntivo ${snapshot.period.year} · definitivo`
                : `${snapshot.period.monthName} ${snapshot.period.year} · rilascio mensile cumulativo`}
            </strong>
          </div>
          <div className={styles.sourceSummaryRow}>
            <span>Fonte</span>
            <strong>RGS · OpenBDAP</strong>
          </div>
          <div className={styles.sourceSummaryRow}>
            <span>Pubblicato</span>
            <strong>{formatDateTime(sourceUpdatedAt)}</strong>
          </div>
          <div className={styles.sourceSummaryRow}>
            <span>Acquisito</span>
            <strong>{formatDateTime(snapshot.observedAt)}</strong>
          </div>
          <div className={styles.sourceSummaryRow}>
            <span>File originale</span>
            <a href={snapshot.sources.mission.csvUrl} target="_blank" rel="noreferrer" aria-label="Scarica il CSV RGS delle missioni (si apre in una nuova scheda)">apri CSV ufficiale ↗</a>
          </div>
        </aside>
      </header>

      <section className={styles.overview} aria-label="Quadro sintetico">
        <div className={styles.primaryMetric}>
          <div className={styles.metricLabel}>
            <i aria-hidden="true" />
            {isConsuntivo ? "Consuntivo annuale definitivo" : "Rilascio mensile cumulativo"}
          </div>
          <strong>{compactEuro(snapshot.totalPaid)}</strong>
          <span>
            Somma del campo ufficiale “{totalPaidField}” per tutte le missioni nel {isConsuntivo ? "rilascio annuale" : "rilascio mensile"}.
          </span>
          {isConsuntivo ? (
            <p>
              Consuntivo annuale RGS dell&apos;esercizio {snapshot.period.year}. Serie
              annuale e serie mensile restano separate perché hanno significato distinto.
            </p>
          ) : (
            <p>
              RGS descrive il rilascio come pagamenti effettuati <b>dal 1° gennaio fino al mese contabile di riferimento</b>.
              Il valore è il totale da gennaio. Nel grafico mensile sottraiamo il totale del mese precedente.
            </p>
          )}
        </div>

        <div className={styles.facts}>
          <div className={styles.fact}>
            <span>Missioni presenti</span>
            <strong>{snapshot.counts.missions.toLocaleString("it-IT")}</strong>
          </div>
          <div className={styles.fact}>
            <span>Amministrazioni centrali</span>
            <strong>{snapshot.counts.administrations > 0 ? snapshot.counts.administrations.toLocaleString("it-IT") : "Non disponibile"}</strong>
          </div>
          <div className={styles.fact}>
            <span>Categorie economiche</span>
            <strong>{snapshot.counts.economicCategories > 0 ? snapshot.counts.economicCategories.toLocaleString("it-IT") : "Non disponibile"}</strong>
          </div>
          <div className={styles.fact}>
            <span>Frequenza di controllo</span>
            <strong>6 h</strong>
          </div>
        </div>
      </section>

      {isConsuntivo ? (
        <section className={styles.section} aria-labelledby="monthly-history-title">
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.kicker}>SERIE SEPARATA</span>
              <h2 id="monthly-history-title">La serie mese per mese resta mensile</h2>
            </div>
            <p>
              Il grafico storico usa solo i rilasci mensili cumulativi. Non scompone il consuntivo
              {` ${snapshot.period.year}`}. La serie mensile non viene mostrata in questa vista per non
              confrontare livelli diversi.
            </p>
          </div>
          <Link className={styles.separationLink} href="/stato">
            Apri l&apos;ultimo rilascio mensile cumulativo →
          </Link>
        </section>
      ) : (
        <Suspense fallback={<StateSpendingHistoryFallback />}>
          <StateSpendingHistorySection />
        </Suspense>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.kicker}>FUNZIONI PUBBLICHE</span>
            <h2>Le missioni con più pagamenti</h2>
          </div>
          <p>
            Le missioni rappresentano le principali funzioni e finalità perseguite attraverso la spesa pubblica.
            Qui mostriamo le dodici con il totale più alto nel periodo disponibile.
          </p>
        </div>

        <div className={styles.chartBlock}>
          <div className={styles.chartTitle}>
            <h3>Missioni principali, {snapshot.period.label}</h3>
            <a href={snapshot.sources.mission.csvUrl} target="_blank" rel="noreferrer" aria-label="Scarica il CSV RGS delle missioni (si apre in una nuova scheda)">fonte CSV ↗</a>
          </div>
          <SpendingBarChart
            data={snapshot.missions}
            ariaLabel={`Prime missioni del Bilancio dello Stato per ${chartValueLabel}, ${snapshot.period.label}`}
            maxItems={12}
            height={500}
          />
          <p className={styles.chartCaption}>
            {isConsuntivo
              ? `Totali in euro nel consuntivo annuale. L'ordine usa il campo “${totalPaidField}” del file RGS per Missione.`
              : `Totali in euro da gennaio. L'ordine usa il campo “${totalPaidField}” del file RGS per Missione.`}
          </p>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.kicker}>CHI GESTISCE LA SPESA</span>
            <h2>Amministrazioni e natura economica</h2>
          </div>
          <p>
            Lo stesso totale viene diviso prima per amministrazione e poi per tipo di spesa.
            Se manca uno dei file ufficiali, il relativo grafico resta vuoto.
          </p>
        </div>

        <div className={styles.chartGrid}>
          <div className={styles.chartBlock}>
            <div className={styles.chartTitle}>
              <h3>Amministrazioni</h3>
              {snapshot.sources.missionAdministration && (
                <a href={snapshot.sources.missionAdministration.csvUrl} target="_blank" rel="noreferrer" aria-label="Scarica il CSV RGS delle amministrazioni (si apre in una nuova scheda)">CSV ↗</a>
              )}
            </div>
            <SpendingBarChart
              data={snapshot.administrations}
              ariaLabel={`Amministrazioni centrali per ${chartValueLabel}, ${snapshot.period.label}`}
              maxItems={10}
              height={430}
            />
            <div className={`table-scroll ${styles.administrationTable}`} role="region" aria-label="Amministrazioni per totale pagato" tabIndex={0}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Amministrazione</th>
                    <th>Pagato</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.administrations.map((administration) => {
                    const identity = administration.identity;
                    const content = (
                      <>
                        <strong>{administration.label}</strong>
                        {identity && <small>Collegamento IPA verificato</small>}
                      </>
                    );

                    return (
                      <tr key={administration.code || administration.label}>
                        <td>
                          {administration.code ? (
                            <Link
                              href={`/stato/amministrazioni/${encodeURIComponent(administration.code)}?${administrationQuery}`}
                            >
                              {content}
                            </Link>
                          ) : content}
                        </td>
                        <td>{compactEuro(administration.value)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className={styles.chartBlock}>
            <div className={styles.chartTitle}>
              <h3>Categorie economiche</h3>
              {snapshot.sources.administrationEconomic && (
                <a href={snapshot.sources.administrationEconomic.csvUrl} target="_blank" rel="noreferrer" aria-label="Scarica il CSV RGS delle categorie economiche (si apre in una nuova scheda)">CSV ↗</a>
              )}
            </div>
            <SpendingBarChart
              data={snapshot.economicCategories}
              ariaLabel={`Categorie economiche per ${chartValueLabel}, ${snapshot.period.label}`}
              maxItems={10}
              height={430}
            />
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.kicker}>COME VIENE PAGATO</span>
            <h2>Canali di pagamento</h2>
          </div>
          <p>
            Composizione delle modalità incluse da RGS nel “Totale Pagato”. La barra più lunga corrisponde
            al canale con il totale maggiore. Non indica una soglia prevista dalla legge.
          </p>
        </div>

        <div className={styles.methodList}>
          {snapshot.paymentMethods.map((method) => {
            const width = maxPaymentMethod > 0 ? Math.max(0.5, (method.value / maxPaymentMethod) * 100) : 0;
            return (
              <div className={styles.methodRow} key={method.code ?? method.label}>
                <span>{method.label}</span>
                <div className={styles.methodTrack} aria-hidden="true">
                  <i style={{ width: `${width}%` }} />
                </div>
                <strong>{compactEuro(method.value)}</strong>
              </div>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.kicker}>CONTROLLO DI COERENZA</span>
            <h2>Tre viste, un totale da verificare</h2>
          </div>
          <p>
            Confrontiamo i totali ottenuti da file RGS diversi. Se non coincidono, mostriamo la
            differenza senza correggerla o nasconderla.
          </p>
        </div>

        <div className={styles.qualityGrid}>
          <div className={styles.qualityItem}>
            <span>Missioni · riferimento</span>
            <strong>{compactEuro(snapshot.consistency.missionTotal)}</strong>
            <small>Totale usato per il quadro principale.</small>
          </div>
          <div className={styles.qualityItem}>
            <span>Amministrazioni</span>
            <strong>{snapshot.consistency.administrationTotal === null ? "non disponibile" : compactEuro(snapshot.consistency.administrationTotal)}</strong>
            <small>Scarto vs missioni: {differenceLabel(snapshot.consistency.administrationDifferencePct)}</small>
          </div>
          <div className={styles.qualityItem}>
            <span>Classificazione economica</span>
            <strong>{snapshot.consistency.economicTotal === null ? "non disponibile" : compactEuro(snapshot.consistency.economicTotal)}</strong>
            <small>Scarto vs missioni: {differenceLabel(snapshot.consistency.economicDifferencePct)}</small>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Apri sempre il dato originale</h2>
          </div>
          <p>
            I link portano ai file e ai servizi ufficiali RGS usati per costruire questa pagina.
          </p>
        </div>

        <div className={styles.provenanceList}>
          <SourceRow dataset={snapshot.sources.mission} />
          {snapshot.sources.missionAdministration && <SourceRow dataset={snapshot.sources.missionAdministration} />}
          {snapshot.sources.administrationEconomic && <SourceRow dataset={snapshot.sources.administrationEconomic} />}
        </div>
      </section>

      <div className="notice">
        <strong>Spesa e cicli di legislatura</strong>
        <p>
          Confronto descrittivo, anno per anno dal 2014, tra la spesa statale dell&apos;anno
          pre-elettorale e la media degli altri anni della stessa legislatura.{" "}
          <Link href="/stato/legislature">Apri il confronto →</Link>
        </p>
      </div>
    </>
  );
}

type PageProps = {
  searchParams: Promise<{ anno?: string | string[] }>;
};

export default async function StateSpendingPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const selection = parseStateOverviewSelection(params.anno);
  if (selection.kind === "invalid") notFound();

  let snapshot: StateSpendingSnapshot | null = null;
  let errorMessage: string | null = null;

  try {
    snapshot = await getStateSpendingSnapshot({
      ...(selection.kind === "year" ? { year: selection.year } : {}),
      signal: AbortSignal.timeout(PAGE_DATA_BUDGET_MS),
    });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Errore sconosciuto";
  }

  return (
    <main className={`shell ${styles.page}`}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span>→</span>
        <span>Spese dello Stato</span>
      </nav>

      <StatePeriodSelector
        isConsuntivo={snapshot
          ? snapshot.period.releaseKind === "consuntivo"
          : selection.kind === "year" && selection.year === STATE_CONSUNTIVO_YEAR}
      />

      {snapshot ? (
        <SpendingDashboard snapshot={snapshot} />
      ) : (
        <>
          <header className={styles.header}>
            <div>
              <span className={styles.kicker}>RGS / OPENBDAP</span>
              <h1 className={styles.title}>Spese dello Stato.</h1>
              <p className={styles.lead}>
                Questa pagina usa solo dati ufficiali OpenBDAP. Se la fonte non risponde, non
                sostituiamo i valori con numeri inventati.
              </p>
            </div>
          </header>
          <div className={styles.errorState}>
            <strong>Dati temporaneamente non disponibili.</strong>
            <p>
              Non siamo riusciti a leggere OpenBDAP. Puoi riprovare più tardi. Dettaglio: {errorMessage ?? "non disponibile"}.
            </p>
          </div>
        </>
      )}
    </main>
  );
}
