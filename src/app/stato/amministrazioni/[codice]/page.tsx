import type { Metadata } from "next";
import Link from "next/link";
import { SpendingBarChart } from "@/components/charts/spending-bar-chart";
import {
  getStateAdministrationSpending,
  type BdapDataset,
  type StateAdministrationSpending,
} from "@/lib/bdap-payments";
import { parseReferencePeriod } from "@/lib/data/reference-period";
import { compactEuro, exactEuro, longDate, percent } from "@/lib/format";
import localStyles from "./amministrazione.module.css";
import styles from "../../stato.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Spesa di una amministrazione dello Stato",
  description:
    "Pagamenti, missioni e categorie economiche di una amministrazione centrale nei dati RGS OpenBDAP.",
};

type PageProps = {
  params: Promise<{ codice: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function datasetLabel(dataset: BdapDataset): string {
  return dataset.dimension === "missionAdministration"
    ? "Missioni e amministrazione"
    : "Amministrazione e tipo di spesa";
}

function SourceRow({ dataset }: { dataset: BdapDataset }) {
  const releaseLabel = dataset.releaseKind === "consuntivo"
    ? "Consuntivo annuale"
    : "Rilascio mensile";
  return (
    <div className={styles.provenanceRow}>
      <div>
        <strong>{datasetLabel(dataset)}</strong>
        <small>{releaseLabel} · <code>{dataset.productCode}</code></small>
      </div>
      <div>
        <span>{dataset.title}</span>
        <small>Identificativo <code>{dataset.packageId}</code></small>
      </div>
      <div className={styles.provenanceActions}>
        <a href={dataset.csvUrl} target="_blank" rel="noreferrer" aria-label={`Scarica il CSV RGS ${datasetLabel(dataset)} (si apre in una nuova scheda)`}>CSV RGS ↗</a>
        <a href={dataset.apiUrl} target="_blank" rel="noreferrer" aria-label={`Apri l’API OpenBDAP ${datasetLabel(dataset)} (si apre in una nuova scheda)`}>API ↗</a>
      </div>
    </div>
  );
}

function AdministrationDashboard({ data }: { data: StateAdministrationSpending }) {
  const maxPaymentMethod = Math.max(...data.paymentMethods.map((method) => method.value), 0);
  const identity = data.administration.identity;
  const isConsuntivo = data.period.releaseKind === "consuntivo";
  const totalPaidField = isConsuntivo ? "Totale pagato" : "Totale Pagato";

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>RGS / OPENBDAP · AMMINISTRAZIONE CENTRALE</span>
          <h1 className={styles.title}>{data.administration.name}</h1>
          <p className={styles.lead}>
            {isConsuntivo
              ? "Pagamenti registrati nel consuntivo annuale, divisi per funzione e tipo di spesa."
              : "Pagamenti registrati da inizio anno, divisi per funzione e tipo di spesa."} Il nome e il
            codice vengono dal rilascio ufficiale OpenBDAP.
          </p>
        </div>

        <aside className={styles.sourceSummary} aria-label="Metadati della fonte">
          <div className={styles.sourceSummaryRow}>
            <span>Periodo</span>
            <strong>{data.period.label}</strong>
          </div>
          <div className={styles.sourceSummaryRow}>
            <span>Fonte</span>
            <strong>RGS · OpenBDAP</strong>
          </div>
          <div className={styles.sourceSummaryRow}>
            <span>Rilascio</span>
            <strong>{longDate(data.sources.missionAdministration.metadataModified)}</strong>
          </div>
          <div className={styles.sourceSummaryRow}>
            <span>Controllato da noi</span>
            <strong>{longDate(data.observedAt)}</strong>
          </div>
          <div className={styles.sourceSummaryRow}>
            <span>Codice OpenBDAP</span>
            <strong>{data.administration.code}</strong>
          </div>
        </aside>
      </header>

      <section className={styles.overview} aria-label="Quadro sintetico">
        <div className={styles.primaryMetric}>
          <div className={styles.metricLabel}>
            <i aria-hidden="true" />
            {isConsuntivo
              ? "Pagamenti del consuntivo annuale"
              : `Pagamenti da gennaio a ${data.period.monthName.toLocaleLowerCase("it-IT")}`}
          </div>
          <strong>{compactEuro(data.administration.totalPaid)}</strong>
          <span>{exactEuro(data.administration.totalPaid)} esatti</span>
          <p>
            Somma del campo ufficiale “{totalPaidField}” per le missioni attribuite a questa
            amministrazione nel rilascio {data.period.label}. {isConsuntivo
              ? "Il consuntivo annuale non viene mescolato con i rilasci mensili."
              : "Il dato mensile è cumulato dal 1° gennaio al mese indicato."}
          </p>
        </div>
        <div className={styles.facts}>
          <div className={styles.fact}>
            <span>Missioni</span>
            <strong>{data.counts.missions.toLocaleString("it-IT")}</strong>
          </div>
          <div className={styles.fact}>
            <span>Categorie economiche</span>
            <strong>{data.counts.economicCategories.toLocaleString("it-IT")}</strong>
          </div>
          <div className={styles.fact}>
            <span>Dettagli economici</span>
            <strong>{data.counts.economicDetails.toLocaleString("it-IT")}</strong>
          </div>
          <div className={styles.fact}>
            <span>Collegamento IPA</span>
            <strong>{identity ? "Verificato" : "Non disponibile"}</strong>
          </div>
        </div>
      </section>

      {identity && (
        <div className={`notice ${localStyles.identityNotice}`}>
          <strong>Anagrafica ufficiale collegata</strong>
          <p>
            Il codice e il nome OpenBDAP corrispondono esattamente al Codice IPA {identity.ipaCode}.{" "}
            <Link href={`/enti/${encodeURIComponent(identity.ipaCode)}`}>Apri la scheda dell&apos;ente →</Link>
          </p>
        </div>
      )}

      {data.warnings.length > 0 && (
        <div className="notice warning-notice">
          <strong>Un dettaglio della fonte non è disponibile</strong>
          <ul className={localStyles.warningList}>
            {data.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Per quali funzioni spende</h2>
          </div>
          <p>Le missioni descrivono le finalità principali della spesa pubblica.</p>
        </div>
        <div className={styles.chartGrid}>
          <div className={styles.chartBlock}>
            <div className={styles.chartTitle}>
              <h3>Missioni principali</h3>
              <a href={data.sources.missionAdministration.csvUrl} target="_blank" rel="noreferrer" aria-label="Scarica il CSV RGS delle missioni dell’amministrazione (si apre in una nuova scheda)">CSV ↗</a>
            </div>
            <SpendingBarChart
              data={data.missions}
              ariaLabel={`Missioni di ${data.administration.name} per totale pagato, ${data.period.label}`}
              maxItems={12}
              height={470}
            />
          </div>
          <div className={styles.chartBlock}>
            <div className={styles.chartTitle}>
              <h3>Tipi di spesa</h3>
              {data.sources.administrationEconomic && (
                <a href={data.sources.administrationEconomic.csvUrl} target="_blank" rel="noreferrer" aria-label="Scarica il CSV RGS delle categorie economiche dell’amministrazione (si apre in una nuova scheda)">CSV ↗</a>
              )}
            </div>
            {data.economicCategories.length > 0 ? (
              <SpendingBarChart
                data={data.economicCategories}
                ariaLabel={`Categorie economiche di ${data.administration.name}, ${data.period.label}`}
                maxItems={12}
                height={470}
              />
            ) : (
              <p className={styles.chartCaption}>Il dettaglio economico non è disponibile per questo periodo.</p>
            )}
          </div>
        </div>
      </section>

      {data.economicDetails.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div><h2>Dettaglio economico</h2></div>
            <p>Le prime voci ordinate per totale pagato nel periodo selezionato.</p>
          </div>
          <div className={`table-scroll ${localStyles.detailTable}`} role="region" aria-label="Dettaglio economico" tabIndex={0}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Voce</th>
                  <th scope="col">Codice</th>
                  <th scope="col" className="num">Pagato</th>
                </tr>
              </thead>
              <tbody>
                {data.economicDetails.slice(0, 30).map((item) => (
                  <tr key={`${item.code}:${item.label}`}>
                    <th scope="row">{item.label}</th>
                    <td>{item.code ?? "n.d."}</td>
                    <td className="num">{compactEuro(item.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div><h2>Canali di pagamento</h2></div>
          <p>Le modalità comprese da RGS nel totale pagato. La barra più lunga corrisponde al canale con il totale maggiore.</p>
        </div>
        <div className={styles.methodList}>
          {data.paymentMethods.map((method) => {
            const width = maxPaymentMethod > 0 ? (method.value / maxPaymentMethod) * 100 : 0;
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
          <div><h2>Controllo di coerenza</h2></div>
          <p>Confrontiamo i totali dei due file ufficiali senza correggere eventuali differenze.</p>
        </div>
        <div className={styles.qualityGrid}>
          <div className={styles.qualityItem}>
            <span>Totale per missioni</span>
            <strong>{compactEuro(data.consistency.missionTotal)}</strong>
            <small>Valore di riferimento della pagina.</small>
          </div>
          <div className={styles.qualityItem}>
            <span>Totale economico</span>
            <strong>{data.consistency.economicTotal === null ? "non disponibile" : compactEuro(data.consistency.economicTotal)}</strong>
            <small>Somma del file per classificazione economica.</small>
          </div>
          <div className={styles.qualityItem}>
            <span>Differenza</span>
            <strong>{data.consistency.economicDifferencePct === null ? "n.d." : percent(data.consistency.economicDifferencePct, 2)}</strong>
            <small>Scarto percentuale tra i due totali.</small>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div><h2>Apri il dato originale</h2></div>
          <p>I file ufficiali RGS usati per costruire questa pagina.</p>
        </div>
        <div className={styles.provenanceList}>
          <SourceRow dataset={data.sources.missionAdministration} />
          {data.sources.administrationEconomic && <SourceRow dataset={data.sources.administrationEconomic} />}
        </div>
      </section>
    </>
  );
}

export default async function AdministrationPage({ params, searchParams }: PageProps) {
  const [{ codice }, rawSearchParams] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams();
  const rawYear = first(rawSearchParams.anno);
  const rawMonth = first(rawSearchParams.mese);
  if (rawYear) query.set("anno", rawYear);
  if (rawMonth) query.set("mese", rawMonth);
  const period = parseReferencePeriod(query);

  let data: StateAdministrationSpending | null = null;
  let errorMessage = period.ok ? null : period.error;
  if (period.ok) {
    try {
      data = await getStateAdministrationSpending(decodeURIComponent(codice), {
        ...period.value,
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Errore sconosciuto";
    }
  }

  return (
    <main className={`shell ${styles.page}`}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link><span>→</span>
        <Link href="/stato">Spese dello Stato</Link><span>→</span>
        <span>{data?.administration.name ?? codice}</span>
      </nav>

      {data ? (
        <AdministrationDashboard data={data} />
      ) : (
        <div className={styles.errorState}>
          <strong>Dati non disponibili per questa amministrazione.</strong>
          <p>{errorMessage ?? "La fonte non ha restituito un risultato utilizzabile."}</p>
          <Link className="btn btn-secondary" href="/stato">Torna alle spese dello Stato</Link>
        </div>
      )}
    </main>
  );
}
