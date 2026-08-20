import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BankIcon,
  Building06Icon,
  HierarchyIcon,
  MapsIcon,
} from "@hugeicons/core-free-icons";
import { RegistryTypeChart } from "@/components/charts/registry-type-chart";
import {
  getIpaCentralAdministrations,
  getIpaRegistryStats,
  IPA_ENTI_DATASET_URL,
  IPA_ENTI_RESOURCE_ID,
  IPA_LICENSE,
  searchIpaEntities,
  type IpaSearchResult,
} from "@/lib/ipa";
import { getIpaTypeDistribution, type IpaTypeStat } from "@/lib/ipa-stats";
import styles from "./enti.module.css";

export const dynamic = "force-dynamic";

const numberFormatter = new Intl.NumberFormat("it-IT");

type PageProps = {
  searchParams: Promise<{
    q?: string | string[];
  }>;
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function locationLabel(indirizzo: string | null, cap: string | null): string {
  if (indirizzo && cap) return `${indirizzo} · ${cap}`;
  return indirizzo ?? cap ?? "Sede non indicata nel record IPA";
}

function formatObservedAt(value: string | null): string {
  if (!value) return "Non disponibile";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Non disponibile";

  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(date);
}

export default async function EntiPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = first(params.q).trim().slice(0, 180);
  const canSearch = query.length >= 2;

  let stats: Awaited<ReturnType<typeof getIpaRegistryStats>> | null = null;
  let distribution: IpaTypeStat[] = [];
  let distributionObservedAt: string | null = null;
  let result: IpaSearchResult | null = null;
  let centralAdministrations: IpaSearchResult | null = null;
  let upstreamError = false;

  const [statsResult, distributionResult, centralResult] = await Promise.allSettled([
    getIpaRegistryStats(),
    getIpaTypeDistribution(8),
    getIpaCentralAdministrations(),
  ]);

  if (statsResult.status === "fulfilled") {
    stats = statsResult.value;
  }

  if (distributionResult.status === "fulfilled") {
    distribution = distributionResult.value.records;
    distributionObservedAt = distributionResult.value.observedAt;
  }

  if (centralResult.status === "fulfilled") {
    centralAdministrations = centralResult.value;
  }

  if (
    statsResult.status === "rejected" &&
    distributionResult.status === "rejected" &&
    centralResult.status === "rejected"
  ) {
    upstreamError = true;
  }

  if (canSearch) {
    try {
      result = await searchIpaEntities({ query, limit: 30 });
      upstreamError = false;
    } catch {
      upstreamError = true;
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.intro}>
        <div>
          <h1 className={styles.title}>Organizzazioni pubbliche</h1>
          <p className={styles.lead}>
            Cerca un&apos;amministrazione, apri la sua struttura interna dichiarata in IPA e segui i
            collegamenti verso spese, progetti e fonti ufficiali. Enti, uffici e società partecipate
            restano livelli distinti: non li deduciamo dal nome.
          </p>
        </div>

        <aside className={styles.sourceCard} aria-label="Informazioni sulla fonte IPA">
          <div className={styles.sourceCardTop}>
            <strong>Indice PA · Enti</strong>
            <span className={styles.live}>FONTE ATTIVA</span>
          </div>
          <div className={styles.sourceMeta}>
            <div>
              <b>Frequenza</b>
              <span>giornaliera</span>
            </div>
            <div>
              <b>Licenza</b>
              <span>{IPA_LICENSE}</span>
            </div>
            <div>
              <b>Accesso</b>
              <span>Servizio dati AgID</span>
            </div>
            <div>
              <b>Identificativo del file</b>
              <span>{IPA_ENTI_RESOURCE_ID}</span>
            </div>
          </div>
          <a className={styles.sourceLink} href={IPA_ENTI_DATASET_URL} target="_blank" rel="noreferrer">
            Apri i dati AgID <span>↗</span>
          </a>
        </aside>
      </section>

      <nav className={styles.organizationPaths} aria-label="Percorsi nel registro delle organizzazioni">
        <Link href="/enti#amministrazioni-centrali">
          <HugeiconsIcon icon={BankIcon} size={22} strokeWidth={1.5} aria-hidden="true" />
          <span><strong>Ministeri e Presidenza</strong><small>17 amministrazioni centrali nella categoria IPA C1</small></span>
          <b aria-hidden="true">→</b>
        </Link>
        <Link href="/enti/PCM#struttura-ipa">
          <HugeiconsIcon icon={HierarchyIcon} size={22} strokeWidth={1.5} aria-hidden="true" />
          <span><strong>Dipartimenti e uffici</strong><small>Apri le UO e AOO di Palazzo Chigi; la stessa vista è disponibile per ogni ente</small></span>
          <b aria-hidden="true">→</b>
        </Link>
        <Link href="/enti?q=Regione">
          <HugeiconsIcon icon={MapsIcon} size={22} strokeWidth={1.5} aria-hidden="true" />
          <span><strong>Regioni ed enti territoriali</strong><small>Anagrafica IPA e dati territoriali SIOPE</small></span>
          <b aria-hidden="true">→</b>
        </Link>
        <Link href="/partecipazioni">
          <HugeiconsIcon icon={Building06Icon} size={22} strokeWidth={1.5} aria-hidden="true" />
          <span><strong>Società partecipate</strong><small>53.656 relazioni dichiarate nel censimento MEF 2023</small></span>
          <b aria-hidden="true">→</b>
        </Link>
      </nav>

      <section className={styles.searchSection} aria-labelledby="ricerca-enti">
          <span className={styles.kicker}>CERCA NEL REGISTRO UFFICIALE</span>
        <form className={styles.searchForm} action="/enti" method="get">
          <label className={styles.visuallyHidden} htmlFor="q">Cerca un ente</label>
          <input
            className={styles.input}
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Comune di Milano, Ministero dell'Interno, Regione Calabria, codice IPA…"
            autoComplete="off"
          />
          <button className={styles.searchButton} type="submit">Cerca ente</button>
        </form>
        <p className={styles.searchHelp} id="ricerca-enti">
          La ricerca legge direttamente il registro IPA di AgID. Non usiamo nomi dimostrativi
          o un elenco scritto a mano.
        </p>
      </section>

      <section className={styles.registrySnapshot} aria-labelledby="snapshot-registro">
        <div className={styles.snapshotSummary}>
            <span className={styles.kicker}>REGISTRO IN NUMERI</span>
          <div className={styles.snapshotNumber}>
            <strong>{stats ? numberFormatter.format(stats.total) : "Non disponibile"}</strong>
            <span>enti presenti nel registro</span>
          </div>
          <p>
            Questo è il numero di enti presenti nel registro IPA. Non indica il numero dei soli
            ministeri e non misura la spesa pubblica.
          </p>
          <dl className={styles.snapshotMeta}>
            <div>
              <dt>Controllato</dt>
              <dd>{formatObservedAt(stats?.observedAt ?? distributionObservedAt)}</dd>
            </div>
            <div>
              <dt>Valori dimostrativi</dt>
              <dd>nessuno</dd>
            </div>
          </dl>
        </div>

        <div className={styles.chartPanel}>
          <div className={styles.chartHeading}>
            <div>
              <span className={styles.kicker}>COMPOSIZIONE</span>
              <h2 id="snapshot-registro">Tipologie più presenti</h2>
            </div>
            <span className={styles.chartSource}>dati IPA</span>
          </div>
          <RegistryTypeChart data={distribution} />
        </div>
      </section>

      {!query && centralAdministrations && (
        <section className={styles.centralDirectory} aria-labelledby="amministrazioni-centrali">
          <div className={styles.resultsHeader}>
            <div>
              <h2 id="amministrazioni-centrali">Ministeri, Presidenza e Avvocatura</h2>
              <p>IPA raccoglie questi enti nella categoria C1 e distingue i ministeri dalla Presidenza del Consiglio.</p>
            </div>
            <span>{numberFormatter.format(centralAdministrations.total)} enti · aggiornamento giornaliero</span>
          </div>
          <div className={styles.entityList}>
            {centralAdministrations.records.map((entity) => {
              const type = entity.codiceIpa === "PCM"
                ? "Presidenza del Consiglio"
                : entity.codiceNatura === "2220"
                  ? "Ministero"
                  : "Amministrazione centrale";
              return (
                <Link className={styles.centralRow} href={`/enti/${encodeURIComponent(entity.codiceIpa)}`} key={entity.codiceIpa}>
                  <span className={styles.centralIcon} aria-hidden="true">
                    <HugeiconsIcon icon={BankIcon} size={20} strokeWidth={1.5} />
                  </span>
                  <span><strong>{entity.denominazione}</strong><small>{type}</small></span>
                  <code>{entity.codiceIpa}</code>
                  <b aria-hidden="true">→</b>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {!query && !centralAdministrations && (
        <div className={styles.empty}>
          <strong>L&apos;elenco delle amministrazioni centrali non è disponibile ora.</strong>
          <p>La ricerca IPA resta utilizzabile; non sostituiamo l&apos;elenco ufficiale con una lista statica.</p>
        </div>
      )}

      {query && !canSearch && (
        <div className={styles.empty}>
          <strong>Scrivi almeno due caratteri.</strong>
          <p>La ricerca parte dopo due caratteri per non sovraccaricare il servizio pubblico.</p>
        </div>
      )}

      {upstreamError && canSearch && !result && (
        <div className={styles.error}>
          <strong>La fonte IPA non risponde in questo momento.</strong>
          <p>
            Non sostituiamo il dato ufficiale con un elenco inventato. Riprova più tardi oppure apri i dati AgID.
          </p>
        </div>
      )}

      {result && (
        <>
          <div className={styles.resultsHeader}>
            <div>
              <span className={styles.kicker}>RISULTATI</span>
              <h2>{numberFormatter.format(result.total)} corrispondenze per “{query}”</h2>
            </div>
            <p>
              Fino a 30 risultati per richiesta. Ogni scheda conserva il Codice IPA e il collegamento alla fonte.
            </p>
          </div>

          {result.records.length > 0 ? (
            <div className={styles.entityList}>
              {result.records.map((entity) => (
                <Link
                  className={styles.entityCard}
                  href={`/enti/${encodeURIComponent(entity.codiceIpa)}`}
                  key={entity.codiceIpa}
                >
                  <div className={styles.entityName}>
                    <strong>{entity.denominazione}</strong>
                    <span>IPA · {entity.codiceIpa}</span>
                    <div className={styles.badges}>
                      {entity.acronimo && <i className={styles.badge}>{entity.acronimo}</i>}
                      {entity.inLiquidazione && (
                        <i className={`${styles.badge} ${styles.badgeWarning}`}>in liquidazione</i>
                      )}
                    </div>
                  </div>
                  <div className={styles.entityColumn}>
                    <b>Tipologia</b>
                    <span>{entity.tipologia ?? "Non indicata"}</span>
                  </div>
                  <div className={styles.entityColumn}>
                    <b>Sede</b>
                    <span>{locationLabel(entity.sede.indirizzo, entity.sede.cap)}</span>
                  </div>
                  <span className={styles.entityArrow} aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <strong>Nessun ente trovato.</strong>
              <p>La ricerca non ha trovato corrispondenze nel registro IPA.</p>
            </div>
          )}
        </>
      )}
    </main>
  );
}
