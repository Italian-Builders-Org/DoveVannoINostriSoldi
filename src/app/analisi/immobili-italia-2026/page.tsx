import type { Metadata } from "next";
import Link from "next/link";
import { integer } from "@/lib/format";
import { IntegratedQueryError } from "@/lib/integrated-public-view";
import {
  ADE_IMMOBILI_ACQUISITION_DATE,
  ADE_IMMOBILI_LANDING,
  ADE_IMMOBILI_OPEN_DATA_ZIP,
  ADE_IMMOBILI_PRELIEVO_DATASET,
  ADE_IMMOBILI_TABELLE_DATASET,
  ADE_IMMOBILI_UTILIZZO_DATASET,
  UTILIZZO_CATEGORIES,
  buildPrelievoChartSeries,
  getAdeImmobiliAnalysis,
  getAdeImmobiliTabellePage,
  getAdeImmobiliUtilizzoPage,
} from "@/lib/ade-immobili-italia-2026";
import { PrelievoChart } from "./prelievo-chart";
import styles from "./immobili-italia-2026.module.css";

export const metadata: Metadata = {
  title: "Gli immobili in Italia 2026 · fiscalità e stock catastale",
  description:
    "Analisi su dati ufficiali AdE (anno d'imposta 2023, edizione 2026): prelievo IMU/TASI, utilizzo immobiliare per provincia e tabelle API del volume «Gli immobili in Italia».",
  alternates: { canonical: "/analisi/immobili-italia-2026" },
};

type Search = Record<string, string | string[] | undefined>;

function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function mergeSearchParams(search: Search, overrides: Record<string, string | undefined>) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const resolved = param(value);
    if (resolved) next.set(key, resolved);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}

export default async function AdeImmobiliItalia2026Page({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const analysis = getAdeImmobiliAnalysis();
  const prelievoSeries = buildPrelievoChartSeries(analysis);

  let utilizzo;
  let utilizzoError: string | null = null;
  try {
    utilizzo = await getAdeImmobiliUtilizzoPage({
      q: search.u_q,
      cursor: search.u_cursor,
      provincia: search.u_prov,
      categoria: search.u_cat,
    });
  } catch (error) {
    if (error instanceof IntegratedQueryError) {
      utilizzoError = error.message;
      utilizzo = await getAdeImmobiliUtilizzoPage({
        provincia: search.u_prov,
        categoria: search.u_cat,
      });
    } else if (error instanceof Error && (error.message.includes("provincia") || error.message.includes("Categoria"))) {
      utilizzoError = error.message;
      utilizzo = await getAdeImmobiliUtilizzoPage({ q: search.u_q, cursor: search.u_cursor });
    } else {
      throw error;
    }
  }

  let tabelle;
  let tabelleError: string | null = null;
  try {
    tabelle = await getAdeImmobiliTabellePage({
      q: search.t_q,
      cursor: search.t_cursor,
      tabella: search.t_id,
    });
  } catch (error) {
    if (error instanceof IntegratedQueryError) {
      tabelleError = error.message;
      tabelle = await getAdeImmobiliTabellePage({ tabella: search.t_id });
    } else if (error instanceof Error && error.message.includes("tabella")) {
      tabelleError = error.message;
      tabelle = await getAdeImmobiliTabellePage({ q: search.t_q, cursor: search.t_cursor });
    } else {
      throw error;
    }
  }

  const utilNext = mergeSearchParams(search, { u_cursor: utilizzo.pagination.nextCursor ?? undefined });
  const utilFirst = mergeSearchParams(search, { u_cursor: undefined });
  const tabNext = mergeSearchParams(search, { t_cursor: tabelle.pagination.nextCursor ?? undefined });
  const tabFirst = mergeSearchParams(search, { t_cursor: undefined });

  return (
    <main className={`shell page ${styles.page}`}>
      <header className="page-intro">
        <p className="eyebrow">Agenzia delle Entrate · edizione 2026</p>
        <h1>Gli immobili in Italia</h1>
        <p>
          Stock catastale e dichiarazioni fiscali con <strong>anno d&apos;imposta 2023</strong>, pubblicati nel volume 2026.
          Qui: prelievo patrimoniale (fino al 2024), utilizzi per provincia e le tabelle scaricabili via API ufficiale.
        </p>
        <p className={styles.links}>
          <a href="#prelievo">Prelievo fiscale ↓</a>
          <a href="#utilizzo">Utilizzo per provincia ↓</a>
          <a href="#tabelle">Tabelle API ↓</a>
          <a href="#fonti">Fonti e limiti ↓</a>
          <Link href="/territori/irpef">Redditi IRPEF per territorio →</Link>
          <Link href="/patrimonio">Patrimonio immobiliare pubblico →</Link>
        </p>
      </header>

      <div className={`stat-strip ${styles.stats}`} aria-label="Numeri chiave dal volume AdE">
        <div>
          <span className="stat-label">Gettito IMU 2024</span>
          <strong className={`stat-value ${styles.heroRate}`} data-testid="ade-imu-2024-mld">
            {analysis.hero.imuGettito2024Mld.replace(".", ",")}
          </strong>
          <span className="stat-note">mld € · tabella 4.4 · gettito nazionale, non aliquote comunali</span>
        </div>
        <div>
          <span className="stat-label">Righe open data provincia</span>
          <strong className="stat-value">{integer(analysis.coverage.utilizzoProvinciaRows)}</strong>
          <span className="stat-note">anno d&apos;imposta {analysis.coverage.taxYear}</span>
        </div>
        <div>
          <span className="stat-label">Tabelle via API</span>
          <strong className="stat-value">{integer(analysis.coverage.tablesAvailableViaApi)}</strong>
          <span className="stat-note">su {integer(analysis.coverage.tableCount)} nel volume · acquisizione {ADE_IMMOBILI_ACQUISITION_DATE}</span>
        </div>
      </div>

      <aside className="notice" aria-labelledby="ade-immobili-scope">
        <h2 id="ade-immobili-scope">Che cosa stai leggendo</h2>
        <p>
          I dati catastali e fiscali descrivono <strong>stock, rendite, VSM e gettito</strong> pubblicato da AdE.
          Non sono pagamenti SIOPE, entrate di bilancio comunale verificate né IRPEF territoriale MEF.
        </p>
        <p>
          Il capitolo «IMU per comune» e margini di manovra del volume 2026 <strong>non sono ancora</strong> nelle API/tabelle
          scaricabili: per le aliquote comunali usa i redditi e le pagine territoriali quando disponibili, senza sommare perimetri diversi.
        </p>
      </aside>

      <section id="prelievo" aria-labelledby="prelievo-title">
        <h2 id="prelievo-title">Prelievo fiscale sugli immobili</h2>
        <p>
          Evoluzione nazionale di IMU, TASI e cedolare secca (miliardi di euro), dalla tabella 4.4 dell&apos;edizione 2026.
        </p>
        <PrelievoChart series={prelievoSeries} />
        <p>
          <Link href={`/dati/${ADE_IMMOBILI_PRELIEVO_DATASET}`}>Dataset prelievo 2015-2024</Link>
          {" · "}
          <a href={`/api/dati/${ADE_IMMOBILI_PRELIEVO_DATASET}?limit=25`}>API</a>
        </p>
      </section>

      <section aria-labelledby="capitoli-title">
        <h2 id="capitoli-title">Capitoli del volume (tabelle API disponibili)</h2>
        <ul className={styles.chapterList}>
          {analysis.chapters.map((chapter) => (
            <li key={chapter.id}>
              <strong>{chapter.title}</strong>
              <span> — {integer(chapter.tables)} tabelle con celle scaricabili</span>
            </li>
          ))}
        </ul>
        {analysis.coverage.tablesMissingViaApi.length > 0 ? (
          <p className={styles.missing}>
            {integer(analysis.coverage.tablesMissingViaApi.length)} tabelle rispondono <code>null</code> dall&apos;API ufficiale
            (solo PDF): {analysis.coverage.tablesMissingViaApi.join(", ")}.
          </p>
        ) : null}
      </section>

      <section id="utilizzo" aria-labelledby="utilizzo-title">
        <h2 id="utilizzo-title">Utilizzo immobiliare per provincia (2023)</h2>
        <p>
          Open data AdE: numero immobili, rendita catastale e VSM per sigla provinciale e categoria d&apos;uso.
          Per approfondire sul territorio: <Link href="/territori">panoramica territori</Link> e{" "}
          <Link href="/territori/irpef">redditi IRPEF</Link> (perimetro diverso).
        </p>
        <form action="/analisi/immobili-italia-2026#utilizzo" method="get" className={styles.filters}>
          <div className={styles.search}>
            <div>
              <label htmlFor="u-q">Cerca testo libero</label>
              <input className="input" id="u-q" name="u_q" type="search" maxLength={200} defaultValue={utilizzo.query ?? ""} placeholder="Es. AG oppure abitazioni" />
            </div>
            <button className="btn btn-primary" type="submit">Applica</button>
          </div>
          <div className={styles.filtersRow}>
            <div>
              <label htmlFor="u-prov">Provincia (sigla)</label>
              <input className="input" id="u-prov" name="u_prov" type="text" maxLength={2} defaultValue={utilizzo.provincia ?? ""} placeholder="Es. RM" />
            </div>
            <div>
              <label htmlFor="u-cat">Categoria</label>
              <select className="input" id="u-cat" name="u_cat" defaultValue={utilizzo.categoria ?? ""}>
                <option value="">Tutte</option>
                {UTILIZZO_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>
          </div>
          {param(search.t_q) ? <input type="hidden" name="t_q" value={param(search.t_q)} /> : null}
          {param(search.t_id) ? <input type="hidden" name="t_id" value={param(search.t_id)} /> : null}
          {param(search.t_cursor) ? <input type="hidden" name="t_cursor" value={param(search.t_cursor)} /> : null}
        </form>
        {utilizzoError ? <p role="alert" className="notice">{utilizzoError} Mostriamo i primi risultati utilizzo.</p> : null}
        <p className={styles.results} role="status" data-testid="utilizzo-status">
          {utilizzo.rows.length === 0
            ? "Nessuna riga corrisponde ai filtri sull'utilizzo provincia."
            : `${integer(utilizzo.rows.length)} righe in pagina su ${integer(utilizzo.matchedRows)} corrispondenze (dataset ${integer(utilizzo.dataset.publicRows)} righe).`}
        </p>
        <div className={styles.tableWrap} role="region" aria-label="Utilizzo immobiliare per provincia">
          <table>
            <thead>
              <tr>
                <th scope="col">Prov.</th>
                <th scope="col">Categoria</th>
                <th scope="col">Indicatore</th>
                <th scope="col">Valore</th>
                <th scope="col">Fonte</th>
              </tr>
            </thead>
            <tbody>
              {utilizzo.rows.map((row) => (
                <tr key={row.rowId}>
                  <td>{row.provincia}</td>
                  <td>{row.categoria}</td>
                  <td>{row.indicatore}</td>
                  <td>{row.valore || "—"}</td>
                  <td>
                    <a href={row.sourceUrl} rel="noreferrer" target="_blank">
                      Open data ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <nav className={styles.pagination} aria-label="Paginazione utilizzo provincia">
          {param(search.u_cursor) ? (
            <Link className="btn btn-secondary" href={`/analisi/immobili-italia-2026?${utilFirst.toString()}#utilizzo`}>
              Primi risultati utilizzo
            </Link>
          ) : null}
          {utilizzo.pagination.nextCursor ? (
            <Link className="btn btn-secondary" href={`/analisi/immobili-italia-2026?${utilNext.toString()}#utilizzo`}>
              Utilizzo successivo →
            </Link>
          ) : null}
        </nav>
        <p>
          <Link href={`/dati/${ADE_IMMOBILI_UTILIZZO_DATASET}`}>Dataset utilizzo provincia</Link>
          {" · "}
          <a href={`/api/dati/${ADE_IMMOBILI_UTILIZZO_DATASET}?limit=25`}>API</a>
        </p>
      </section>

      <section id="tabelle" aria-labelledby="tabelle-title">
        <h2 id="tabelle-title">Tabelle «Immobili in Italia 2026» (API)</h2>
        <p>Celle normalizzate dall&apos;endpoint <code>get_table</code> per l&apos;edizione 2026; ogni riga conserva l&apos;URL puntuale.</p>
        <form action="/analisi/immobili-italia-2026#tabelle" method="get" className={styles.filters}>
          <div className={styles.search}>
            <div>
              <label htmlFor="t-q">Cerca titolo, colonna o valore</label>
              <input className="input" id="t-q" name="t_q" type="search" maxLength={200} defaultValue={tabelle.query ?? ""} />
            </div>
            <button className="btn btn-primary" type="submit">Cerca</button>
          </div>
          <div className={styles.filtersRow}>
            <div>
              <label htmlFor="t-id">Id tabella (es. 2026_04_01_05)</label>
              <input className="input" id="t-id" name="t_id" type="text" maxLength={20} defaultValue={tabelle.tabella ?? ""} placeholder="2026_04_01_05" />
            </div>
          </div>
          {param(search.u_q) ? <input type="hidden" name="u_q" value={param(search.u_q)} /> : null}
          {param(search.u_prov) ? <input type="hidden" name="u_prov" value={param(search.u_prov)} /> : null}
          {param(search.u_cat) ? <input type="hidden" name="u_cat" value={param(search.u_cat)} /> : null}
          {param(search.u_cursor) ? <input type="hidden" name="u_cursor" value={param(search.u_cursor)} /> : null}
        </form>
        {tabelleError ? <p role="alert" className="notice">{tabelleError} Mostriamo le prime celle tabellari.</p> : null}
        <p className={styles.results} role="status" data-testid="tabelle-status">
          {tabelle.rows.length === 0
            ? "Nessuna cella corrisponde ai filtri sulle tabelle API."
            : `${integer(tabelle.rows.length)} celle in pagina su ${integer(tabelle.matchedRows)} corrispondenze (dataset ${integer(tabelle.dataset.publicRows)} righe).`}
        </p>
        <div className={styles.tableWrap} role="region" aria-label="Celle tabelle AdE immobili 2026">
          <table>
            <thead>
              <tr>
                <th scope="col">Tabella</th>
                <th scope="col">Riga</th>
                <th scope="col">Colonna</th>
                <th scope="col">Valore</th>
                <th scope="col">Fonte</th>
              </tr>
            </thead>
            <tbody>
              {tabelle.rows.map((row) => (
                <tr key={row.rowId}>
                  <td>{row.tableId}</td>
                  <td>{row.row}</td>
                  <td>{row.column}</td>
                  <td>{row.value || "—"}</td>
                  <td>
                    <a href={row.sourceUrl} rel="noreferrer" target="_blank">
                      API ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <nav className={styles.pagination} aria-label="Paginazione tabelle AdE">
          {param(search.t_cursor) ? (
            <Link className="btn btn-secondary" href={`/analisi/immobili-italia-2026?${tabFirst.toString()}#tabelle`}>
              Prime celle tabella
            </Link>
          ) : null}
          {tabelle.pagination.nextCursor ? (
            <Link className="btn btn-secondary" href={`/analisi/immobili-italia-2026?${tabNext.toString()}#tabelle`}>
              Celle successive →
            </Link>
          ) : null}
        </nav>
        <p>
          <Link href={`/dati/${ADE_IMMOBILI_TABELLE_DATASET}`}>Dataset tabelle API</Link>
          {" · "}
          <a href={`/api/dati/${ADE_IMMOBILI_TABELLE_DATASET}?limit=25`}>API</a>
        </p>
      </section>

      <section id="fonti" className="panel" aria-labelledby="fonti-title">
        <h2 id="fonti-title">Fonti, periodo e licenza</h2>
        <ul>
          <li>
            <a href={ADE_IMMOBILI_LANDING}>Portale AdE · Gli immobili in Italia 2026</a>
          </li>
          <li>
            <a href={analysis.sources.openDataPortalUrl}>Portale open data MEF/AdE</a>
          </li>
          <li>
            <a href={ADE_IMMOBILI_OPEN_DATA_ZIP}>Archivio open data (ZIP)</a>
          </li>
          <li>
            <a href={analysis.sources.volumePdfUrl}>Volume PDF 2026</a>
          </li>
          <li>
            <a href={analysis.sources.licenseUrl}>Licenza CC BY 3.0 IT</a>
          </li>
        </ul>
        <p>
          Anno d&apos;imposta <strong>{analysis.coverage.taxYear}</strong> per stock e utilizzi open data; serie di prelievo fino al{" "}
          <strong>2024</strong> in mld €. Acquisizione snapshot: {ADE_IMMOBILI_ACQUISITION_DATE}.
        </p>
        <details>
          <summary>Avvertenze e limiti</summary>
          <ul>
            {analysis.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </details>
        <p>
          © Agenzia delle Entrate / MEF. Proiezione DVNS con attribuzione; i numeri restano quelli ufficiali nelle celle citate.
        </p>
      </section>
    </main>
  );
}
