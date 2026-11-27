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
  pillarKeyFact,
  regionSummaries,
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

import { DataUnavailableNotice } from "@/components/data-unavailable-notice";
import { DotDistribution } from "./dot-distribution";
import { RegionsMap } from "./regions-map";
import styles from "./dvns-index.module.css";

const PAGE_PATH = "/dvns-index";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const filtered = Object.keys(await searchParams).length > 0;
  return {
    title: "DVNS Index: il tuo Comune spende meglio o peggio degli altri?",
    description:
      "L'indice di DoveVannoINostriSoldi che confronta ogni Comune con quelli simili per dimensione e territorio: resa della spesa, spesa non giustificata, investimenti, appalti, puntualità nei pagamenti e raccolta differenziata, su dati di OpenCivitas, SIOPE, ANAC, Ragioneria Generale dello Stato e ISPRA. Con la mappa delle Regioni.",
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
        <p>Confronta oltre 6.000 Comuni su sei aspetti della spesa, dai servizi resi ai tempi di pagamento.</p>
      </div>
      <DataUnavailableNotice title="Classifica non disponibile" action={{ href: "/comuni", label: "Vai alla mappa dei Comuni" }} retry={{ href: PAGE_PATH, label: "Riprova" }}>
        Mostriamo i punteggi solo con dati verificati, che in questo momento non sono disponibili.
      </DataUnavailableNotice>
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
  const regional = data.regional.get(entry.istat);
  const better = (value: number) => (Math.round(value) === 1 ? "1 Comune simile su 100" : `${Math.round(value)} Comuni simili su 100`);
  return (
    <section className={styles.card} id="scheda" aria-labelledby="scheda-title">
      <div className={styles.cardHead}>
        <div>
          <p className={styles.eyebrow}>{regionName(entry.regionCode)} · {integer.format(entry.population)} abitanti</p>
          <h2 id="scheda-title" className={styles.cardTitle}>{name}</h2>
          <p className={styles.status}>{statusLabel(entry.status, entry.volatile)}</p>
        </div>
        {entry.score !== null ? (
          <div className={styles.scoreBox} data-score={entry.score}>
            <span className={styles.scoreValue}>{one.format(entry.score)}</span>
            <span className={styles.scoreMax}>/100</span>
            {entry.band ? <BandBadge band={entry.band} /> : null}
          </div>
        ) : null}
      </div>
      {entry.band && entry.bandStability !== null ? (
        <p className={styles.stabilityLine}>
          Fascia {entry.band} confermata in {integer.format(Math.round(entry.bandStability * snapshot.rules.sensitivity.draws))} ricalcoli su{" "}
          {integer.format(snapshot.rules.sensitivity.draws)} con pesi diversi: {stabilityLabel(entry.bandStability).toLocaleLowerCase("it-IT")}.
        </p>
      ) : null}

      {entry.status === "ranked" && entry.rank !== null ? (
        <dl className={styles.positions}>
          <div>
            <dt>In Italia</dt>
            <dd>{integer.format(entry.rank)}° su {integer.format(snapshot.summary.ranked)}</dd>
            {rankRange(entry) ? <small data-rank-range>con pesi diversi {rankRange(entry)}</small> : null}
          </div>
          {regional ? (
            <div data-regional-rank>
              <dt>In {regionName(entry.regionCode)}</dt>
              <dd>{integer.format(regional.rank)}° su {integer.format(regional.total)}</dd>
              <small>la classifica nazionale risente anche del divario tra territori</small>
            </div>
          ) : null}
          <div>
            <dt>Tra i Comuni simili</dt>
            <dd>{entry.peerRank}° su {entry.peerRanked}</dd>
            {group ? <small>confronto con {describeGroup(group)}</small> : null}
          </div>
        </dl>
      ) : null}

      {servicesVolatility(entry) ? (
        <p className={styles.warning} data-volatile>
          <strong>Dato da verificare.</strong> Secondo OpenCivitas i servizi di questo Comune sono cambiati di{" "}
          {integer.format(servicesVolatility(entry) ?? 0)} punti percentuali tra il 2021 e il 2022
          ({one.format(entry.services2021 ?? 0)}% e {one.format(entry.services2022 ?? 0)}% rispetto alla media). I dati sui servizi
          vengono dai questionari compilati dai Comuni: un salto così grande è più probabilmente un errore di compilazione che
          un cambiamento reale. Per questo il Comune non entra in classifica: il punteggio è indicativo.
        </p>
      ) : null}

      {entry.score !== null ? (
        <div className={styles.breakdown}>
          <div className={styles.stack} aria-hidden="true">
            {parts.map((part) => (part.points ? <span key={part.pillar} data-pillar={part.pillar} style={{ flexGrow: part.points }} /> : null))}
            <span className={styles.stackRest} style={{ flexGrow: Math.max(0, 100 - total) }} />
          </div>
          <p className={styles.readLine} data-read-guide>
            Ogni pilastro dà punti fino al suo peso. La barra mostra quanti Comuni simili fanno peggio: 70 vuol dire meglio di 70
            Comuni simili su 100, 50 è la media.
            {parts.some((part) => part.points === null) ? " Dove manca un pilastro, i pesi degli altri sono riproporzionati." : ""}
          </p>
          <ul className={styles.pillarRows}>
            {parts.map((part) => (
              <li key={part.pillar} data-pillar-card={part.pillar}>
                <div className={styles.pillarRowHead}>
                  <span className={styles.pillarDot} data-pillar={part.pillar} aria-hidden="true" />
                  <h3>{PILLAR_LABELS[part.pillar].title}</h3>
                  <span className={styles.pillarPoints} data-pillar-points={part.points ?? ""}>
                    {part.points === null ? "n.d." : one.format(part.points)} <small>su {Math.round(part.weight * 100)}</small>
                  </span>
                </div>
                <div className={styles.meter} aria-hidden="true">
                  <span style={{ width: `${part.percentile ?? 0}%` }} data-pillar={part.pillar} />
                </div>
                <p className={styles.keyFact}>{pillarKeyFact(entry, part.pillar)}</p>
                <p className={styles.better}>{part.percentile === null ? "Non valutabile: dati insufficienti" : `Meglio di ${better(part.percentile)}`}</p>
                {part.pillar === "resa" && entry.underspendWithoutCredit ? (
                  <p className={styles.cashNote}>Spende poco ma paga in ritardo: la spesa bassa non viene premiata.</p>
                ) : null}
                <details className={styles.why}>
                  <summary>Perché questo valore</summary>
                  <ul>
                    <li>{PILLAR_LABELS[part.pillar].question}</li>
                    {part.facts.map((fact) => <li key={fact}>{fact}</li>)}
                  </ul>
                </details>
              </li>
            ))}
            <li className={styles.pillarTotal}>
              <span>Punteggio</span>
              <span className={styles.pillarPoints}>{one.format(entry.score)}</span>
            </li>
          </ul>
        </div>
      ) : null}

      {highlights.best.length ? (
        <p className={styles.functions}>
          Rende di più in {highlights.best.join(" e ")}, di meno in {highlights.worst.join(" e ")}.
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
            <p className={styles.tagline}>Come spendono i Comuni italiani, confrontati con quelli simili per dimensione e territorio.</p>
            <p className={styles.pillarsLine}>
              <strong>Sei pilastri:</strong> {PILLARS.map((pillar) => PILLAR_LABELS[pillar].short).join(", ")}.
            </p>
            <p className={styles.heroLinks}>
              <a href="#regioni" className={styles.heroPrimary} data-ranking-link="hero">Vai alla classifica ↓</a>
              <Link href="/dvns-index/metodo" prefetch={false} data-method-link="hero">Come si calcola l&apos;indice →</Link>
            </p>
          </div>
          <div className={styles.heroChart}>
            <DotDistribution
              columns={data.dots.map((column) => column.length)}
              highlight={selected?.status === "ranked" ? locateDot(data.dots, selected.istat) : null}
              highlightLabel={selected ? displayMunicipalityName(selected.name) : ""}
            />
            <p className={styles.chartNote}>
              Ogni punto è un gruppo di circa {perDot} Comuni con punteggio simile.
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
            <span className="stat-note">su {integer.format(summary.municipalities)} Comuni italiani</span>
          </div>
          <div>
            <dt>Non in classifica</dt>
            <dd>{integer.format(summary.specialStatute + summary.partial)}</dd>
            <span className="stat-note">{integer.format(summary.specialStatute)} in Regioni a statuto speciale, {integer.format(summary.partial)} senza tutti i dati</span>
          </div>
          <div>
            <dt>Anni dei dati</dt>
            <dd>2021-2025</dd>
            <span className="stat-note">gli ultimi pubblicati per ogni fonte</span>
          </div>
        </dl>

        <aside className={styles.methodCallout} aria-label="Dati e indicatore">
          <p>
            I numeri di partenza vengono da fonti pubbliche (OpenCivitas, SIOPE, ANAC, Ragioneria Generale dello Stato, ISPRA)
            e non sono modificati: chiunque può verificarli. Il punteggio invece è un indicatore costruito da noi: scegliamo
            quali dati contano, come confrontare i Comuni e quanto pesa ogni aspetto. Ogni scelta è descritta nel{" "}
            <Link href="/dvns-index/metodo" prefetch={false} data-method-link="callout">metodo</Link>.
          </p>
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

        <section className={`panel ${styles.scrollTarget}`} id="regioni" aria-labelledby="regioni-title">
          <h2 id="regioni-title" className="panel-title">Le Regioni</h2>
          <p className={styles.lede}>
            Il colore è la fascia del Comune tipico di ogni Regione, con le stesse soglie della classifica nazionale. In ogni
            Regione ci sono Comuni di tutte le fasce, e le differenze dentro una Regione sono più grandi di quelle tra Regioni.
          </p>
          <RegionsMap regions={regionSummaries(snapshot.entries, summary.bandCutoffs)} cutoffs={summary.bandCutoffs} />
        </section>

        <section className="panel" aria-labelledby="classifica">
          <h2 id="classifica" className="panel-title">La classifica</h2>
          <p className={styles.lede}>
            Fasce da A a E: ogni fascia contiene un quinto dei Comuni in classifica. La posizione esatta conta meno della
            fascia: l&apos;ultima colonna mostra dove cade il Comune se cambiamo i pesi. I Comuni con servizi OpenCivitas
            molto variabili tra un anno e l&apos;altro restano fuori dalla classifica.
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
                  <th scope="col" className="num"><abbr title="Posizione">Pos.</abbr></th>
                  <th scope="col">Comune</th>
                  <th scope="col" className={`num ${styles.wideOnly}`}>Abitanti</th>
                  <th scope="col" className="num">Punteggio</th>
                  <th scope="col">Fascia</th>
                  <th scope="col">Con pesi diversi</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((entry) => (
                  <tr key={entry.istat} data-ranking-row={entry.istat}>
                    <td className="num">{integer.format(entry.rank ?? 0)}</td>
                    <th scope="row">
                      <Link href={comuneHref(entry)} prefetch={false}>{displayMunicipalityName(entry.name)}</Link>
                      <small className={styles.regionNote}>
                        <span data-region-note>{regionName(entry.regionCode)}</span>
                        <span className={styles.narrowOnly}> · {integer.format(entry.population)} ab.</span>
                      </small>
                    </th>
                    <td className={`num ${styles.wideOnly}`}>{integer.format(entry.population)}</td>
                    <td className="num">{one.format(entry.score ?? 0)}</td>
                    <td><BandBadge band={entry.band ?? ""} /></td>
                    <td className={styles.rangeCell}>{rankRange(entry)}</td>
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

        <details className={`panel ${styles.methodDetails}`} id="metodo">
          <summary>
            <h2 className="panel-title">Come si calcola</h2>
            <span className={styles.methodHint} aria-hidden="true" />
          </summary>
          <p className={styles.lede}>
            Qui trovi la sintesi; il{" "}
            <Link href="/dvns-index/metodo" prefetch={false}>metodo completo</Link> spiega ogni passaggio con un esempio.
          </p>
          <div className="table-scroll" role="region" aria-labelledby="pilastri-tabella" tabIndex={0}>
            <table className={`table ${styles.methodTable}`}>
              <caption id="pilastri-tabella" className="table-caption">I sei pilastri</caption>
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
                  <td>Metà peso alla quota degli investimenti sul totale di spesa corrente e investimenti, metà agli euro investiti per abitante. Più investimenti è meglio.</td>
                </tr>
                <tr>
                  <th scope="row">Apertura degli appalti</th><td className="num">{Math.round(rules.weights.appalti * 100)}%</td>
                  <td>ANAC: {integer.format(summary.anacProcedures)} CIG pubblicati nel 2025 e le aggiudicazioni dei CIG 2025.</td>
                  <td>
                    60%: quota del valore delle procedure sopra {integer.format(rules.procurementThresholdEuro)} € assegnata con affidamento diretto o negoziata senza bando.
                    40%: concentrazione del valore aggiudicato sui fornitori, esclusi rifiuti, energia e acqua. Meno è meglio.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Puntualità nei pagamenti</th><td className="num">{Math.round(rules.weights.puntualita * 100)}%</td>
                  <td>Piattaforma dei crediti commerciali (Ragioneria Generale dello Stato), fatture pagate nel 2024 e nel 2025.</td>
                  <td>Ritardo medio ponderato sull&apos;importo rispetto alla scadenza. Meno ritardo è meglio.</td>
                </tr>
                <tr>
                  <th scope="row">Risultati misurati</th><td className="num">{Math.round(rules.weights.risultati * 100)}%</td>
                  <td>ISPRA, Catasto rifiuti, 2022 e 2023.</td>
                  <td>Percentuale di raccolta differenziata, media dei due anni. Più alta è meglio.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <h3 className={styles.subtitle}>Criteri</h3>
          <ul className={styles.criteria}>
            <li><strong>Confronto tra simili.</strong> Ogni dato diventa un percentile tra i Comuni con la stessa fascia di popolazione e superficie, zona altimetrica, grado di urbanizzazione, costa e isole. Le città sopra i 100.000 abitanti si confrontano tra loro. Il punteggio da 0 a 100 è quindi già corretto per il contesto.</li>
            <li><strong>Appalti.</strong> Le adesioni a convenzioni Consip e gli affidamenti a società in house non contano né come gara né come affidamento diretto. Le procedure delegate a una centrale di committenza restano del Comune che le ha delegate. Servono almeno {rules.minProcedures} procedure o {rules.minAwards} aggiudicazioni; con pochi appalti il valore viene avvicinato alla mediana nazionale ({one.format(summary.medianWithoutTenderShare)}% del valore senza gara), così il caso non decide il voto. Se non ce ne sono abbastanza nemmeno per questo, il pilastro vale 50, la media: non premia e non penalizza.</li>
            <li><strong>Spesa bassa e cassa.</strong> Spendere meno del fabbisogno conta come efficienza solo se il Comune paga i fornitori nei tempi. Se paga in ritardo, la spesa bassa può essere mancanza di soldi e nel calcolo della resa contano solo i servizi.</li>
            <li><strong>Classifica.</strong> Entrano i Comuni con tutti i pilastri, appalti neutri compresi, e con servizi OpenCivitas coerenti tra i due anni (scarto massimo di {integer.format(rules.volatileServicesPoints)} punti). Le fasce sono quintili: A i migliori 20%, E gli ultimi 20%. Soglie attuali: A da {one.format(summary.bandCutoffs[0])}, B da {one.format(summary.bandCutoffs[1])}, C da {one.format(summary.bandCutoffs[2])}, D da {one.format(summary.bandCutoffs[3])}.</li>
            <li><strong>Solidità.</strong> Ricalcoliamo la classifica {integer.format(rules.sensitivity.draws)} volte spostando ogni peso fino a {Math.round(rules.sensitivity.spread * 100)} punti. La solidità è la quota di volte in cui il Comune resta nella stessa fascia.</li>
            <li><strong>Funzioni.</strong> &quot;Dove rende di più e di meno&quot; confronta il saldo tra servizi e spesa nelle sei funzioni OpenCivitas: {Object.values(FUNCTION_LABELS).join(", ")}.</li>
          </ul>
          <h3 className={styles.subtitle}>Cosa non dice</h3>
          <ul className={styles.criteria}>
            <li>Non misura la qualità dei servizi: OpenCivitas ne misura la quantità, per esempio posti negli asili o strade gestite.</li>
            <li>Non indica sprechi né illeciti. Un affidamento diretto è spesso legittimo: la quota senza gara dice quanto il Comune usa la concorrenza, non se ha violato regole.</li>
            <li>Fotografa periodi diversi: servizi e fabbisogni 2021-2022, gli ultimi pubblicati da OpenCivitas; raccolta differenziata 2022-2023; pagamenti 2024-2025; appalti 2025.</li>
            <li>Una parte della distanza tra Nord e Sud dipende dal contesto economico e non solo dall&apos;amministrazione: per questo la scheda mostra anche la posizione nella Regione.</li>
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
        </details>
      </div>
    </main>
  );
}
