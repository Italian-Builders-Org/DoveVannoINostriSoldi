import type { Metadata } from "next";
import Link from "next/link";
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
import styles from "./spese.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Spese dello Stato",
  description:
    "Pagamenti del Bilancio dello Stato da RGS/OpenBDAP, spiegati con grafici, date e fonti.",
};

const exactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
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
  return (
    <div className={styles.provenanceRow}>
      <div>
        <strong>{datasetLabel(dataset)}</strong>
        <small>{dataset.productCode}</small>
      </div>
      <div>
        <span>{dataset.title}</span>
        <small>Identificativo {dataset.packageId}</small>
      </div>
      <div className={styles.provenanceActions}>
        <a href={dataset.csvUrl} target="_blank" rel="noreferrer">CSV RGS ↗</a>
        <a href={dataset.apiUrl} target="_blank" rel="noreferrer">API ↗</a>
      </div>
    </div>
  );
}

function SpendingDashboard({ snapshot }: { snapshot: StateSpendingSnapshot }) {
  const maxPaymentMethod = snapshot.paymentMethods[0]?.value ?? 0;
  const sourceUpdatedAt = snapshot.sources.mission.metadataModified;

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
            <strong>{snapshot.period.label}</strong>
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
            <a href={snapshot.sources.mission.csvUrl} target="_blank" rel="noreferrer">apri CSV ufficiale ↗</a>
          </div>
        </aside>
      </header>

      <section className={styles.overview} aria-label="Quadro sintetico">
        <div className={styles.primaryMetric}>
          <div className={styles.metricLabel}>
            <i aria-hidden="true" />
            Pagamenti da inizio anno
          </div>
          <strong>{compactEuro(snapshot.totalPaid)}</strong>
          <span>Somma del campo ufficiale “Totale Pagato” per tutte le missioni.</span>
          <p>
            RGS descrive il rilascio come pagamenti effettuati <b>dal 1° gennaio fino al mese contabile di riferimento</b>.
            Il valore è il totale da gennaio. Nel grafico mensile sottraiamo il totale del mese precedente.
          </p>
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

      <Suspense fallback={<StateSpendingHistoryFallback />}>
        <StateSpendingHistorySection />
      </Suspense>

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
            <a href={snapshot.sources.mission.csvUrl} target="_blank" rel="noreferrer">fonte CSV ↗</a>
          </div>
          <SpendingBarChart
            data={snapshot.missions}
            ariaLabel={`Prime missioni del Bilancio dello Stato per totale pagato cumulato, ${snapshot.period.label}`}
            maxItems={12}
            height={500}
          />
          <p className={styles.chartCaption}>
            Totali in euro da gennaio. L&apos;ordine usa il campo “Totale Pagato” del file RGS per Missione.
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
                <a href={snapshot.sources.missionAdministration.csvUrl} target="_blank" rel="noreferrer">CSV ↗</a>
              )}
            </div>
            <SpendingBarChart
              data={snapshot.administrations}
              ariaLabel={`Amministrazioni centrali per totale pagato cumulato, ${snapshot.period.label}`}
              maxItems={10}
              height={430}
            />
          </div>

          <div className={styles.chartBlock}>
            <div className={styles.chartTitle}>
              <h3>Categorie economiche</h3>
              {snapshot.sources.administrationEconomic && (
                <a href={snapshot.sources.administrationEconomic.csvUrl} target="_blank" rel="noreferrer">CSV ↗</a>
              )}
            </div>
            <SpendingBarChart
              data={snapshot.economicCategories}
              ariaLabel={`Categorie economiche per totale pagato cumulato, ${snapshot.period.label}`}
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
                  <i style={{ width: `${Math.min(width, 100)}%` }} />
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
    </>
  );
}

export default async function StateSpendingPage() {
  let snapshot: StateSpendingSnapshot | null = null;
  let errorMessage: string | null = null;

  try {
    snapshot = await getStateSpendingSnapshot();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Errore sconosciuto";
  }

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span>→</span>
        <span>Spese dello Stato</span>
      </nav>

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
