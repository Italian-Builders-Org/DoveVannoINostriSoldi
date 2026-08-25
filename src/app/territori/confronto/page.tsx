import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import Pagination from "@/components/pagination";
import { exactEuro, integer, longDate } from "@/lib/format";
import { municipalityName } from "@/lib/municipality-name";
import { openCivitasSnapshot } from "@/lib/opencivitas-snapshot";
import type { OpenCivitasMunicipality } from "@/lib/data/opencivitas-contract";
import {
  eurosPerSquareKilometreCents,
  getMunicipalityGeographyByIstatCode,
  type MunicipalityGeography,
} from "@/lib/municipality-geography";
import styles from "./confronto.module.css";

export const metadata: Metadata = {
  title: "Spesa e fabbisogno standard dei Comuni",
  description:
    "Confronto ufficiale OpenCivitas tra spesa storica, fabbisogno standard e servizi dei Comuni delle Regioni a statuto ordinario.",
};

const PAGE_SIZE = 50;

type TerritorialMunicipality = OpenCivitasMunicipality & {
  geography: MunicipalityGeography | null;
  differencePerSquareKmCents: number | null;
};

const SORT_OPTIONS = {
  comune: {
    label: "Comune, dalla A alla Z",
    compare: (left: TerritorialMunicipality, right: TerritorialMunicipality) =>
      left.name.localeCompare(right.name, "it-IT"),
  },
  differenza: {
    label: "Differenza totale più alta",
    compare: (left: TerritorialMunicipality, right: TerritorialMunicipality) =>
      right.differenceCents - left.differenceCents,
  },
  "per-abitante": {
    label: "Differenza per abitante più alta",
    compare: (left: TerritorialMunicipality, right: TerritorialMunicipality) =>
      right.differencePerCapitaCents - left.differencePerCapitaCents,
  },
  "per-km2": {
    label: "Differenza per km² più alta",
    compare: (left: TerritorialMunicipality, right: TerritorialMunicipality) =>
      nullableDescending(left.differencePerSquareKmCents, right.differencePerSquareKmCents),
  },
  percentuale: {
    label: "Differenza percentuale più alta",
    compare: (left: TerritorialMunicipality, right: TerritorialMunicipality) =>
      right.differenceBasisPoints - left.differenceBasisPoints,
  },
  servizi: {
    label: "Servizi rispetto a Comuni simili",
    compare: (left: TerritorialMunicipality, right: TerritorialMunicipality) =>
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

const TERRITORIAL_FILTER_VALUES = {
  superficie: ["meno-10", "10-50", "50-200", "200-500", "oltre-500"],
  densita: ["meno-100", "100-300", "oltre-300"],
  altimetria: ["1", "2", "3", "4", "5"],
  urbanizzazione: ["1", "2", "3"],
  litoraneo: ["si", "no"],
  isola: ["si", "no"],
} as const;

type TerritorialFilterKey = keyof typeof TERRITORIAL_FILTER_VALUES;
type TerritorialFilters = Record<TerritorialFilterKey, string>;

function territorialFiltersFrom(params: Record<string, string | string[] | undefined>): TerritorialFilters {
  return Object.fromEntries(Object.entries(TERRITORIAL_FILTER_VALUES).map(([key, values]) => {
    const value = first(params[key]);
    return [key, (values as readonly string[]).includes(value) ? value : ""];
  })) as TerritorialFilters;
}

function matchesTerritorialFilters(geography: MunicipalityGeography | null, filters: TerritorialFilters): boolean {
  if (!Object.values(filters).some(Boolean)) return true;
  if (!geography) return false;
  const surface = geography.surfaceSquareKilometres;
  if (filters.superficie === "meno-10" && surface >= 10) return false;
  if (filters.superficie === "10-50" && (surface < 10 || surface >= 50)) return false;
  if (filters.superficie === "50-200" && (surface < 50 || surface >= 200)) return false;
  if (filters.superficie === "200-500" && (surface < 200 || surface >= 500)) return false;
  if (filters.superficie === "oltre-500" && surface < 500) return false;
  const density = geography.densityPerSquareKilometre;
  if (filters.densita && density === null) return false;
  if (filters.densita === "meno-100" && density! >= 100) return false;
  if (filters.densita === "100-300" && (density! < 100 || density! >= 300)) return false;
  if (filters.densita === "oltre-300" && density! < 300) return false;
  if (filters.altimetria && String(geography.altimetricZone) !== filters.altimetria) return false;
  if (filters.urbanizzazione && String(geography.degreeUrbanization) !== filters.urbanizzazione) return false;
  if (filters.litoraneo && geography.coastal !== (filters.litoraneo === "si")) return false;
  if (filters.isola && geography.island !== (filters.isola === "si")) return false;
  return true;
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
  territorialFilters,
  page,
}: {
  query: string;
  region: string;
  sort: SortKey;
  territorialFilters: TerritorialFilters;
  page: number;
}): string {
  const params = new URLSearchParams();
  if (query) params.set("comune", query);
  if (region) params.set("regione", region);
  if (sort !== "per-abitante") params.set("ordine", sort);
  for (const [key, value] of Object.entries(territorialFilters)) {
    if (value) params.set(key, value);
  }
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
  const territorialFilters = territorialFiltersFrom(params);
  const requestedPage = selectedPage(first(params.pagina));
  const regions = openCivitasSnapshot.coverage.regionNames;
  const region = regions.includes(requestedRegion) ? requestedRegion : "";
  const normalizedQuery = normalized(query);

  const filtered = openCivitasSnapshot.municipalities
    .map((municipality): TerritorialMunicipality => {
      const geography = getMunicipalityGeographyByIstatCode(
        openCivitasSnapshot.referenceYear,
        municipality.istatCode,
      );
      return {
        ...municipality,
        geography,
        differencePerSquareKmCents: eurosPerSquareKilometreCents(
          municipality.differenceCents,
          geography?.surfaceSquareMetres ?? null,
        ),
      };
    })
    .filter((municipality) => {
      if (region && municipality.region !== region) return false;
      if (!matchesTerritorialFilters(municipality.geography, territorialFilters)) return false;
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
          Una differenza positiva indica che la spesa storica è superiore al
          fabbisogno standard. Può dipendere dai servizi offerti, dai costi
          locali o dal modo in cui sono usate le risorse. Il numero, da solo,
          non permette di scegliere una spiegazione.
        </p>
      </div>

      <section className="panel" aria-labelledby="filters-title">
        <h2 className="panel-title" id="filters-title">
          Affina il confronto
        </h2>
        <Form action="/territori/confronto" className={styles.filters}>
          <div className={styles.primaryFilters}>
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
          </div>
          <details
            className={styles.territorialFilters}
            open={Object.values(territorialFilters).some(Boolean) || undefined}
          >
            <summary>Caratteristiche territoriali</summary>
            <div className={styles.territorialFilterGrid}>
              <label><span>Superficie</span><select className="input" defaultValue={territorialFilters.superficie} name="superficie"><option value="">Qualsiasi superficie</option><option value="meno-10">Meno di 10 km²</option><option value="10-50">Da 10 a 49,99 km²</option><option value="50-200">Da 50 a 199,99 km²</option><option value="200-500">Da 200 a 499,99 km²</option><option value="oltre-500">500 km² o più</option></select></label>
              <label><span>Densità</span><select className="input" defaultValue={territorialFilters.densita} name="densita"><option value="">Qualsiasi densità</option><option value="meno-100">Meno di 100 ab./km²</option><option value="100-300">Da 100 a 299,99 ab./km²</option><option value="oltre-300">300 ab./km² o più</option></select></label>
              <label><span>Altimetria</span><select className="input" defaultValue={territorialFilters.altimetria} name="altimetria"><option value="">Qualsiasi zona</option><option value="1">Montagna interna</option><option value="2">Montagna litoranea</option><option value="3">Collina interna</option><option value="4">Collina litoranea</option><option value="5">Pianura</option></select></label>
              <label><span>Urbanizzazione</span><select className="input" defaultValue={territorialFilters.urbanizzazione} name="urbanizzazione"><option value="">Qualsiasi grado</option><option value="1">Area densamente popolata</option><option value="2">Densità intermedia</option><option value="3">Area rurale</option></select></label>
              <label><span>Litoraneità</span><select className="input" defaultValue={territorialFilters.litoraneo} name="litoraneo"><option value="">Tutti</option><option value="si">Comune litoraneo</option><option value="no">Comune non litoraneo</option></select></label>
              <label><span>Insularità</span><select className="input" defaultValue={territorialFilters.isola} name="isola"><option value="">Tutti</option><option value="si">Comune isolano</option><option value="no">Comune non isolano</option></select></label>
            </div>
          </details>
          <div className={styles.filterActions}>
            <button className="btn btn-primary" type="submit">Applica</button>
            <Link className="btn btn-secondary" href="/territori/confronto">Azzera</Link>
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
                  <th className="num" scope="col">{sort === "per-km2" ? "Differenza per km²" : "Differenza per abitante"}</th>
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
                      {sort === "per-km2"
                        ? municipality.differencePerSquareKmCents === null ? "n.d." : signedEuro(municipality.differencePerSquareKmCents)
                        : signedEuro(municipality.differencePerCapitaCents)}
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
          Comuni di dimensioni diverse alterna il valore per abitante e quello per km². Superficie,
          altimetria e urbanizzazione descrivono il contesto, ma non provano efficienza o spreco.
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
          hrefForPage={(target) => pageUrl({ query, region, sort, territorialFilters, page: target })}
          jump={{
            action: "/territori/confronto",
            pageParam: "pagina",
            fields: {
              ...(query ? { comune: query } : {}),
              ...(region ? { regione: region } : {}),
              ...(sort !== "per-abitante" ? { ordine: sort } : {}),
              ...Object.fromEntries(Object.entries(territorialFilters).filter(([, value]) => value)),
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
