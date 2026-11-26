import type { Metadata } from "next";
import Link from "next/link";

import {
  BANDS,
  FUNCTION_LABELS,
  PILLARS,
  PILLAR_LABELS,
  RANKING_PAGE_SIZE,
  SIZE_FILTERS,
  describeGroup,
  explainEntry,
  locateDot,
  functionHighlights,
  parseRankingQuery,
  queryRanking,
  rankRange,
  regionName,
  servicesVolatility,
  stabilityLabel,
  statusLabel,
  type IndexEntry,
  type RankingQuery,
} from "@/lib/dvns-index";
import { IndexSnapshotUnavailableError, loadDvnsIndex, type IndexData } from "@/lib/dvns-index-store";
import { REGION_NAME_BY_ISTAT_CODE } from "@/lib/italy-regions";
import { getMunicipalitySearchEntities } from "@/lib/siope-municipality-detail";
import { displayMunicipalityName } from "@/lib/comuni-search";

import { DotDistribution } from "./dot-distribution";
import styles from "./dvns-index.module.css";

const PAGE_PATH = "/dvns-index";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const filtered = Object.keys(await searchParams).length > 0;
  return {
    title: "DVNS Index: il tuo Comune spende meglio o peggio degli altri?",
    description:
      "L'indice di DoveVannoINostriSoldi che confronta ogni Comune con quelli simili: servizi ottenuti per quello che spende, spesa oltre il fabbisogno, investimenti e apertura degli appalti, su dati ufficiali OpenCivitas, SIOPE e ANAC.",
    alternates: { canonical: PAGE_PATH },
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

// Read from dvns_snapshots once per instance at request time, never at build time.
export const dynamic = "force-dynamic";

const integer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });
const one = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("it-IT").replace(/[^a-z0-9]+/g, " ").trim();
}

function rankingHref(query: RankingQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.region) params.set("regione", query.region);
  if (query.size) params.set("dimensione", String(query.size));
  if (query.band) params.set("fascia", query.band);
  if (page > 1) params.set("pagina", String(page));
  const search = params.toString();
  return `${PAGE_PATH}${search ? `?${search}` : ""}#classifica`;
}

function comuneHref(entry: IndexEntry): string {
  return `${PAGE_PATH}?comune=${entry.istat}#scheda`;
}

function Unavailable() {
  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>DVNS Index</h1>
        <p>
          Dati temporaneamente non disponibili. La pagina legge uno snapshot verificato dell&apos;indice: quando non è
          raggiungibile o non corrisponde alla ricevuta pubblicata, non mostriamo numeri.
        </p>
      </div>
      <p><Link href="/comuni">Vai alla mappa dei Comuni</Link></p>
    </main>
  );
}

function BandBadge({ band }: { band: string }) {
  return <span className={styles.band} data-band={band}>{band}</span>;
}

function ComuneCard({ entry, data, dossierHref }: { entry: IndexEntry; data: IndexData; dossierHref: string | null }) {
  const { snapshot } = data;
  const parts = explainEntry(entry, snapshot.rules);
  const highlights = functionHighlights(entry, snapshot.functions);
  const group = entry.group === null ? null : snapshot.groups[entry.group];
  const name = displayMunicipalityName(entry.name);
  const total = parts.reduce((sum, part) => sum + (part.points ?? 0), 0);
  return (
    <section className={styles.card} id="scheda" aria-labelledby="scheda-title">
      <div className={styles.cardHead}>
        <div>
          <p className={styles.eyebrow}>{regionName(entry.regionCode)} · {integer.format(entry.population)} abitanti</p>
          <h2 id="scheda-title" className={styles.cardTitle}>{name}</h2>
          <p className={styles.status}>{statusLabel(entry.status)}</p>
        </div>
        {entry.score !== null ? (
          <div className={styles.scoreBox} data-score={entry.score}>
            <span className={styles.scoreValue}>{one.format(entry.score)}</span>
            <span className={styles.scoreMax}>/100</span>
            {entry.band ? <BandBadge band={entry.band} /> : null}
          </div>
        ) : null}
      </div>

      {entry.status === "ranked" && entry.rank !== null ? (
        <dl className={styles.positions}>
          <div>
            <dt>In Italia</dt>
            <dd>{integer.format(entry.rank)}° su {integer.format(snapshot.summary.ranked)}</dd>
            {rankRange(entry) ? <small data-rank-range>con pesi diversi {rankRange(entry)}</small> : null}
          </div>
          <div>
            <dt>Tra i Comuni simili</dt>
            <dd>{entry.peerRank}° su {entry.peerRanked}</dd>
            {group ? <small>confronto con {describeGroup(group)}</small> : null}
          </div>
          <div>
            <dt>Solidità della fascia</dt>
            <dd>{stabilityLabel(entry.bandStability)}</dd>
            <small>
              fascia {entry.band} confermata in {integer.format(Math.round((entry.bandStability ?? 0) * snapshot.rules.sensitivity.draws))} su{" "}
              {integer.format(snapshot.rules.sensitivity.draws)} combinazioni di pesi diverse
            </small>
          </div>
        </dl>
      ) : null}

      {servicesVolatility(entry) ? (
        <p className={styles.warning} data-volatile>
          <strong>Dato da verificare.</strong> Secondo OpenCivitas i servizi di questo Comune sono cambiati di{" "}
          {integer.format(servicesVolatility(entry) ?? 0)} punti percentuali tra il 2021 e il 2022
          ({one.format(entry.services2021 ?? 0)}% e {one.format(entry.services2022 ?? 0)}% rispetto alla media). I dati sui servizi
          vengono dai questionari compilati dai Comuni: un salto così grande è più probabilmente un errore di compilazione che
          un cambiamento reale, e pesa sul punteggio.
        </p>
      ) : null}

      {entry.score !== null ? (
        <div className={styles.formula}>
          <h3>Perché {one.format(entry.score)}</h3>
          <p>Il punteggio somma i quattro pilastri, ciascuno moltiplicato per il proprio peso.</p>
          <div className={styles.stack} aria-hidden="true">
            {parts.map((part) => (part.points ? <span key={part.pillar} data-pillar={part.pillar} style={{ flexGrow: part.points }} /> : null))}
            <span className={styles.stackRest} style={{ flexGrow: Math.max(0, 100 - total) }} />
          </div>
          <p className={styles.formulaLine}>
            {parts.filter((part) => part.points !== null).map((part, index) => (
              <span key={part.pillar}>
                {index ? " + " : ""}
                <span className={styles.swatch} data-pillar={part.pillar} aria-hidden="true" />
                {one.format(part.points ?? 0)} {PILLAR_LABELS[part.pillar].title.toLocaleLowerCase("it-IT")}
              </span>
            ))}
            {" = "}<strong>{one.format(entry.score)}</strong>
            {parts.some((part) => part.points === null) ? " (pesi riproporzionati sui pilastri disponibili)" : ""}
          </p>
        </div>
      ) : null}

      <ol className={styles.pillars}>
        {parts.map((part, index) => (
          <li key={part.pillar} data-pillar-card={part.pillar}>
            <div className={styles.pillarHead}>
              <span className={styles.pillarNumber}>0{index + 1}</span>
              <div>
                <h3>{PILLAR_LABELS[part.pillar].title}</h3>
                <p>{PILLAR_LABELS[part.pillar].question}</p>
              </div>
              <span className={styles.weight}>peso {Math.round(part.weight * 100)}%</span>
            </div>
            <div className={styles.meter} aria-hidden="true">
              <span style={{ width: `${part.percentile ?? 0}%` }} data-pillar={part.pillar} />
            </div>
            <p className={styles.verdict}>
              <strong>{part.verdict}</strong>
              {part.points !== null ? ` · ${one.format(part.percentile ?? 0)} su 100, pari a ${one.format(part.points)} punti dell'indice` : ""}
            </p>
            <ul className={styles.facts}>
              {part.facts.map((fact) => <li key={fact}>{fact}</li>)}
            </ul>
          </li>
        ))}
      </ol>

      {highlights.best.length ? (
        <p className={styles.functions}>
          <strong>Dove rende di più:</strong> {highlights.best.join(", ")}. <strong>Dove rende di meno:</strong> {highlights.worst.join(", ")}.
          <span> Confronto tra servizi e spesa nelle singole funzioni, OpenCivitas 2022.</span>
        </p>
      ) : null}
      <p className={styles.cardLinks}>
        {dossierHref ? <Link href={dossierHref} prefetch={false}>Apri la scheda completa di {name}</Link> : null}
        <Link href="/dvns-index/metodo" prefetch={false}>Come si calcola il punteggio</Link>
      </p>
    </section>
  );
}

export default async function DvnsIndexPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  let data: IndexData;
  try {
    data = await loadDvnsIndex();
  } catch (error) {
    if (error instanceof IndexSnapshotUnavailableError) return <Unavailable />;
    throw error;
  }
  const { snapshot } = data;
  const rules = snapshot.rules;
  const requested = first(params.comune);
  const query = first(params.q).trim().slice(0, 60);
  let selected = /^\d{6}$/u.test(requested) ? data.byIstat.get(requested) ?? null : null;
  let hits: IndexEntry[] = [];
  if (!selected && query.length >= 2) {
    const needle = normalize(query);
    hits = snapshot.entries
      .filter((entry) => normalize(entry.name).includes(needle))
      .sort((a, b) => Number(normalize(b.name) === needle) - Number(normalize(a.name) === needle) || b.population - a.population)
      .slice(0, 12);
    if (hits.length === 1 || (hits.length && normalize(hits[0].name) === needle)) selected = hits[0];
  }
  const dossier = selected?.taxCode
    ? getMunicipalitySearchEntities().find((entity) => entity.codiceFiscale === selected.taxCode)
    : undefined;
  const ranking = parseRankingQuery(params);
  const result = queryRanking(snapshot.entries, ranking);
  const perDot = 10;
  const summary = snapshot.summary;

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="dvns-index-title">
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <h1 id="dvns-index-title" className={styles.wordmark}>
              <span>DVNS</span>
              <span className={styles.lime}>Index</span>
            </h1>
            <p className={styles.tagline}>Il tuo Comune spende meglio o peggio degli altri?</p>
            <p className={styles.heroLinks}>
              <a href="#classifica" className={styles.heroPrimary} data-ranking-link="hero">Vai alla classifica ↓</a>
              <Link href="/dvns-index/metodo" prefetch={false} data-method-link="hero">Come si calcola l&apos;indice →</Link>
            </p>
            <ol className={styles.heroList}>
              {PILLARS.map((pillar, index) => (
                <li key={pillar}>
                  <span>0{index + 1}</span>
                  {PILLAR_LABELS[pillar].question}
                </li>
              ))}
            </ol>
          </div>
          <div className={styles.heroChart}>
            <p className={styles.domain}>DOVEVANNOINOSTRISOLDI.COM</p>
            <DotDistribution
              columns={data.dots.map((column) => column.length)}
              highlight={selected?.status === "ranked" ? locateDot(data.dots, selected.istat) : null}
              highlightLabel={selected ? displayMunicipalityName(selected.name) : ""}
            />
            <p className={styles.chartNote}>
              {integer.format(summary.ranked)} Comuni in classifica. Ogni punto è un gruppo di circa {perDot} Comuni con punteggio simile.
            </p>
          </div>
        </div>
        <form className={styles.search} action={`${PAGE_PATH}#scheda`} method="get" role="search" aria-label="Cerca il tuo Comune nel DVNS Index">
          <label htmlFor="dvns-index-q">Cerca il tuo Comune</label>
          <div>
            <input id="dvns-index-q" name="q" type="search" defaultValue={selected ? "" : query} minLength={2} maxLength={60} required autoComplete="off" placeholder="es. Bologna, Gubbio, Rivello" />
            <button type="submit">Vedi il punteggio</button>
          </div>
        </form>
      </section>

      <div className={`shell ${styles.body}`}>
        <dl className="stat-strip">
          <div>
            <dt>Comuni in classifica</dt>
            <dd>{integer.format(summary.ranked)}</dd>
            <span className="stat-note">con tutti e quattro i pilastri</span>
          </div>
          <div>
            <dt>Punteggio parziale</dt>
            <dd>{integer.format(summary.partial)}</dd>
            <span className="stat-note">appalti troppo pochi o dati mancanti</span>
          </div>
          <div>
            <dt>Non valutabili</dt>
            <dd>{integer.format(summary.specialStatute)}</dd>
            <span className="stat-note">Regioni a statuto speciale, fuori OpenCivitas</span>
          </div>
          <div>
            <dt>Solidità delle fasce</dt>
            <dd>{one.format(summary.medianStability * 100)}%</dd>
            <span className="stat-note">quota mediana di ricalcoli con pesi diversi che confermano la fascia</span>
          </div>
        </dl>

        <aside className={styles.methodCallout} aria-labelledby="metodo-callout">
          <div>
            <h2 id="metodo-callout">Come funziona il DVNS Index</h2>
            <p>
              Dati ufficiali di OpenCivitas, SIOPE e ANAC, quattro pilastri con pesi dichiarati, confronto solo tra Comuni
              simili. Ogni regola, ogni fonte e un esempio completo sono nella pagina del metodo.
            </p>
          </div>
          <Link href="/dvns-index/metodo" prefetch={false} data-method-link="callout">Leggi il metodo completo →</Link>
        </aside>

        {selected ? (
          <ComuneCard entry={selected} data={data} dossierHref={dossier ? `/comuni?ente=${encodeURIComponent(dossier.codiceIpa)}` : null} />
        ) : hits.length ? (
          <section className={styles.card} id="scheda" aria-labelledby="hits-title">
            <h2 id="hits-title" className={styles.cardTitle}>Comuni trovati per «{query}»</h2>
            <ul className={styles.hits}>
              {hits.map((hit) => (
                <li key={hit.istat}>
                  <Link href={comuneHref(hit)} prefetch={false}>{displayMunicipalityName(hit.name)}</Link>
                  <span>{regionName(hit.regionCode)} · {integer.format(hit.population)} abitanti</span>
                </li>
              ))}
            </ul>
          </section>
        ) : query ? (
          <section className={styles.card} id="scheda"><p>Nessun Comune trovato per «{query}».</p></section>
        ) : null}

        <section className="panel" aria-labelledby="classifica">
          <h2 id="classifica" className="panel-title">La classifica</h2>
          <p className={styles.lede}>
            Fasce da A a E: ogni fascia contiene un quinto dei Comuni in classifica. La posizione esatta conta meno della
            fascia: l&apos;ultima colonna mostra dove cade il Comune se cambiamo i pesi, e &quot;dato da verificare&quot; segnala i
            Comuni con servizi OpenCivitas molto variabili tra un anno e l&apos;altro.
          </p>
          <form className={styles.filters} action={`${PAGE_PATH}#classifica`} method="get" aria-label="Filtra la classifica">
            <label>
              Regione
              <select name="regione" defaultValue={ranking.region ?? ""}>
                <option value="">Tutte</option>
                {Object.entries(REGION_NAME_BY_ISTAT_CODE).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </label>
            <label>
              Abitanti
              <select name="dimensione" defaultValue={ranking.size ?? ""}>
                <option value="">Tutti</option>
                {SIZE_FILTERS.map((filter) => <option key={filter.id} value={filter.id}>{filter.label}</option>)}
              </select>
            </label>
            <label>
              Fascia
              <select name="fascia" defaultValue={ranking.band ?? ""}>
                <option value="">Tutte</option>
                {BANDS.map((band) => <option key={band} value={band}>{band}</option>)}
              </select>
            </label>
            <button type="submit">Filtra</button>
          </form>
          <p className={styles.resultCount} data-ranking-total={result.total}>
            {integer.format(result.total)} Comuni · pagina {result.page} di {result.pages}
          </p>
          <div className="table-scroll" role="region" aria-labelledby="classifica-tabella" tabIndex={0}>
            <table className="table">
              <caption id="classifica-tabella" className="table-caption">DVNS Index, Comuni in classifica</caption>
              <thead>
                <tr>
                  <th scope="col" className="num">Posizione</th>
                  <th scope="col">Comune</th>
                  <th scope="col">Regione</th>
                  <th scope="col" className="num">Abitanti</th>
                  <th scope="col" className="num">Punteggio</th>
                  <th scope="col">Fascia</th>
                  <th scope="col">Con pesi diversi</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((entry) => (
                  <tr key={entry.istat} data-ranking-row={entry.istat}>
                    <td className="num">{integer.format(entry.rank ?? 0)}</td>
                    <th scope="row"><Link href={comuneHref(entry)} prefetch={false}>{displayMunicipalityName(entry.name)}</Link></th>
                    <td>{regionName(entry.regionCode)}</td>
                    <td className="num">{integer.format(entry.population)}</td>
                    <td className="num">{one.format(entry.score ?? 0)}</td>
                    <td><BandBadge band={entry.band ?? ""} /></td>
                    <td className={styles.rangeCell}>
                      {rankRange(entry)}
                      {servicesVolatility(entry) ? <span className={styles.flag} title="Dato OpenCivitas sui servizi molto variabile tra 2021 e 2022">dato da verificare</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.pages > 1 ? (
            <nav className={styles.pager} aria-label="Pagine della classifica">
              {result.page > 1 ? <Link href={rankingHref(ranking, result.page - 1)} prefetch={false}>← Precedenti {RANKING_PAGE_SIZE}</Link> : <span />}
              {result.page < result.pages ? <Link href={rankingHref(ranking, result.page + 1)} prefetch={false}>Successivi {RANKING_PAGE_SIZE} →</Link> : null}
            </nav>
          ) : null}
        </section>

        <section className="panel" aria-labelledby="metodo">
          <h2 id="metodo" className="panel-title">Come si calcola</h2>
          <p className={styles.lede}>
            Il DVNS Index ha una base oggettiva, dati ufficiali che chiunque può verificare, e una parte di indicatore:
            le regole con cui decidiamo cosa conta come &quot;meglio&quot; e quanto pesa. Qui trovi la sintesi; il{" "}
            <Link href="/dvns-index/metodo" prefetch={false}>metodo completo</Link> spiega ogni passaggio con un esempio.
          </p>
          <div className="table-scroll" role="region" aria-labelledby="pilastri-tabella" tabIndex={0}>
            <table className={`table ${styles.methodTable}`}>
              <caption id="pilastri-tabella" className="table-caption">I quattro pilastri</caption>
              <thead>
                <tr><th scope="col">Pilastro</th><th scope="col" className="num">Peso</th><th scope="col">Dato ufficiale</th><th scope="col">Regola</th></tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Resa della spesa</th><td className="num">{Math.round(rules.weights.resa * 100)}%</td>
                  <td>OpenCivitas (MEF e SOSE), 2021 e 2022: livello dei servizi rispetto alla media dei Comuni della stessa fascia e spesa rispetto al fabbisogno standard.</td>
                  <td>Servizi rispetto alla media meno spesa rispetto al fabbisogno. Più servizi per ogni euro è meglio. Media dei due anni.</td>
                </tr>
                <tr>
                  <th scope="row">Spesa non giustificata</th><td className="num">{Math.round(rules.weights.sovraspesa * 100)}%</td>
                  <td>Stessi dati OpenCivitas.</td>
                  <td>Penalità solo per la spesa oltre il fabbisogno che non è coperta da servizi sopra la media. Chi spende di più per offrire di più non è penalizzato.</td>
                </tr>
                <tr>
                  <th scope="row">Capacità di investire</th><td className="num">{Math.round(rules.weights.investire * 100)}%</td>
                  <td>SIOPE (Ragioneria Generale dello Stato e Banca d&apos;Italia), pagamenti di cassa 2024 e 2025.</td>
                  <td>Quota degli investimenti sul totale di spesa corrente e investimenti, sommando i due anni. Più investimenti è meglio.</td>
                </tr>
                <tr>
                  <th scope="row">Apertura degli appalti</th><td className="num">{Math.round(rules.weights.appalti * 100)}%</td>
                  <td>ANAC: {integer.format(summary.anacProcedures)} CIG pubblicati nel 2025 e le aggiudicazioni dei CIG 2025.</td>
                  <td>
                    60%: quota del valore delle procedure sopra {integer.format(rules.procurementThresholdEuro)} € assegnata con affidamento diretto o negoziata senza bando.
                    40%: concentrazione del valore aggiudicato sui fornitori. Meno è meglio.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <h3 className={styles.subtitle}>Criteri</h3>
          <ul className={styles.criteria}>
            <li><strong>Confronto tra simili.</strong> Ogni dato diventa un percentile tra i Comuni con la stessa fascia di popolazione e superficie, zona altimetrica, grado di urbanizzazione, costa e isole. Le città sopra i 100.000 abitanti si confrontano tra loro. Il punteggio da 0 a 100 è quindi già corretto per il contesto.</li>
            <li><strong>Appalti.</strong> Le adesioni a convenzioni Consip e gli affidamenti a società in house non contano né come gara né come affidamento diretto. Le procedure delegate a una centrale di committenza restano del Comune che le ha delegate. Servono almeno {rules.minProcedures} procedure o {rules.minAwards} aggiudicazioni; con pochi appalti il valore viene avvicinato alla mediana nazionale ({one.format(summary.medianWithoutTenderShare)}% del valore senza gara), così il caso non decide il voto.</li>
            <li><strong>Classifica.</strong> Entrano solo i Comuni con tutti e quattro i pilastri. Le fasce sono quintili: A i migliori 20%, E gli ultimi 20%. Soglie attuali: A da {one.format(summary.bandCutoffs[0])}, B da {one.format(summary.bandCutoffs[1])}, C da {one.format(summary.bandCutoffs[2])}, D da {one.format(summary.bandCutoffs[3])}.</li>
            <li><strong>Solidità.</strong> Ricalcoliamo la classifica {integer.format(rules.sensitivity.draws)} volte spostando ogni peso fino a {Math.round(rules.sensitivity.spread * 100)} punti. La solidità è la quota di volte in cui il Comune resta nella stessa fascia.</li>
            <li><strong>Funzioni.</strong> &quot;Dove rende di più e di meno&quot; confronta il saldo tra servizi e spesa nelle sei funzioni OpenCivitas: {Object.values(FUNCTION_LABELS).join(", ")}.</li>
          </ul>
          <h3 className={styles.subtitle}>Cosa non dice</h3>
          <ul className={styles.criteria}>
            <li>Non misura la qualità dei servizi: OpenCivitas ne misura la quantità, per esempio posti negli asili o strade gestite.</li>
            <li>Non indica sprechi né illeciti. Un affidamento diretto è spesso legittimo: la quota senza gara dice quanto il Comune usa la concorrenza, non se ha violato regole.</li>
            <li>Fotografa periodi diversi: servizi e fabbisogni 2021-2022, gli ultimi pubblicati da OpenCivitas; pagamenti 2024-2025; appalti 2025.</li>
            <li>È un indice costruito da DoveVannoINostriSoldi: i dati sono ufficiali, le regole e i pesi sono scelte nostre, dichiarate qui.</li>
          </ul>
          <h3 className={styles.subtitle}>Fonti</h3>
          <ul className={styles.criteria}>
            {snapshot.sources.map((source) => (
              <li key={source.id} data-source={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a> · {source.owner} · licenza {source.license}
              </li>
            ))}
          </ul>
          <p className={styles.version}>Versione {snapshot.version} dell&apos;indice.</p>
        </section>
      </div>
    </main>
  );
}
