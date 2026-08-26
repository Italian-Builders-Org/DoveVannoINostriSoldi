import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import Pagination from "@/components/pagination";
import { exactEuro, integer, longDate } from "@/lib/format";
import { municipalityName } from "@/lib/municipality-name";
import { openCivitasSnapshot } from "@/lib/opencivitas-snapshot";
import type { OpenCivitasMunicipality } from "@/lib/data/opencivitas-contract";
import styles from "./confronto.module.css";

export const metadata: Metadata = {
  title: "Spesa e fabbisogno standard dei Comuni",
  description:
    "Confronto ufficiale OpenCivitas tra spesa storica, fabbisogno standard e servizi dei Comuni delle Regioni a statuto ordinario.",
};

const PAGE_SIZE = 50;

const SORT_OPTIONS = {
  comune: {
    label: "Comune, dalla A alla Z",
    compare: (left: OpenCivitasMunicipality, right: OpenCivitasMunicipality) =>
      left.name.localeCompare(right.name, "it-IT"),
  },
  differenza: {
    label: "Differenza totale più alta",
    compare: (left: OpenCivitasMunicipality, right: OpenCivitasMunicipality) =>
      right.differenceCents - left.differenceCents,
  },
  "per-abitante": {
    label: "Differenza per abitante più alta",
    compare: (left: OpenCivitasMunicipality, right: OpenCivitasMunicipality) =>
      right.differencePerCapitaCents - left.differencePerCapitaCents,
  },
  percentuale: {
    label: "Differenza percentuale più alta",
    compare: (left: OpenCivitasMunicipality, right: OpenCivitasMunicipality) =>
      right.differenceBasisPoints - left.differenceBasisPoints,
  },
  servizi: {
    label: "Servizi rispetto a Comuni simili",
    compare: (left: OpenCivitasMunicipality, right: OpenCivitasMunicipality) =>
      nullableDescending(
        left.serviceDifferenceBasisPoints,
        right.serviceDifferenceBasisPoints,
      ),
  },
} as const;

type SortKey = keyof typeof SORT_OPTIONS;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("it-IT");
}

function nullableDescending(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function selectedSort(value: string): SortKey {
  return value in SORT_OPTIONS ? (value as SortKey) : "per-abitante";
}

function selectedPage(value: string): number {
  return /^\d+$/.test(value) ? Math.max(1, Number.parseInt(value, 10)) : 1;
}

function signedEuro(cents: number): string {
  const prefix = cents > 0 ? "+" : "";
  return `${prefix}${exactEuro(cents / 100)}`;
}

function signedPercent(basisPoints: number | null): string {
  if (basisPoints === null) return "n.d.";
  const prefix = basisPoints > 0 ? "+" : "";
  return `${prefix}${new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: "always",
  }).format(basisPoints / 100)}%`;
}

function pageUrl({
  query,
  region,
  sort,
  page,
}: {
  query: string;
  region: string;
  sort: SortKey;
  page: number;
}): string {
  const params = new URLSearchParams();
  if (query) params.set("comune", query);
  if (region) params.set("regione", region);
  if (sort !== "per-abitante") params.set("ordine", sort);
  if (page > 1) params.set("pagina", String(page));
  const search = params.toString();
  return search ? `/territori/confronto?${search}` : "/territori/confronto";
}

export default async function MunicipalComparisonPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const query = first(params.comune).trim().slice(0, 100);
  const requestedRegion = first(params.regione).trim().toLocaleUpperCase("it-IT");
  const sort = selectedSort(first(params.ordine));
  const requestedPage = selectedPage(first(params.pagina));
  const regions = openCivitasSnapshot.coverage.regionNames;
  const region = regions.includes(requestedRegion) ? requestedRegion : "";
  const normalizedQuery = normalized(query);

  const filtered = openCivitasSnapshot.municipalities
    .filter((municipality) => {
      if (region && municipality.region !== region) return false;
      if (!normalizedQuery) return true;
      return normalized(municipality.name).includes(normalizedQuery);
    })
    .sort((left, right) => {
      const comparison = SORT_OPTIONS[sort].compare(left, right);
      return comparison || left.istatCode.localeCompare(right.istatCode);
    });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const municipalities = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const firstResult = filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastResult = Math.min(page * PAGE_SIZE, filtered.length);

  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Spesa dei Comuni e fabbisogno standard</h1>
        <p>
          Confrontiamo quanto un Comune ha speso con il fabbisogno standard
          calcolato da OpenCivitas. La differenza va letta insieme ai servizi
          offerti e alle caratteristiche del territorio.
        </p>
      </div>

      <dl className="stat-strip">
        <div>
          <dt>Anno dei dati</dt>
          <dd>{openCivitasSnapshot.referenceYear}</dd>
          <small className="stat-note">Unica annualità integrata</small>
        </div>
        <div>
          <dt>Comuni coperti</dt>
          <dd>{integer(openCivitasSnapshot.coverage.municipalities)}</dd>
          <small className="stat-note">Regioni a statuto ordinario</small>
        </div>
        <div>
          <dt>Regioni coperte</dt>
          <dd>{integer(openCivitasSnapshot.coverage.regions)}</dd>
          <small className="stat-note">Su un perimetro di 15 Regioni</small>
        </div>
        <div>
          <dt>Pubblicato</dt>
          <dd>{longDate(`${openCivitasSnapshot.publishedAt}T00:00:00Z`)}</dd>
          <small className="stat-note">Data indicata dalla fonte</small>
        </div>
      </dl>

      <div className="notice">
        <strong>Come leggere il confronto</strong>
        <p>
          Se la differenza è positiva, la spesa storica supera il fabbisogno standard. Può dipendere
          da servizi, costi locali o uso delle risorse. Il numero da solo non spiega il perché.
        </p>
      </div>

      <section className="panel" aria-labelledby="filters-title">
        <h2 className="panel-title" id="filters-title">
          Cerca e ordina i Comuni
        </h2>
        <Form action="/territori/confronto" className={styles.filters}>
          <label>
            <span>Comune</span>
            <input
              className="input"
              defaultValue={query}
              maxLength={100}
              name="comune"
              placeholder="Per esempio, Bologna"
              type="search"
            />
          </label>
          <label>
            <span>Regione</span>
            <select className="input" defaultValue={region} name="regione">
              <option value="">Tutte le Regioni coperte</option>
              {regions.map((regionName) => (
                <option key={regionName} value={regionName}>
                  {municipalityName(regionName)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Ordina per</span>
            <select className="input" defaultValue={sort} name="ordine">
              {Object.entries(SORT_OPTIONS).map(([value, option]) => (
                <option key={value} value={value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.filterActions}>
            <button className="btn btn-primary" type="submit">
              Applica
            </button>
            <Link className="btn btn-secondary" href="/territori/confronto">
              Azzera
            </Link>
          </div>
        </Form>
      </section>

      <section className="panel" aria-labelledby="results-title">
        <div className={styles.resultsHeader}>
          <div>
            <h2 className="panel-title" id="results-title">
              Confronto tra spesa storica e fabbisogno standard
            </h2>
            <p id="results-summary">
              {filtered.length === 0
                ? "Nessun Comune corrisponde ai filtri scelti."
                : `Risultati ${integer(firstResult)}-${integer(lastResult)} su ${integer(filtered.length)} Comuni.`}
            </p>
          </div>
          <span>Dati {openCivitasSnapshot.referenceYear}</span>
        </div>

        {municipalities.length > 0 ? (
          <div
            aria-describedby="comparison-method results-summary"
            aria-label="Tabella dei Comuni. Scorri orizzontalmente per vedere tutte le colonne."
            className={`table-scroll ${styles.tableRegion}`}
            role="region"
            tabIndex={0}
          >
            <table className={`table ${styles.table}`}>
              <caption>
                Spesa storica, fabbisogno standard e servizi dei Comuni nel
                2022
              </caption>
              <thead>
                <tr>
                  <th scope="col">Comune</th>
                  <th className="num" scope="col">Spesa storica</th>
                  <th className="num" scope="col">Fabbisogno standard</th>
                  <th className="num" scope="col">Differenza</th>
                  <th className="num" scope="col">Per abitante</th>
                  <th className="num" scope="col">Differenza %</th>
                  <th className="num" scope="col">Servizi vs Comuni simili</th>
                </tr>
              </thead>
              <tbody>
                {municipalities.map((municipality) => (
                  <tr key={municipality.istatCode}>
                    <th scope="row">
                      {municipalityName(municipality.name)}
                      <small>
                        {municipalityName(municipality.province)} ·{" "}
                        {municipalityName(municipality.region)}
                      </small>
                      {municipality.sourceWarnings.length > 0 ? (
                        <span className={styles.sourceWarning}>
                          Dato segnalato dalla fonte
                        </span>
                      ) : null}
                    </th>
                    <td className="num">
                      {exactEuro(municipality.historicalSpendingCents / 100)}
                    </td>
                    <td className="num">
                      {exactEuro(municipality.standardSpendingCents / 100)}
                    </td>
                    <td className={`num ${styles.difference}`}>
                      {signedEuro(municipality.differenceCents)}
                    </td>
                    <td className="num">
                      {signedEuro(municipality.differencePerCapitaCents)}
                    </td>
                    <td className="num">
                      {signedPercent(municipality.differenceBasisPoints)}
                    </td>
                    <td className="num">
                      {municipality.sourceWarnings.length > 0
                        ? "da verificare"
                        : signedPercent(municipality.serviceDifferenceBasisPoints)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <p>Prova a cambiare il nome del Comune o a scegliere un’altra Regione.</p>
            <Link className="btn btn-secondary" href="/territori/confronto">
              Mostra tutti i Comuni
            </Link>
          </div>
        )}

        <p className={styles.method} id="comparison-method">
          La differenza è spesa storica meno fabbisogno standard. Per confrontare
          Comuni di dimensioni diverse guarda anche il valore per abitante e i
          servizi rispetto ai Comuni della stessa fascia di popolazione.
        </p>

        <Pagination
          label="Pagine dei risultati"
          page={page}
          pageCount={pageCount}
          summary={
            filtered.length > 0
              ? `Comuni ${integer(firstResult)}-${integer(lastResult)} di ${integer(filtered.length)}`
              : undefined
          }
          hrefForPage={(target) => pageUrl({ query, region, sort, page: target })}
          jump={{
            action: "/territori/confronto",
            pageParam: "pagina",
            fields: {
              ...(query ? { comune: query } : {}),
              ...(region ? { regione: region } : {}),
              ...(sort !== "per-abitante" ? { ordine: sort } : {}),
            },
          }}
        />
      </section>

      <section className="panel" aria-labelledby="source-title">
        <h2 className="panel-title" id="source-title">
          Fonte e copertura
        </h2>
        <div className={styles.provenance}>
          <dl>
            <div>
              <dt>Fonte</dt>
              <dd>{openCivitasSnapshot.source.owner}</dd>
            </div>
            <div>
              <dt>Dataset</dt>
              <dd>{openCivitasSnapshot.source.dataset}</dd>
            </div>
            <div>
              <dt>Periodo dei dati</dt>
              <dd>{openCivitasSnapshot.referenceYear}</dd>
            </div>
            <div>
              <dt>Pubblicato</dt>
              <dd>{longDate(`${openCivitasSnapshot.publishedAt}T00:00:00Z`)}</dd>
            </div>
            <div>
              <dt>Scaricato da noi</dt>
              <dd>{longDate(openCivitasSnapshot.source.observedAt)}</dd>
            </div>
            <div>
              <dt>Controllo della fonte</dt>
              <dd>{openCivitasSnapshot.source.platformCheckCadence}</dd>
            </div>
            <div>
              <dt>Copertura</dt>
              <dd>{openCivitasSnapshot.coverage.territorialScope}</dd>
            </div>
            <div>
              <dt>Licenza</dt>
              <dd>{openCivitasSnapshot.source.license}</dd>
            </div>
          </dl>
          <div>
            <p>{openCivitasSnapshot.methodology.coverageWarning}</p>
            <p>{openCivitasSnapshot.methodology.rankingWarning}</p>
            <a
              className="btn btn-secondary"
              href={openCivitasSnapshot.source.datasetUrl}
              rel="noreferrer"
              target="_blank"
            >
              Apri il dataset ufficiale
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
