import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { compactEuro, integer } from "@/lib/format";
import {
  MasafMercatiQueryError,
  getMasafMercatiSummaries,
  masafMercatiDenials,
  masafMercatiMeta,
  queryMasafMercati,
  type MasafMercatiRecipientRow,
  type MasafMercatiSummaryRow,
} from "@/lib/masaf-logistica-mercati-snapshot";
import styles from "./logistica-mercati.module.css";

export const metadata: Metadata = {
  title: "Logistica mercati agroalimentari · MASAF PNRR",
  description:
    "Progetti della linea Mercati (PNRR M2C1I2.01): graduatoria MASAF, agevolazioni richieste e concesse, CUP e avanzamento ReGiS quando documentati.",
};

type PageParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clean(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

function moneyOrNd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n.d.";
  return compactEuro(value);
}

function textOrNd(value: string | null | undefined): string {
  const cleaned = value?.trim();
  return cleaned || "n.d.";
}

function coverageLabel(available: number, total: number): string {
  if (available === 0) return "n.d.";
  if (available === total) return "tutti";
  return `${integer(available)}/${integer(total)}`;
}

function SummaryTable({
  title,
  rows,
  labelHeader,
}: {
  title: string;
  rows: MasafMercatiSummaryRow[];
  labelHeader: string;
}) {
  return (
    <section className="panel">
      <h2 className="panel-title">{title}</h2>
      <p className={styles.tableNote}>
        Richiesta, concessione e finanziamento ReGiS restano colonne separate. I totali usano solo i valori
        documentati; se manca un importo non viene trattato come zero.
      </p>
      <div className="table-scroll" role="region" aria-label={title} tabIndex={0}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{labelHeader}</th>
              <th scope="col" className="num">
                Progetti
              </th>
              <th scope="col" className="num">
                Con CUP
              </th>
              <th scope="col" className="num">
                Agevolazione richiesta
              </th>
              <th scope="col" className="num">
                Agevolazione concessa
              </th>
              <th scope="col" className="num">
                Copertura concessa
              </th>
              <th scope="col" className="num">
                Finanziamento PNRR ReGiS
              </th>
              <th scope="col" className="num">
                Copertura ReGiS
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td className="num">{integer(row.projects)}</td>
                <td className="num">{integer(row.withCup)}</td>
                <td className="num">{compactEuro(row.richiestaEuro)}</td>
                <td className="num">{moneyOrNd(row.concessaEuro)}</td>
                <td className="num">{coverageLabel(row.concessaAvailable, row.projects)}</td>
                <td className="num">{moneyOrNd(row.finanziamentoPnrrEuro)}</td>
                <td className="num">{coverageLabel(row.finanziamentoAvailable, row.projects)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RecipientsTable({ rows }: { rows: MasafMercatiRecipientRow[] }) {
  return (
    <section className="panel">
      <h2 className="panel-title">Principali soggetti beneficiari</h2>
      <p className={styles.tableNote}>
        Ordinati per agevolazione concessa se documentata, altrimenti finanziamento ReGiS, altrimenti richiesta in
        graduatoria. Non è una classifica di efficienza o di pagamento ricevuto.
      </p>
      <div className="table-scroll" role="region" aria-label="Principali soggetti beneficiari" tabIndex={0}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Beneficiario</th>
              <th scope="col">CUP</th>
              <th scope="col">Area / regione</th>
              <th scope="col" className="num">
                Richiesta
              </th>
              <th scope="col" className="num">
                Concessa
              </th>
              <th scope="col" className="num">
                Finanziamento ReGiS
              </th>
              <th scope="col">Stato</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.codiceDomanda}>
                <th scope="row">{integer(row.ordine)}</th>
                <td>{row.beneficiario}</td>
                <td>
                  {row.cup ? <Link href={`/progetti/${row.cup}`}>{row.cup}</Link> : "n.d."}
                </td>
                <td>
                  {[row.macroArea, row.regione].filter(Boolean).join(" · ")}
                </td>
                <td className="num">{compactEuro(row.richiestaEuro)}</td>
                <td className="num">{moneyOrNd(row.concessaEuro)}</td>
                <td className="num">{moneyOrNd(row.finanziamentoPnrrEuro)}</td>
                <td>
                  {row.statoDocumentato === "concessione-pubblicata"
                    ? row.statoAvanzamentoRegis ?? "Concessione pubblicata"
                    : "Solo in graduatoria"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function MasafLogisticaMercatiPage({
  searchParams,
}: {
  searchParams: Promise<PageParams>;
}) {
  const params = await searchParams;
  const requested = {
    q: clean(first(params.q)),
    area: clean(first(params.area)),
    stato: clean(first(params.stato)),
    limit: 50,
    offset: 0,
  };

  let error: string | null = null;
  let result: ReturnType<typeof queryMasafMercati>;
  try {
    result = queryMasafMercati(requested);
  } catch (caught) {
    error = caught instanceof MasafMercatiQueryError ? caught.message : "Impossibile applicare i filtri.";
    result = queryMasafMercati({ limit: 50 });
  }

  const meta = masafMercatiMeta;
  const summaries = getMasafMercatiSummaries();
  const sources = Object.values(meta.sources);

  return (
    <main className="shell page">
      <nav className={styles.crumbs} aria-label="Percorso">
        <Link href="/coesione">Fondi e progetti</Link>
        <span>/</span>
        <strong>Logistica mercati</strong>
      </nav>

      <header className={styles.hero}>
        <p className={styles.eyebrow}>MASAF · PNRR {meta.measure.pnrrCode} · linea {meta.measure.line}</p>
        <h1>Logistica dei mercati agroalimentari all&apos;ingrosso</h1>
        <p>{meta.measure.officialName}.</p>
        <p>
          Perimetro ufficiale della <strong>sola linea Mercati</strong>: {integer(meta.counts.projects)} progetti
          della graduatoria consolidata. Non include Imprese e Porti della stessa misura PNRR. Titolare:{" "}
          {meta.measure.holder}. Gestore: {meta.measure.gestore}.
        </p>
        <p className={styles.meta}>
          Periodo: {meta.referencePeriod.label}. Come arrivarci: menu{" "}
          <Link href="/coesione">Fondi e progetti</Link> → Logistica mercati agroalimentari, oppure da{" "}
          <Link href="/pnrr">Tutti i progetti PNRR</Link>.
        </p>
      </header>

      <section className={styles.stats} aria-label="Riepilogo snapshot">
        <div className={styles.stat}>
          <strong>{integer(meta.counts.projects)}</strong>
          <span>In graduatoria</span>
        </div>
        <div className={styles.stat}>
          <strong>{integer(meta.counts.withCup)}</strong>
          <span>Con CUP da decreto</span>
        </div>
        <div className={styles.stat}>
          <strong>{integer(meta.counts.withGranted)}</strong>
          <span>Con agevolazione concessa</span>
        </div>
        <div className={styles.stat}>
          <strong>{integer(meta.counts.withRegis)}</strong>
          <span>Con avanzamento ReGiS</span>
        </div>
        <div className={styles.stat}>
          <strong>{compactEuro(meta.measure.dotazioneDichiarataEuro)}</strong>
          <span>Dotazione dichiarata linea</span>
        </div>
        <div className={styles.stat}>
          <strong>{compactEuro(summaries.total.richiestaEuro)}</strong>
          <span>Somma richieste in graduatoria</span>
        </div>
      </section>

      <div className={styles.summaryTables}>
        <SummaryTable title="Riepilogo per macro-area" labelHeader="Macro-area" rows={summaries.byArea} />
        <SummaryTable
          title="Riepilogo per stato documentato"
          labelHeader="Stato"
          rows={summaries.byStato}
        />
        <SummaryTable
          title="Riepilogo per avanzamento ReGiS"
          labelHeader="Avanzamento"
          rows={summaries.byAvanzamento}
        />
        <SummaryTable title="Riepilogo per regione ReGiS" labelHeader="Regione" rows={summaries.byRegione} />
        <RecipientsTable rows={summaries.topBeneficiari} />
      </div>

      <section className={styles.panel} aria-labelledby="filtri-title">
        <h2 id="filtri-title">Filtra i progetti</h2>
        <p>Richiesta, concessione, finanziamento ReGiS ed erogazioni restano campi separati.</p>
        <Form action="/coesione/logistica-mercati" className={styles.form}>
          <label>
            <span>Ricerca</span>
            <input name="q" defaultValue={requested.q ?? ""} placeholder="Beneficiario, CUP, comune…" />
          </label>
          <label>
            <span>Macro-area</span>
            <select name="area" defaultValue={requested.area ?? ""}>
              <option value="">Tutte</option>
              <option value="Nord">Nord</option>
              <option value="Centro">Centro</option>
              <option value="Sud">Sud</option>
            </select>
          </label>
          <label>
            <span>Stato documentato</span>
            <select name="stato" defaultValue={requested.stato ?? ""}>
              <option value="">Tutti</option>
              <option value="concessione-pubblicata">Concessione pubblicata</option>
              <option value="in-graduatoria">Solo in graduatoria</option>
            </select>
          </label>
          <button className="btn btn-primary" type="submit">
            Applica
          </button>
        </Form>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="elenco-title">
        <h2 id="elenco-title">
          Elenco ({integer(result.total)} di {integer(meta.counts.projects)})
        </h2>
        {result.projects.length === 0 ? (
          <p className={styles.empty}>Nessun progetto con questi filtri.</p>
        ) : (
          <ol className={styles.list}>
            {result.projects.map((project) => (
              <li key={project.codiceDomanda} className={styles.item}>
                <div className={styles.itemTop}>
                  <h3>
                    #{project.ordine} · {project.beneficiario}
                  </h3>
                  <p className={styles.meta}>
                    <span>Domanda {project.codiceDomanda}</span>
                    <span>{project.macroArea}</span>
                    <span>
                      {project.statoDocumentato === "concessione-pubblicata"
                        ? "Concessione pubblicata"
                        : "Solo in graduatoria"}
                    </span>
                  </p>
                </div>
                <dl className={styles.grid}>
                  <div>
                    <dt>CUP</dt>
                    <dd>
                      {project.cup ? (
                        <Link href={`/progetti/${project.cup}`}>{project.cup}</Link>
                      ) : (
                        "n.d."
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Agevolazione richiesta</dt>
                    <dd>{moneyOrNd(project.agevolazioneRichiestaEuro)}</dd>
                  </div>
                  <div>
                    <dt>Agevolazione concessa</dt>
                    <dd>{moneyOrNd(project.agevolazioneConcessaEuro)}</dd>
                  </div>
                  <div>
                    <dt>Finanziamento PNRR (ReGiS)</dt>
                    <dd>{moneyOrNd(project.finanziamentoPnrrEuro)}</dd>
                  </div>
                  <div>
                    <dt>Erogazioni / pagamenti</dt>
                    <dd>n.d.</dd>
                  </div>
                  <div>
                    <dt>Avanzamento ReGiS</dt>
                    <dd>{textOrNd(project.statoAvanzamentoRegis)}</dd>
                  </div>
                  <div>
                    <dt>Inizio effettivo</dt>
                    <dd>{textOrNd(project.dataInizioEffettiva)}</dd>
                  </div>
                  <div>
                    <dt>Fine prevista</dt>
                    <dd>{textOrNd(project.dataFinePrevista)}</dd>
                  </div>
                  <div>
                    <dt>Territorio</dt>
                    <dd>
                      {[project.comune, project.provincia, project.regione].filter(Boolean).join(" · ") ||
                        "n.d."}
                    </dd>
                  </div>
                  <div>
                    <dt>Punteggio graduatoria</dt>
                    <dd>{integer(project.punteggio)}</dd>
                  </div>
                </dl>
                {project.titoloProgettoRegis ? (
                  <p className={styles.meta}>{project.titoloProgettoRegis}</p>
                ) : null}
                {project.notaAmmissione ? <p className={styles.meta}>{project.notaAmmissione}</p> : null}
                <div className={styles.links}>
                  {project.concessione ? (
                    <a className="btn btn-secondary" href={project.concessione.url} rel="noreferrer" target="_blank">
                      Decreto di concessione ↗
                    </a>
                  ) : null}
                  <a
                    className="btn btn-secondary"
                    href={meta.sources.graduatoriaConsolidata.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Graduatoria ufficiale ↗
                  </a>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="dinieghi-title">
        <h2 id="dinieghi-title">Domande non ammesse ({integer(masafMercatiDenials.length)})</h2>
        <div className="table-scroll" role="region" aria-label="Domande non ammesse" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Codice</th>
                <th scope="col">Soggetto</th>
                <th scope="col">Motivazione</th>
                <th scope="col">Provvedimento</th>
              </tr>
            </thead>
            <tbody>
              {masafMercatiDenials.map((denial) => (
                <tr key={denial.codiceDomanda}>
                  <th scope="row">{denial.codiceDomanda}</th>
                  <td>{denial.beneficiario}</td>
                  <td>{denial.motivazione}</td>
                  <td>{denial.provvedimento}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.caveats} aria-labelledby="limiti-title">
        <h2 id="limiti-title">Limiti e lettura</h2>
        <ul>
          {meta.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </section>

      <section className={styles.sources} aria-labelledby="fonti-title">
        <h2 id="fonti-title">Fonti ufficiali</h2>
        <ul>
          {sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} rel="noreferrer" target="_blank">
                {source.label} ↗
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
