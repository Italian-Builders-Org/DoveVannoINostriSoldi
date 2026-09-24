import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { integer, longDate } from "@/lib/format";
import { anacCigDetailUrl } from "@/lib/anac-operator-award-insights";
import {
  getOperatorHistory,
  readOperatorHistoryAwards,
} from "@/lib/data/anac-operator-history";
import {
  isAnacOperatorRef,
  loadAnacOperatorIndexMeta,
} from "@/lib/data/anac-operator-awards-index";
import {
  parseOperatorHistorySearch,
  operatorHistoryHref,
  selectOperatorHistoryPage,
  type OperatorHistoryQuery,
} from "@/lib/anac-operator-history-query";
import styles from "../operatori.module.css";

type PageProps = {
  params: Promise<{ ref: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatDecimalEuro(value: string | null): string {
  if (value === null) return "n.d.";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function yearRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return "anni non disponibili";
  if (min === max) return String(min);
  return `${min ?? "?"}-${max ?? "?"}`;
}

function amountStatusLabel(status: string): string {
  switch (status) {
    case "positive-exact-cent":
      return "positivo (centesimi)";
    case "positive-subcent":
      return "positivo (oltre 2 decimali)";
    case "zero":
      return "zero";
    case "negative":
      return "negativo in fonte";
    case "missing":
      return "mancante in fonte";
    case "invalid":
      return "non valido in fonte";
    case "conflicting":
      return "conflittuale in fonte";
    default:
      return status;
  }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { ref } = await params;
  if (!isAnacOperatorRef(ref)) {
    return {
      title: "Operatore non trovato",
      robots: { index: false, follow: false },
    };
  }
  const operator = getOperatorHistory(ref);
  if (!operator) {
    return {
      title: "Operatore non trovato",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: `${operator.name} · aggiudicazioni ANAC`,
    description: `Aggiudicazioni ANAC per ${operator.name}: conteggi e importi di aggiudicazione dichiarati.`,
    robots: { index: false, follow: false },
  };
}

export default async function OperatoreDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { ref } = await params;
  if (!isAnacOperatorRef(ref)) notFound();
  const operator = getOperatorHistory(ref);
  if (!operator) notFound();
  const meta = loadAnacOperatorIndexMeta();
  const screening = operator.screening2025;
  const raw = await searchParams;
  let query: OperatorHistoryQuery;
  let page: ReturnType<typeof selectOperatorHistoryPage>;
  try {
    query = parseOperatorHistorySearch(raw);
    page = selectOperatorHistoryPage(operator, query);
  } catch {
    return (
      <main className="shell page">
        <h1>Filtri non validi</h1>
        <p>Controlla anno, pagina e intervallo degli importi.</p>
        <Link prefetch={false} href={`/appalti/operatori/${ref}`}>Rimuovi i filtri</Link>
      </main>
    );
  }
  if (page.page > Math.max(1, page.pageCount)) {
    redirect(
      operatorHistoryHref(ref, { ...query, page: Math.max(1, page.pageCount) }),
    );
  }
  const awards = readOperatorHistoryAwards(operator, page.positions);
  const href = (number: number) =>
    operatorHistoryHref(ref, { ...query, page: number });
  const procedures = [
    ...new Set(
      operator.detail.filterRows
        .map((row) => row[2])
        .filter((value): value is string => value !== null),
    ),
  ].sort();
  return (
    <main className={`shell page ${styles.page}`}>
      <nav aria-label="Percorso">
        <Link prefetch={false} href="/appalti">Appalti pubblici</Link> /{" "}
        <Link prefetch={false} href="/appalti/operatori">Imprese aggiudicatarie</Link> / Scheda
      </nav>
      <div className="page-intro">
        <h1>{operator.name}</h1>
        <p>
          Aggiudicazioni ANAC · {yearRange(operator.yearMin, operator.yearMax)}
        </p>
      </div>
      <div
        className={`stat-strip ${styles.stats}`}
        aria-label="Riepilogo operatore"
      >
        <div>
          <span className="stat-label">Aggiudicazioni</span>
          <strong className="stat-value">{integer(operator.awardCount)}</strong>
        </div>
        <div>
          <span className="stat-label">Valore attribuibile</span>
          <strong className="stat-value">
            {formatDecimalEuro(
              operator.attributedAwardCount ? operator.attributedValue : null,
            )}
          </strong>
          <span className="stat-note">
            {integer(operator.attributedAwardCount)} aggiudicazioni a operatore
            unico
          </span>
        </div>
        <div>
          <span className="stat-label">Enti distinti identificati</span>
          <strong className="stat-value">
            {integer(operator.distinctContractingAuthorityCount)}
          </strong>
          <span className="stat-note">
            {integer(operator.awardsWithoutAuthority)} aggiudicazioni senza ente
            identificato
          </span>
        </div>
      </div>
      <section className="panel" aria-labelledby="screening-title">
        <h2 id="screening-title">Servizi e forniture 2025</h2>
        {screening.classifiableCigs > 0 ? (
          <p>
            <strong>
              {integer(screening.below140000)} /{" "}
              {integer(screening.classifiableCigs)}
            </strong>{" "}
            CIG classificabili con importo lotto positivo inferiore a €140.000.
          </p>
        ) : (
          <p>Nessun CIG 2025 classificabile in questo perimetro.</p>
        )}
        <p>
          Da €135.000 a meno di €140.000:{" "}
          <strong>{integer(screening.band135000To140000)}</strong>. Affidamento
          diretto tra quelli inferiori a €140.000:{" "}
          <strong>{integer(screening.directBelow140000)}</strong>.
        </p>
        <details className={styles.exactDetails}>
          <summary>Perimetro e limiti dello screening</summary>
          <p>
            CIG unici, prevalenti, attivi, con categoria servizi o forniture e
            modalità «CONTRATTO D’APPALTO». L’anno è quello del CIG, non della
            data di aggiudicazione. {integer(screening.excludedCigs)} dei{" "}
            {integer(screening.matchedCigs)} CIG 2025 abbinati sono esclusi dal
            denominatore per categoria, stato, modalità o importo non
            classificabile.
          </p>
          <p>
            Procedura mancante tra i CIG inferiori a €140.000:{" "}
            {integer(screening.missingProcedureBelow140000)}. Lo screening usa
            l’importo lotto, distinto dall’importo di aggiudicazione. È
            descrittivo e non valuta la legittimità; frequenza e vicinanza a una
            soglia non dimostrano illeciti. Nessuna soglia unica viene applicata
            allo storico.
          </p>
          <Link prefetch={false} href="/appalti">Analisi dei CIG 2025</Link>
        </details>
      </section>
      <section aria-labelledby="history-title">
        <h2 id="history-title">Tutte le aggiudicazioni</h2>
        <form
          className={styles.historyFilters}
          aria-label="Filtri delle aggiudicazioni"
          action={`/appalti/operatori/${ref}`}
        >
          <label>
            Anno di aggiudicazione
            <select name="year" defaultValue={query.year ?? ""}>
              <option value="">Tutti</option>
              {operator.yearly.map((row) => (
                <option
                  key={row.year ?? "missing"}
                  value={row.year ?? "missing"}
                >
                  {row.year ?? "Data non disponibile"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Stazione appaltante
            <select name="authority" defaultValue={query.authority ?? ""}>
              <option value="">Tutte</option>
              {operator.authorities.map((row) => (
                <option key={row.ref} value={row.ref}>
                  {row.label ?? row.ref} ({integer(row.awardCount)})
                </option>
              ))}
            </select>
          </label>
          <label>
            Procedura
            <select name="procedure" defaultValue={query.procedure ?? ""}>
              <option value="">Tutte</option>
              {procedures.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Importo minimo (€)
            <input
              name="minAmount"
              type="number"
              min="0"
              step="any"
              defaultValue={query.minAmount}
            />
          </label>
          <label>
            Importo massimo (€)
            <input
              name="maxAmount"
              type="number"
              min="0"
              step="any"
              defaultValue={query.maxAmount}
            />
          </label>
          <button className="btn" type="submit">
            Filtra
          </button>
          <Link prefetch={false} href={`/appalti/operatori/${ref}`}>Azzera filtri</Link>
        </form>
        <p className={styles.note}>
          {integer(page.total)} risultati su {integer(operator.awardCount)}{" "}
          aggiudicazioni. Gli importi filtrati e mostrati sono quelli di
          aggiudicazione, non pagamenti.
        </p>
        {awards.length ? (
          <div
            className="table-scroll"
            role="region"
            aria-label="Tabella aggiudicazioni"
            tabIndex={0}
          >
            <table className="table">
              <caption>
                Aggiudicazioni, dalla data più recente; date mancanti in fondo
              </caption>
              <thead>
                <tr>
                  <th scope="col">CIG / data</th>
                  <th scope="col">Oggetto e stazione appaltante</th>
                  <th scope="col">Procedura</th>
                  <th scope="col" className="num">
                    Importo dichiarato
                  </th>
                  <th scope="col">Attribuzione</th>
                </tr>
              </thead>
              <tbody>
                {awards.map((award) => {
                  const url = anacCigDetailUrl(award.cig);
                  return (
                    <tr key={`${award.cig}-${award.awardId}`}>
                      <th scope="row">
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer">
                            {award.cig} ↗
                          </a>
                        ) : (
                          award.cig
                        )}
                        <div className={styles.note}>
                          {award.awardedAt
                            ? longDate(award.awardedAt)
                            : "Data n.d."}
                        </div>
                      </th>
                      <td>
                        {award.procedure?.description ?? "Oggetto n.d."}
                        <div className={styles.note}>
                          {award.procedure?.authorityLabel ??
                            "Stazione appaltante n.d."}
                        </div>
                        {award.procedure?.cpvCode ? (
                          <div className={styles.note}>
                            CPV {award.procedure.cpvCode} ·{" "}
                            {award.procedure.cpvLabel}
                          </div>
                        ) : null}
                      </td>
                      <td>{award.procedure?.procedure ?? "n.d."}</td>
                      <td className="num">
                        {formatDecimalEuro(award.amount)}
                        <div className={styles.note}>
                          {amountStatusLabel(award.amountStatus)}
                        </div>
                      </td>
                      <td>
                        {award.attribution === "single-operator"
                          ? "Unico operatore identificato"
                          : "Multi-operatore"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            Nessuna aggiudicazione in questa pagina con i filtri selezionati.
          </p>
        )}
        {page.pageCount > 0 ? (
          <nav
            className={styles.paginationRow}
            aria-label="Pagine aggiudicazioni"
          >
            {page.page > 1 ? <Link prefetch={false} href={href(1)}>Prima</Link> : null}
            {page.page > 1 ? (
              <Link prefetch={false} href={href(Math.min(page.page - 1, page.pageCount))}>
                Precedente
              </Link>
            ) : null}
            <span className={styles.pageStatus}>
              Pagina {integer(page.page)} di {integer(page.pageCount)}
            </span>
            {page.page < page.pageCount ? (
              <Link prefetch={false} href={href(page.page + 1)}>Successiva</Link>
            ) : null}
            {page.page < page.pageCount ? (
              <Link prefetch={false} href={href(page.pageCount)}>Ultima</Link>
            ) : null}
            {page.pageCount > 1 ? (
              <form
                className={styles.pageJump}
                action={`/appalti/operatori/${ref}`}
              >
                {Object.entries(query)
                  .filter(
                    ([key, value]) => key !== "page" && value !== undefined,
                  )
                  .map(([key, value]) => (
                    <input
                      key={key}
                      type="hidden"
                      name={key}
                      value={String(value)}
                    />
                  ))}
                <label>
                  Vai alla pagina
                  <input
                    name="page"
                    type="number"
                    min="1"
                    max={page.pageCount}
                    defaultValue={page.page}
                    required
                  />
                </label>
                <button className="btn" type="submit">
                  Vai
                </button>
              </form>
            ) : null}
          </nav>
        ) : null}
      </section>
      <section aria-labelledby="yearly-title">
        <h2 id="yearly-title">Andamento annuale</h2>
        <div
          className="table-scroll"
          role="region"
          aria-label="Serie annuale"
          tabIndex={0}
        >
          <table className="table">
            <caption>Anno della data di aggiudicazione</caption>
            <thead>
              <tr>
                <th scope="col">Anno</th>
                <th scope="col" className="num">
                  Aggiudicazioni
                </th>
                <th scope="col" className="num">
                  Con valore attribuibile
                </th>
                <th scope="col" className="num">
                  Valore attribuibile
                </th>
              </tr>
            </thead>
            <tbody>
              {operator.yearly.map((row) => (
                <tr key={row.year ?? "missing"}>
                  <th scope="row">{row.year ?? "Data n.d."}</th>
                  <td className="num">{integer(row.awardCount)}</td>
                  <td className="num">{integer(row.attributedAwardCount)}</td>
                  <td className="num">
                    {formatDecimalEuro(row.attributedValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="authorities-title">
        <h2 id="authorities-title">Stazioni appaltanti ricorrenti</h2>
        <p>
          {integer(operator.distinctContractingAuthorityCount)} enti distinti
          identificati sull’intera storia abbinata ai CIG.{" "}
          {integer(operator.awardsWithoutAuthority)} aggiudicazioni senza
          identità dell’ente; {integer(operator.awardsWithoutCigMatch)} senza
          CIG abbinato.
        </p>
        <ol>
          {operator.authorities.slice(0, 10).map((row) => (
            <li key={row.ref}>
              <Link prefetch={false} href={operatorHistoryHref(ref, { authority: row.ref })}>
                {row.label ?? row.ref}
              </Link>{" "}
              · {integer(row.awardCount)} aggiudicazioni
            </li>
          ))}
        </ol>
        {operator.authorities.length > 10 ? (
          <p className={styles.note}>
            Mostrati i primi 10 enti. Tutti gli enti identificati sono
            disponibili nel filtro stazione appaltante.
          </p>
        ) : null}
      </section>
      <details className={`panel ${styles.exactDetails}`}>
        <summary>Fonti e metodo</summary>
        <p>
          Snapshot ANAC osservato il {meta.observedAt.slice(0, 10)}. Licenza CC
          BY-SA 4.0. Aggiudicazioni e aggiudicatari completi, abbinati ai CIG
          annuali dal 2007 al 2025. Ogni collegamento CIG apre la fonte
          ufficiale ANAC.
        </p>
        <p>
          Il valore attribuibile somma solo importi validi non negativi delle
          aggiudicazioni a unico operatore identificato. I contratti
          multi-operatore restano nei conteggi senza assegnare l’intero valore a
          ciascun soggetto. Importi mancanti, invalidi o conflittuali restano
          non disponibili. Le serie non rappresentano pagamenti.
        </p>
        <p>
          Gli enti sono distinti mediante l’identificativo in fonte, non la
          denominazione. Gli identificativi fiscali non sono pubblicati.
          Varianti del nome operatore osservate:{" "}
          {integer(operator.nameVariants)}.
        </p>
      </details>
    </main>
  );
}
