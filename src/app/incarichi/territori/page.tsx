import type { Metadata } from "next";
import Link from "next/link";
import { compactEuro, exactEuro, integer, longDate } from "@/lib/format";
import {
  consulentiRegionaliSnapshot as snapshot,
  getConsulentiRegionaliYear,
} from "@/lib/consulenti-regionali-snapshot";
import incarichiStyles from "../incarichi.module.css";
import styles from "./territori.module.css";

type SearchValue = string | string[] | undefined;
type PageProps = {
  searchParams: Promise<{ anno?: SearchValue }>;
};

export const metadata: Metadata = {
  title: "Consulenze e incarichi esterni per territorio",
  description:
    "Ammontare erogato degli incarichi esterni comunicati a Consulenti Pubblici, ripartito per territorio delle PA conferenti.",
};

function one(value: SearchValue): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function euros(paidCents: number): number {
  return paidCents / 100;
}

function parseYear(raw: string | undefined): { year?: number; error: string | null } {
  if (raw === undefined || raw === "") return { year: undefined, error: null };
  if (!/^\d{4}$/.test(raw)) {
    return { year: undefined, error: "L'anno deve essere indicato con quattro cifre." };
  }
  const year = Number(raw);
  if (!snapshot.years.some((item) => item.year === year)) {
    return {
      year: undefined,
      error: `Anno ${year} assente. Disponibili: ${snapshot.years.map((item) => item.year).join(", ")}.`,
    };
  }
  return { year, error: null };
}

export default async function IncarichiTerritoriPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { year: requestedYear, error } = parseYear(one(params.anno));
  const selected = getConsulentiRegionaliYear(requestedYear);
  const yearRange = `${snapshot.periodo.from}-${snapshot.periodo.to}`;
  const isPartial = selected.year === snapshot.latestYear;
  const maxPaid = Math.max(...selected.territories.map((item) => item.paidCents), 1);

  return (
    <main className={`shell page ${styles.page}`}>
      <nav className={incarichiStyles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/incarichi">Incarichi pubblici</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Per territorio</span>
      </nav>

      <header className="page-intro">
        <p className={styles.eyebrow}>Consulenti Pubblici · Perla PA</p>
        <h1>Incarichi esterni per territorio</h1>
        <p>
          Ammontare erogato degli incarichi esterni comunicati dalle amministrazioni, ripartito
          per l&apos;etichetta geografica <code>regionePa</code> della fonte. Periodo {yearRange}.
        </p>
      </header>

      <div className={incarichiStyles.scopeBand} role="group" aria-label="Perimetro della vista">
        <div>
          <span>Periodo</span>
          <strong>{yearRange}</strong>
        </div>
        <div>
          <span>Ambito</span>
          <strong>Territori · incarichi esterni</strong>
        </div>
        <div>
          <span>Unità monetaria</span>
          <strong>Quanto risulta pagato · euro</strong>
        </div>
        <div>
          <span>Anno selezionato</span>
          <strong>
            {selected.year}
            {isPartial ? " · parziale" : ""}
          </strong>
        </div>
      </div>

      <div className="notice warning-notice" data-testid="territori-scope-notice">
        <strong>Non sono i bilanci delle sole Regioni</strong>
        <p>
          {snapshot.methodology.territoryMeaning} Non sommare questa serie alle consulenze
          ministeriali RGS di <Link href="/spese/consulenze">/spese/consulenze</Link>.
        </p>
      </div>

      {isPartial ? (
        <div className="notice warning-notice">
          <strong>{selected.year} è un anno parziale</strong>
          <p>{snapshot.methodology.currentYearWarning}</p>
        </div>
      ) : null}

      {error ? (
        <div className="notice warning-notice" role="alert">
          <strong>Filtro anno non valido</strong>
          <p>{error}</p>
        </div>
      ) : null}

      <section className={styles.summary} aria-labelledby="territori-summary-title">
        <h2 id="territori-summary-title" className={styles.visuallyHidden}>
          Riepilogo {selected.year}
        </h2>
        <dl className={styles.metricList} data-testid="territori-summary">
          <div>
            <dt>Territori pubblicati</dt>
            <dd>{integer(selected.territoryCount)}</dd>
          </div>
          <div>
            <dt>Incarichi esterni</dt>
            <dd>{integer(selected.assignments)}</dd>
          </div>
          <div>
            <dt>Quanto risulta pagato</dt>
            <dd data-testid="territori-total">
              <strong>{compactEuro(euros(selected.paidCents))}</strong>
              <small>{exactEuro(euros(selected.paidCents))}</small>
            </dd>
          </div>
        </dl>
        <p className={styles.note}>
          Totale nazionale ufficiale dell&apos;anno, riconciliato con la somma delle etichette
          territoriali. {snapshot.methodology.amountMeaning}
        </p>
      </section>

      <section className="panel" aria-labelledby="territori-filter-title">
        <h2 id="territori-filter-title" className="panel-title">
          Anno di conferimento
        </h2>
        <form action="/incarichi/territori" method="get" className={styles.filterForm}>
          <label>
            Anno
            <select name="anno" defaultValue={String(selected.year)} aria-label="Anno di conferimento">
              {snapshot.years.map((item) => (
                <option key={item.year} value={item.year}>
                  {item.year}
                  {item.year === snapshot.latestYear ? " (parziale)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn">
            Aggiorna
          </button>
        </form>
      </section>

      <section className="panel" aria-labelledby="territori-table-title">
        <div className={incarichiStyles.sectionHead}>
          <h2 id="territori-table-title" className="panel-title">
            Ripartizione per territorio · {selected.year}
          </h2>
          <span>{integer(selected.territoryCount)} etichette</span>
        </div>
        <p className={styles.scrollHint}>Scorri la tabella →</p>
        <div
          className={`table-scroll ${styles.tableScroll}`}
          role="region"
          aria-label={`Incarichi esterni per territorio ${selected.year}`}
          tabIndex={0}
          data-testid="territori-table"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Territorio</th>
                <th scope="col" className="num">
                  Incarichi
                </th>
                <th scope="col" className="num">
                  Conclusi
                </th>
                <th scope="col" className="num">
                  Quanto risulta pagato
                </th>
                <th scope="col">Quota</th>
              </tr>
            </thead>
            <tbody>
              {selected.territories.map((row) => {
                const share = (row.paidCents / maxPaid) * 100;
                return (
                  <tr key={row.territoryLabel}>
                    <th scope="row">{row.territoryLabel}</th>
                    <td className="num">{integer(row.assignments)}</td>
                    <td className="num">{integer(row.completedAssignments)}</td>
                    <td className="num">
                      <strong>{exactEuro(euros(row.paidCents))}</strong>
                    </td>
                    <td>
                      <span className={styles.barTrack} aria-hidden="true">
                        <span className={styles.barFill} style={{ width: `${share}%` }} />
                      </span>
                      <span className={styles.visuallyHidden}>
                        Quota rispetto al territorio con importo massimo
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {Math.abs(selected.roundingResidualCents) > 0 ? (
          <p className={styles.note}>
            Residuo di arrotondamento ai centesimi rispetto al totale nazionale:{" "}
            {selected.roundingResidualCents > 0 ? "+" : ""}
            {selected.roundingResidualCents} centesimi. Non altera il totale ufficiale dell&apos;anno.
          </p>
        ) : null}
        <p className={styles.note}>{snapshot.methodology.labelDuplicates}</p>
      </section>

      <section className="panel" aria-labelledby="territori-links-title">
        <h2 id="territori-links-title" className="panel-title">
          Serie collegate
        </h2>
        <ul className={styles.linkList}>
          <li>
            <Link href="/incarichi">Quadro nazionale incarichi</Link>
          </li>
          <li>
            <Link href="/spese/consulenze">Consulenze ministeriali RGS</Link>
          </li>
          <li>
            <a href="/api/incarichi/territori">JSON di questa vista</a>
          </li>
          <li>
            <a href={`${snapshot.provenance.landingUrl}`} rel="noreferrer">
              Dati Aggregati · Consulenti Pubblici
            </a>
          </li>
        </ul>
      </section>

      <details className={styles.sources} id="fonti-territori">
        <summary>Fonti e limiti</summary>
        <dl>
          <div>
            <dt>Titolare</dt>
            <dd>{snapshot.provenance.owner}</dd>
          </div>
          <div>
            <dt>Dataset</dt>
            <dd>{snapshot.provenance.dataset}</dd>
          </div>
          <div>
            <dt>Osservato</dt>
            <dd>{longDate(snapshot.provenance.observedAt)}</dd>
          </div>
          <div>
            <dt>Responsabilità</dt>
            <dd>{snapshot.methodology.responsibilityWarning}</dd>
          </div>
          <div>
            <dt>Separazione RGS</dt>
            <dd>{snapshot.methodology.rgsSeparation}</dd>
          </div>
          <div>
            <dt>Riuso</dt>
            <dd>
              <a href={snapshot.provenance.licenseUrl} rel="noreferrer">
                {snapshot.provenance.reuseTerms}
              </a>
            </dd>
          </div>
        </dl>
      </details>
    </main>
  );
}
