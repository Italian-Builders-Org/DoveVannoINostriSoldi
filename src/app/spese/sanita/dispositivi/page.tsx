import type { Metadata } from "next";
import Link from "next/link";
import { MedicalDeviceSpendingHistoryChart } from "@/components/charts/medical-device-spending-history-chart";
import {
  MedicalDeviceQueryError,
  aggregateMedicalDeviceSpending,
  listMedicalDeviceFilters,
  medicalDeviceRegionLabel,
  medicalDeviceRegionName,
  searchMedicalDevices,
} from "@/lib/medical-device-spending";
import styles from "./dispositivi.module.css";
import { TerritoryFilters } from "./territory-filters";

export const metadata: Metadata = {
  title: "Spesa per dispositivi medici",
  description: "Ricerca i dispositivi presenti nella spesa sanitaria pubblica 2018-2021 e consulta gli aggregati per territorio, classificazione CND e fabbricante o assemblatore.",
  alternates: { canonical: "/spese/sanita/dispositivi" },
};

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function euro(value: string): string {
  const negative = value.startsWith("-");
  const [whole, cents] = (negative ? value.slice(1) : value).split(".");
  const grouped = BigInt(whole).toLocaleString("it-IT");
  return `${negative ? "−" : ""}${grouped},${cents} €`;
}

function href(pathname: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const encoded = query.toString();
  return encoded ? `${pathname}?${encoded}` : pathname;
}

export default async function MedicalDevicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const filters = listMedicalDeviceFilters();
  const years = filters.years.map((item) => item.year).sort((left, right) => right - left);
  const q = one(params.q)?.trim() ?? "";
  const type = one(params.tipo);
  const searchYear = one(params.annoRicerca);
  const region = one(params.regione);
  const company = one(params.azienda);
  const aggregateYear = one(params.anno) ?? String(years[0]);
  const aggregateRegion = one(params.regioneAggregati);
  const aggregateCompany = one(params.aziendaAggregati);
  const dimension = one(params.dimensione) ?? "territory";
  const filterYears = [...filters.years].sort((left, right) => right.year - left.year);
  const regionLabels = Object.fromEntries(filters.years.flatMap((item) =>
    item.regions.map(({ code }) => [code, medicalDeviceRegionLabel(code)])));
  const history = await Promise.all(years.map(async (year) => {
    const annual = await aggregateMedicalDeviceSpending({ year: String(year), limit: 1 });
    return { year, spending: annual.coverage.spending };
  }));
  history.sort((left, right) => left.year - right.year);
  let search: Awaited<ReturnType<typeof searchMedicalDevices>> | null = null;
  let searchError: string | null = null;
  if (q) {
    try {
      search = await searchMedicalDevices({ q, type, year: searchYear, region, company, cursor: one(params.cursoreRicerca) });
    } catch (error) {
      if (!(error instanceof MedicalDeviceQueryError)) throw error;
      searchError = error.message;
    }
  }
  let aggregate: Awaited<ReturnType<typeof aggregateMedicalDeviceSpending>> | null = null;
  let aggregateError: string | null = null;
  try {
    aggregate = await aggregateMedicalDeviceSpending({
      year: aggregateYear,
      region: aggregateRegion,
      company: aggregateCompany,
      dimension,
      cursor: one(params.cursoreAggregati),
      limit: 25,
    });
  } catch (error) {
    if (!(error instanceof MedicalDeviceQueryError)) throw error;
    aggregateError = error.message;
  }
  const dimensionLabel = dimension === "classification"
    ? "classificazione CND"
    : dimension === "manufacturer" ? "fabbricante o assemblatore" : "territorio";
  const dimensionColumnLabel = dimension === "classification"
    ? "Classificazioni CND"
    : dimension === "manufacturer" ? "Fabbricanti o assemblatori"
      : aggregateRegion ? "Aziende sanitarie" : "Regioni";

  return (
    <main className="shell page">
      <header className="page-intro">
        <p className="eyebrow">Sanità · Ministero della Salute</p>
        <h1>Spesa per dispositivi medici</h1>
        <p>Ricerca i dispositivi presenti nei dati di spesa dal 2018 al 2021. I risultati collegano il numero di repertorio alla BD/RDM e alla classificazione CND.</p>
        <p className={styles.links}>
          <Link href="/spese/sanita">← Torna alla sanità</Link>
          <a href="#aggregati">Vai agli aggregati ↓</a>
          <a href="/api/spese/sanita/dispositivi?vista=filtri">Apri i filtri in JSON</a>
        </p>
      </header>

      <section className="panel" aria-labelledby="ricerca-title">
        <h2 className="panel-title" id="ricerca-title">Cerca un dispositivo</h2>
        <form action="/spese/sanita/dispositivi" method="get" className={styles.filters}>
          <div className={styles.fields}>
            <label className={`${styles.field} ${styles.query}`}>Ricerca
              <input name="q" defaultValue={q} required minLength={1} maxLength={120} placeholder="Numero, nome, catalogo, fabbricante o CND" />
            </label>
            <label className={styles.field}>Tipo
              <select name="tipo" defaultValue={type ?? ""}>
                <option value="">Tutti</option><option value="1">Tipo 1</option><option value="2">Tipo 2</option>
              </select>
            </label>
            <TerritoryFilters key={JSON.stringify([searchYear, region, company])}
              years={filterYears} regionLabels={regionLabels} allYears
              names={["annoRicerca", "regione", "azienda"]}
              initial={[searchYear ?? "", region ?? "", company ?? ""]} />
          </div>
          <button className="btn btn-primary" type="submit">Cerca</button>
        </form>
        {searchError ? <p className={styles.error} role="alert">{searchError}</p> : null}
        {search ? <>
          <div className={styles.summary}>
            <p><strong>{search.matched.toLocaleString("it-IT")}</strong> dispositivi trovati; {search.pagination.returned} mostrati.</p>
            <a href={href("/api/spese/sanita/dispositivi", { vista: "ricerca", q, tipo: type, anno: searchYear, regione: region, azienda: company })}>Risultati in JSON</a>
          </div>
          {search.requiresType ? <p className={styles.error}>Lo stesso numero compare nei tipi 1 e 2. Scegli il tipo per distinguere i due dispositivi.</p> : null}
          <ol className={styles.resultList}>
            {search.hits.map((item) => <li className={styles.result} key={item.ref}>
              <h3><Link href={`/spese/sanita/dispositivi/${item.type}/${item.number}`}>{item.name ?? `Dispositivo ${item.number}`}</Link></h3>
              <p className={styles.meta}>Tipo {item.type} · repertorio {item.number}{item.catalog ? ` · catalogo ${item.catalog}` : ""}</p>
              <p>{item.manufacturer ?? "Fabbricante non collegato"}{item.role ? ` · ${item.role}` : ""}</p>
              <p>{item.classification ? `CND ${item.classification}` : "CND non disponibile"}{item.classificationLabel ? ` · ${item.classificationLabel}` : ""}</p>
              <p className={styles.money}>Totali nazionali per anno: {Object.entries(item.years).sort(([a], [b]) => b.localeCompare(a)).map(([year, total]) => `${year}: ${euro(total.spending)}`).join(" · ")}</p>
            </li>)}
          </ol>
          {search.pagination.nextCursor ? <p><Link className="btn btn-secondary" href={href("/spese/sanita/dispositivi", { q, tipo: type, annoRicerca: searchYear, regione: region, azienda: company, cursoreRicerca: search.pagination.nextCursor })}>Risultati successivi</Link></p> : null}
        </> : null}
      </section>

      <section className="panel" aria-labelledby="andamento-title">
        <h2 className="panel-title" id="andamento-title">Spesa rilevata per anno</h2>
        <p>Totale nazionale pubblicato per ciascun anno. Gli importi includono zeri e rettifiche negative.</p>
        <MedicalDeviceSpendingHistoryChart data={history} />
      </section>

      <section className="panel" id="aggregati" aria-labelledby="aggregati-title">
        <h2 className="panel-title" id="aggregati-title">Aggregati della spesa rilevata</h2>
        <p>I totali includono zeri e rettifiche negative. Non sono prezzi unitari né pagamenti al fabbricante.</p>
        <form action="/spese/sanita/dispositivi#aggregati" method="get" className={styles.filters}>
          {q ? <input type="hidden" name="q" value={q} /> : null}
          <TerritoryFilters key={JSON.stringify([aggregateYear, aggregateRegion, aggregateCompany])}
            years={filterYears} regionLabels={regionLabels}
            names={["anno", "regioneAggregati", "aziendaAggregati"]}
            initial={[aggregateYear, aggregateRegion ?? "", aggregateCompany ?? ""]} />
          <label className={styles.field}>Raggruppa per<select name="dimensione" defaultValue={dimension}><option value="territory">Territorio</option><option value="classification">Classificazione CND</option><option value="manufacturer">Fabbricante o assemblatore</option></select></label>
          <button className="btn btn-primary" type="submit">Aggiorna</button>
        </form>
        {aggregateError ? <p className={styles.error} role="alert">{aggregateError}</p> : aggregate ? <>
          <div className="stat-strip">
            <div><span className="stat-label">Spesa rilevata</span><span className={`stat-value ${styles.money}`}>{euro(aggregate.coverage.spending)}</span><span className="stat-note">anno {aggregate.scope.year}</span></div>
            <div><span className="stat-label">Righe</span><span className="stat-value">{aggregate.coverage.rows.toLocaleString("it-IT")}</span><span className="stat-note">{aggregate.coverage.negativeRows.toLocaleString("it-IT")} rettifiche negative</span></div>
          </div>
          <div className="table-scroll" role="region" aria-label="Aggregati della spesa per dispositivi medici" tabIndex={0}>
            <table className="table"><caption className={styles.visuallyHidden}>Spesa rilevata raggruppata per {dimensionLabel}</caption><thead><tr><th scope="col">{dimensionColumnLabel}</th><th scope="col" className="num">Righe</th><th scope="col" className="num">Spesa</th><th scope="col">Dati</th></tr></thead><tbody>
              {aggregate.rows.map((row, index) => {
                const value = dimension === "manufacturer" ? row.label ?? undefined : row.code ?? undefined;
                const label = dimension === "territory" && aggregate.scope.region === null && row.code
                  ? medicalDeviceRegionName(row.code)
                  : row.label ?? row.code ?? "Non collegato";
                return <tr key={`${row.code ?? row.label ?? "non-collegato"}-${row.role ?? ""}-${index}`}><th scope="row">{label}{row.role ? <small className={styles.blockMeta}>{row.role}</small> : null}</th><td className="num">{row.rows.toLocaleString("it-IT")}</td><td className={`num ${styles.money}`}>{euro(row.spending)}</td><td><a href={href("/api/spese/sanita/dispositivi", { vista: "righe", anno: aggregateYear, regione: aggregateRegion, azienda: aggregateCompany, dimensione: dimension, valore: value, ruolo: row.role ?? undefined, limit: "100" })}>Righe JSON</a></td></tr>;
              })}
            </tbody></table>
          </div>
          {aggregate.pagination.nextCursor ? <p><Link className="btn btn-secondary" href={href("/spese/sanita/dispositivi", { q: q || undefined, anno: aggregateYear, regioneAggregati: aggregateRegion, aziendaAggregati: aggregateCompany, dimensione: dimension, cursoreAggregati: aggregate.pagination.nextCursor }) + "#aggregati"}>Aggregati successivi</Link></p> : null}
        </> : null}
      </section>

      <section className="panel" aria-labelledby="limiti-title">
        <h2 className="panel-title" id="limiti-title">Copertura e limiti</h2>
        <p>I dati disponibili coprono gli anni dal 2018 al 2021. La BD/RDM è aggiornata al {filters.registrySnapshotDate.split("-").reverse().join("/")}; il fabbricante o assemblatore indicato non prova quale ruolo avesse nell’anno della spesa.</p>
        <p>La fonte misura la spesa sostenuta dalle aziende sanitarie nel perimetro pubblicato. Non sommare questi importi al Conto Economico SSN, a SIOPE, a prezzi unitari, fatturato o ricavi.</p>
        <p className={styles.links}><Link href="/fonti">Consulta il registro delle fonti</Link><Link href="/dati/salute-spesa-dispositivi-2021">Apri le righe 2021 nel catalogo</Link></p>
      </section>
    </main>
  );
}
