import type { Metadata } from "next";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { RegistryTypeChart } from "@/components/charts/registry-type-chart";
import { integer, longDate } from "@/lib/format";
import { mefParticipationsSnapshot as participations } from "@/lib/mef-participations-snapshot";
import { siopeMunicipalSnapshot } from "@/lib/siope-snapshot";
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

export const metadata: Metadata = {
  title: "Registro degli enti pubblici",
  description: "Cerca enti pubblici nel registro IPA e consulta tipologia, sede e dati disponibili.",
};

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

function observedAtLabel(value: string | null): string {
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
    <main className="shell page">
      <div className="page-intro">
        <h1>Chi spende: enti e società</h1>
        <p>
          Registro nazionale degli enti (IPA) e partecipazioni dichiarate al MEF per il{" "}
          {participations.referenceYear}, pubblicate il {longDate(participations.publishedAt)}.
        </p>
      </div>

      <div className={`stat-strip ${styles.fiveUp}`}>
        <div>
          <span className="stat-label">Comuni validi nel periodo SIOPE</span>
          <span className="stat-value">
            {integer(siopeMunicipalSnapshot.coverage.activeSiopeMunicipalities)}
          </span>
          <span className="stat-note">anagrafe aggiornata ogni giorno</span>
        </div>
        <div>
          <span className="stat-label">Società partecipate</span>
          <span className="stat-value">
            {integer(participations.totals.participatedOrganizations)}
          </span>
          <span className="stat-note">dichiarate per il {participations.referenceYear}</span>
        </div>
        <div>
          <span className="stat-label">Enti che dichiarano quote</span>
          <span className="stat-value">
            {integer(participations.totals.declaringAdministrations)}
          </span>
          <span className="stat-note">su tutta Italia</span>
        </div>
        <div>
          <span className="stat-label">Quote dirette</span>
          <span className="stat-value">
            {integer(participations.totals.directParticipationRecords)}
          </span>
          <span className="stat-note">partecipazioni di primo livello</span>
        </div>
        <div>
          <span className="stat-label">Quote indirette</span>
          <span className="stat-value">
            {integer(participations.totals.indirectParticipationRecords)}
          </span>
          <span className="stat-note">attraverso altre società</span>
        </div>
      </div>

      <section className="panel">
        <h2 className="panel-title">Cerca nel registro ufficiale</h2>
        <form className={styles.searchForm} action="/enti" method="get">
          <label className={styles.visuallyHidden} htmlFor="q">
            Cerca un ente
          </label>
          <input
            className="input"
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Comune di Milano, Ministero dell'Interno, Regione Calabria, codice IPA…"
            autoComplete="off"
          />
          <button className="btn btn-primary" type="submit">
            <HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={1.7} aria-hidden="true" />
            Cerca ente
          </button>
        </form>
        <p className={styles.note}>
          La ricerca legge direttamente il registro IPA di AgID. Non usiamo nomi dimostrativi o un
          elenco scritto a mano.
        </p>
      </section>

      {query && !canSearch && (
        <div className="notice warning-notice">
          <strong>Scrivi almeno due caratteri</strong>
          <p>La ricerca parte dopo due caratteri per non sovraccaricare il servizio pubblico.</p>
        </div>
      )}

      {upstreamError && canSearch && !result && (
        <div className="notice warning-notice">
          <strong>La fonte IPA non risponde in questo momento</strong>
          <p>
            Non sostituiamo il dato ufficiale con un elenco inventato. Riprova più tardi oppure apri
            i dati AgID.
          </p>
        </div>
      )}

      {result && (
        <section className="panel">
          <div className={styles.resultsHead}>
            <h2 className="panel-title">
              {integer(result.total)} corrispondenze per “{query}”
            </h2>
            <span>Fino a 30 risultati per richiesta</span>
          </div>

          {result.records.length > 0 ? (
            <div className="table-scroll" role="region" aria-label="Risultati della ricerca enti" tabIndex={0}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Ente</th>
                    <th scope="col">Tipologia</th>
                    <th scope="col">Sede</th>
                    <th scope="col">Codice IPA</th>
                  </tr>
                </thead>
                <tbody>
                  {result.records.map((entity) => (
                    <tr key={entity.codiceIpa}>
                      <th scope="row">
                        <Link href={`/enti/${encodeURIComponent(entity.codiceIpa)}`}>
                          {entity.denominazione}
                        </Link>
                        {entity.acronimo || entity.inLiquidazione ? (
                          <small>
                            {entity.acronimo}
                            {entity.acronimo && entity.inLiquidazione ? " · " : ""}
                            {entity.inLiquidazione ? "in liquidazione" : ""}
                          </small>
                        ) : null}
                      </th>
                      <td>{entity.tipologia ?? "Non indicata"}</td>
                      <td>{locationLabel(entity.sede.indirizzo, entity.sede.cap)}</td>
                      <td>
                        <code>{entity.codiceIpa}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.note}>
              La ricerca non ha trovato corrispondenze nel registro IPA.
            </p>
          )}
        </section>
      )}

      {!query && centralAdministrations && (
        <section className="panel" id="amministrazioni-centrali">
          <div className={styles.resultsHead}>
            <h2 className="panel-title">Ministeri, Presidenza e Avvocatura</h2>
            <span>{integer(centralAdministrations.total)} enti · aggiornamento giornaliero</span>
          </div>
          <div className="table-scroll" role="region" aria-label="Principali enti pubblici" tabIndex={0}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Amministrazione</th>
                  <th scope="col">Categoria</th>
                  <th scope="col">Codice IPA</th>
                </tr>
              </thead>
              <tbody>
                {centralAdministrations.records.map((entity) => (
                  <tr key={entity.codiceIpa}>
                    <th scope="row">
                      <Link href={`/enti/${encodeURIComponent(entity.codiceIpa)}`}>
                        {entity.denominazione}
                      </Link>
                    </th>
                    <td>
                      {entity.codiceIpa === "PCM"
                        ? "Presidenza del Consiglio"
                        : entity.codiceNatura === "2220"
                          ? "Ministero"
                          : "Amministrazione centrale"}
                    </td>
                    <td>
                      <code>{entity.codiceIpa}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!query && !centralAdministrations && (
        <div className="notice warning-notice">
          <strong>L&apos;elenco delle amministrazioni centrali non è disponibile ora</strong>
          <p>
            La ricerca IPA resta utilizzabile; non sostituiamo l&apos;elenco ufficiale con una lista
            statica.
          </p>
        </div>
      )}

      <div className={styles.split}>
        <section className="panel">
          <div className={styles.resultsHead}>
            <h2 className="panel-title">Il registro IPA in numeri</h2>
            <span>dati AgID</span>
          </div>
          <strong className={styles.bigNumber}>
            {stats ? integer(stats.total) : "Non disponibile"}
          </strong>
          <p className={styles.note}>
            Enti presenti nel registro IPA. Controllato il{" "}
            {observedAtLabel(stats?.observedAt ?? distributionObservedAt)}.
          </p>
          <RegistryTypeChart data={distribution} />
        </section>

        <section className="panel">
          <h2 className="panel-title">Cosa dichiarano gli enti</h2>
          <dl className={styles.evidence}>
            <div>
              <dt>Quote con controllo diretto (analogo)</dt>
              <dd>{integer(participations.declaredEvidence.analogControlRecords)}</dd>
            </div>
            <div>
              <dt>Quote con affidamenti diretti</dt>
              <dd>{integer(participations.declaredEvidence.directAwardRecords)}</dd>
            </div>
            <div>
              <dt>Entrambi i segnali</dt>
              <dd>{integer(participations.declaredEvidence.bothSignalsRecords)}</dd>
            </div>
          </dl>
          <p className={styles.note}>{participations.declaredEvidence.legalMeaning}</p>

          <details className={styles.details}>
            <summary>Cosa sono le partecipate</summary>
            <p>
              Sono società di cui un ente pubblico possiede una quota: acquedotti, rifiuti,
              trasporti, informatica. Ogni anno gli enti dichiarano le loro quote al MEF; questa è
              la fotografia al {longDate(participations.referenceDate)} (
              {integer(participations.totals.participationRecords)} dichiarazioni).
            </p>
          </details>
        </section>
      </div>

      <section className="panel">
        <div className={styles.resultsHead}>
          <h2 className="panel-title">Le società con più enti soci</h2>
          <Link href="/partecipazioni">Tutte le partecipazioni →</Link>
        </div>
        <div className="table-scroll" role="region" aria-label="Partecipazioni pubbliche" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Società</th>
                <th scope="col">Codice fiscale</th>
                <th scope="col" className="num">Enti soci</th>
              </tr>
            </thead>
            <tbody>
              {participations.topCompaniesByDeclaringAdministrations.map((company) => (
                <tr key={company.taxCode}>
                  <th scope="row">{company.name}</th>
                  <td>
                    <code>{company.taxCode}</code>
                  </td>
                  <td className="num">{integer(company.declaringAdministrations)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Quasi tutte gestiscono servizi condivisi tra molti Comuni: acqua, energia, informatica,
          riscossione. Per questo hanno centinaia di enti soci.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">Fonti</h2>
        <dl className={styles.sourceGrid}>
          <div>
            <dt>Registro degli enti</dt>
            <dd>
              <a href={IPA_ENTI_DATASET_URL} target="_blank" rel="noreferrer">
                IPA · AgID ↗
              </a>
            </dd>
          </div>
          <div>
            <dt>Identificativo del file</dt>
            <dd>
              <code>{IPA_ENTI_RESOURCE_ID}</code>
            </dd>
          </div>
          <div>
            <dt>Licenza IPA</dt>
            <dd>{IPA_LICENSE}</dd>
          </div>
          <div>
            <dt>Partecipazioni</dt>
            <dd>
              <a href={participations.source.landingUrl} target="_blank" rel="noreferrer">
                MEF · open data {participations.referenceYear} ↗
              </a>
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
