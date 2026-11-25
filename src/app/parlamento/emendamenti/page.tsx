import type { Metadata } from "next";
import Link from "next/link";

import {
  EXPLORER_OUTCOMES,
  EXPLORER_PAGE_SIZE,
  EXPLORER_QUERY_MAX,
  INADMISSIBILITY_REASONS,
  isExplorerQueryActive,
  parseExplorerQuery,
  queryAmendments,
  type AmendmentOutcome,
  type ExplorerQuery,
  type OutcomeSplit,
  type AmendmentSpending,
  type InadmissibilityReason,
} from "@/lib/manovra-emendamenti";
import { EmendamentiSnapshotUnavailableError, loadEmendamentiView, type EmendamentiPageData } from "@/lib/manovra-emendamenti-store";

import { BarChart, OUTCOME_LEGEND, type BarRow } from "./bar-chart";
import styles from "./emendamenti.module.css";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PAGE_PATH = "/parlamento/emendamenti";

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  // Filtered lists are views of the same page: one canonical URL, no indexing of the combinations.
  const filtered = Object.keys(await searchParams).length > 0;
  return {
    title: "Emendamenti alla manovra 2027: chi li firma, quanti sono inammissibili",
    description:
      "Le 6.558 proposte emendative alla legge di bilancio 2027 in Commissione Bilancio alla Camera: esito di ammissibilità, gruppi, firme, testi identici, coperture, Comuni nominati e spesa dichiarata, con le fonti ufficiali.",
    alternates: { canonical: PAGE_PATH },
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

function explorerHref(query: ExplorerQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.group) params.set("gruppo", query.group);
  if (query.outcome) params.set("esito", query.outcome);
  if (query.municipality) params.set("comune", "1");
  if (page > 1) params.set("pagina", String(page));
  const search = params.toString();
  return `${PAGE_PATH}${search ? `?${search}` : ""}#elenco`;
}

// The payload is read from dvns_snapshots at request time (once per instance), not at build time:
// a build without database must not freeze the "not available" state into a static page.
export const dynamic = "force-dynamic";

const integer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });
const oneDecimal = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

function pct(part: number, total: number): string {
  return total === 0 ? "n.d." : `${oneDecimal.format((part / total) * 100)}%`;
}

function euro(cents: number): string {
  const value = cents / 100;
  if (value >= 1_000_000_000) return `${compact.format(value / 1_000_000_000)} mld €`;
  if (value >= 1_000_000) return `${compact.format(value / 1_000_000)} mln €`;
  return `${integer.format(Math.round(value))} €`;
}

function italianDate(iso: string): string {
  return iso.split("-").reverse().join("/");
}

const OUTCOME_LABEL: Record<AmendmentOutcome, string> = {
  ammissibile: "Ammessa all'esame",
  parzialmente_inammissibile: "In parte inammissibile",
  inammissibile: "Inammissibile",
};

function OutcomeBadge({ outcome, reason }: { outcome: AmendmentOutcome; reason?: InadmissibilityReason | null }) {
  return (
    <span className={styles.badge} data-outcome={outcome}>
      {OUTCOME_LABEL[outcome]}
      {reason ? <span className={styles.badgeNote}>{INADMISSIBILITY_REASONS[reason].toLowerCase()}</span> : null}
    </span>
  );
}

function outcomeSegments(row: OutcomeSplit): BarRow["segments"] {
  return [
    { tone: "admissible", value: row.admissible },
    { tone: "partial", value: row.partial },
    { tone: "coverage", value: row.coverage },
    { tone: "matter", value: row.matter },
  ];
}

function SpendingCell({ spending }: { spending: AmendmentSpending | null }) {
  if (spending === null) return <span className={styles.muted}>nessuna formula di spesa letta</span>;
  if (spending.trienniumCents === null) return <span className={styles.muted}>importo non legato agli anni 2027-2029</span>;
  return (
    <>
      {euro(spending.trienniumCents)}
      {spending.permanent ? <span className={styles.cellNote}>prosegue dopo il 2029</span> : null}
    </>
  );
}

function Unavailable() {
  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Emendamenti alla manovra 2027</h1>
        <p>
          Dati temporaneamente non disponibili. La pagina legge uno snapshot verificato delle proposte pubblicate dalla
          Camera: quando non è raggiungibile o non corrisponde alla ricevuta pubblicata, non mostriamo numeri.
        </p>
      </div>
      <div className={styles.links}>
        <Link href="/parlamento">Spese di Camera, Senato e Quirinale</Link>
        <Link href="/manovra">Manovra a confronto</Link>
        <a href="https://www.camera.it/leg19/126?leg=19&idDocumento=3174-bis" target="_blank" rel="noreferrer">
          Scheda dell&apos;atto sul sito della Camera ↗
        </a>
      </div>
    </main>
  );
}

export default async function ManovraEmendamentiPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  let data: EmendamentiPageData;
  try {
    data = await loadEmendamentiView();
  } catch (error) {
    if (error instanceof EmendamentiSnapshotUnavailableError) return <Unavailable />;
    throw error;
  }
  const { act, source, deputiesSource, municipalitiesSource, view } = data;
  const { totals, municipalities, spending, signatures, identical } = view;
  const query = parseExplorerQuery(params, new Set(data.groups.map((group) => group.id)));
  const result = queryAmendments(data.rows, query);
  const filtering = isExplorerQueryActive(query);
  const coverageBy = Object.fromEntries(view.coverage.map((row) => [row.key, row.amendments]));
  const withCoverage = totals.amendments - (coverageBy.none ?? 0);
  const coveredByFunds = withCoverage - (coverageBy.other ?? 0);
  const majority = view.coalitions.find((row) => row.key === "maggioranza");
  const opposition = view.coalitions.find((row) => row.key === "opposizione");
  const sitting = italianDate(act.sittingDate);
  const reasons = (Object.keys(INADMISSIBILITY_REASONS) as InadmissibilityReason[])
    .map((reason) => ({ reason, label: INADMISSIBILITY_REASONS[reason], amendments: totals.byReason[reason] }))
    .sort((a, b) => b.amendments - a.amendments);
  const compensation = totals.inadmissible - totals.byReason.estraneita_materia;
  const comparable = municipalities.sameRegion.yes + municipalities.sameRegion.no;
  const outcomeParts = [
    { key: "ammissibile", tone: "admissible", label: "Ammesse all'esame", value: totals.admissible },
    { key: "parzialmente_inammissibile", tone: "partial", label: "In parte inammissibili", value: totals.partiallyInadmissible },
    { key: "inammissibile", tone: "coverage", label: "Inammissibili", value: totals.inadmissible },
  ] as const;

  return (
    <main className="shell page">
      <div className="page-intro">
        <nav className={styles.breadcrumb} aria-label="Percorso">
          <Link href="/parlamento">Parlamento</Link>
          <span aria-hidden="true">/</span>
          <span>Emendamenti alla manovra 2027</span>
        </nav>
        <h1>Emendamenti alla manovra 2027: {integer.format(totals.amendments)} proposte alla Camera</h1>
        <p>
          Sono le proposte di modifica al disegno di legge di bilancio 2027 ({act.number}) presentate in Commissione
          Bilancio e pubblicate nell&apos;elenco della seduta del {sitting}. {integer.format(totals.inadmissible)} sono state
          dichiarate inammissibili ({pct(totals.inadmissible, totals.amendments)}): {integer.format(compensation)} per
          problemi di copertura, {integer.format(totals.byReason.estraneita_materia)} perché estranee alla materia della
          legge di bilancio.
        </p>
        <nav className={styles.toc} aria-label="In questa pagina">
          <a href="#ammissibilita">Ammissibilità</a>
          <a href="#gruppi">Gruppi e schieramenti</a>
          <a href="#firme">Firme e testi identici</a>
          <a href="#articoli">Articoli</a>
          <a href="#comuni">Comuni</a>
          <a href="#spesa">Spesa e coperture</a>
          <a href="#elenco">Cerca una proposta</a>
        </nav>
      </div>

      <dl className="stat-strip">
        <div>
          <dt>Proposte pubblicate</dt>
          <dd>{integer.format(totals.amendments)}</dd>
          <span className="stat-note">su {integer.format(totals.sections)} tra articoli e tabelle</span>
        </div>
        <div>
          <dt>Dichiarate inammissibili</dt>
          <dd>{pct(totals.inadmissible, totals.amendments)}</dd>
          <span className="stat-note">{integer.format(totals.inadmissible)} proposte, più {integer.format(totals.partiallyInadmissible)} in parte</span>
        </div>
        <div>
          <dt>Nominano un solo Comune</dt>
          <dd>{integer.format(municipalities.rows.length)}</dd>
          <span className="stat-note">{integer.format(municipalities.distinctMunicipalities)} Comuni diversi, letti dal testo</span>
        </div>
        <div>
          <dt>Con una sola firma</dt>
          <dd>{integer.format(totals.singleSigner)}</dd>
          <span className="stat-note">{pct(totals.singleSigner, totals.amendments)} del totale</span>
        </div>
      </dl>

      <div className={styles.sections}>
        <section className="panel" aria-labelledby="ammissibilita">
          <h2 id="ammissibilita" className="panel-title">Il vaglio di ammissibilità</h2>
          <p className={styles.lede}>
            Prima di votare, la presidenza della Commissione scarta le proposte che non rispettano le regole della legge
            di bilancio. Qui c&apos;è l&apos;esito scritto nell&apos;elenco del {sitting}: ricorsi e riammissioni successive non
            sono inclusi.
          </p>
          <div
            className={styles.stack}
            role="img"
            aria-label={outcomeParts.map((part) => `${part.label}: ${integer.format(part.value)}`).join("; ")}
          >
            {outcomeParts.map((part) => (
              <span key={part.key} data-tone={part.tone} style={{ flexGrow: part.value }} />
            ))}
          </div>
          <ul className={styles.legend}>
            {outcomeParts.map((part) => (
              <li key={part.key} data-outcome-total={part.key}>
                <span className={styles.swatch} data-tone={part.tone} aria-hidden="true" />
                <strong>{integer.format(part.value)}</strong> {part.label.toLowerCase()} ({pct(part.value, totals.amendments)})
              </li>
            ))}
          </ul>
          <h3 className={styles.subtitle}>Perché sono state dichiarate inammissibili</h3>
          <BarChart
            title="Motivo dell'inammissibilità, come annotato dalla Camera"
            rows={reasons.map((row) => ({
              key: row.reason,
              label: row.label,
              segments: [{ tone: row.reason === "estraneita_materia" ? "matter" : "coverage", value: row.amendments }],
              value: integer.format(row.amendments),
              aside: `${pct(row.amendments, totals.inadmissible)} delle inammissibili`,
            }))}
            table={{
              columns: ["Proposte", "Quota delle inammissibili"],
              rows: reasons.map((row) => ({ label: row.label, values: [integer.format(row.amendments), pct(row.amendments, totals.inadmissible)] })),
            }}
          />
          <p className={styles.note}>
            «Compensazione» è la copertura: una proposta che aumenta la spesa o riduce le entrate deve indicare da dove
            prende le risorse. «Estraneità di materia» riguarda norme che la legge di bilancio non può contenere, per
            esempio interventi localistici o microsettoriali.
          </p>
        </section>

        <section className="panel" aria-labelledby="gruppi">
          <h2 id="gruppi" className="panel-title">Chi le ha presentate</h2>
          <p className={styles.lede}>
            Ogni proposta è attribuita al gruppo del primo firmatario. Il rapporto per deputato serve a confrontare gruppi
            di dimensioni diverse: non dice quanti deputati hanno davvero firmato.
          </p>
          {majority && opposition ? (
            <p className={styles.callout}>
              I gruppi di opposizione hanno depositato {integer.format(opposition.amendments)} proposte ({pct(opposition.amendments, totals.amendments)}),
              quelli di maggioranza {integer.format(majority.amendments)} ({pct(majority.amendments, totals.amendments)}). Quota di
              inammissibili: {pct(majority.inadmissible, majority.amendments)} per la maggioranza,{" "}
              {pct(opposition.inadmissible, opposition.amendments)} per l&apos;opposizione.
            </p>
          ) : null}
          <BarChart
            title="Proposte per schieramento del primo firmatario, divise per esito"
            legend={OUTCOME_LEGEND}
            rows={view.coalitions.map((row) => ({
              key: row.key,
              label: row.label,
              note:
                row.members === null || row.perMember === null
                  ? undefined
                  : `${integer.format(row.members)} deputati · ${oneDecimal.format(row.perMember)} proposte a testa`,
              segments: outcomeSegments(row),
              value: integer.format(row.amendments),
              aside: `${pct(row.inadmissible, row.amendments)} inammissibili`,
            }))}
            table={{
              columns: ["Proposte", "Ammesse all'esame", "In parte inammissibili", "Inammissibili per copertura", "Inammissibili per estraneità"],
              rows: view.coalitions.map((row) => ({
                label: row.label,
                values: [row.amendments, row.admissible, row.partial, row.coverage, row.matter].map((value) => integer.format(value)),
              })),
            }}
          />
          <p className={styles.note}>
            Maggioranza: Fratelli d&apos;Italia, Lega, Forza Italia, Noi Moderati. Opposizione: Partito Democratico, MoVimento 5
            Stelle, Alleanza Verdi e Sinistra, Azione, Italia Viva. Il gruppo Misto riunisce componenti diverse e resta a parte.
            La collocazione è nostra, non un dato della Camera.
          </p>

          <h3 className={styles.subtitle}>Gruppo per gruppo</h3>
          <BarChart
            title="Proposte per gruppo del primo firmatario, divise per esito"
            legend={OUTCOME_LEGEND}
            rows={view.groups.map((group) => ({
              key: group.id,
              label: group.label,
              note:
                group.members === null || group.perMember === null
                  ? undefined
                  : `${integer.format(group.members)} deputati · ${oneDecimal.format(group.perMember)} proposte a testa`,
              segments: outcomeSegments(group),
              value: integer.format(group.amendments),
              aside: `${pct(group.inadmissible, group.amendments)} inammissibili`,
            }))}
            table={{
              columns: ["Proposte", "Per deputato", "Ammesse all'esame", "In parte inammissibili", "Inammissibili per copertura", "Inammissibili per estraneità", "Con una sola firma"],
              rows: view.groups.map((group) => ({
                label: group.label,
                values: [
                  integer.format(group.amendments),
                  group.perMember === null ? "n.a." : oneDecimal.format(group.perMember),
                  integer.format(group.admissible),
                  integer.format(group.partial),
                  integer.format(group.coverage),
                  integer.format(group.matter),
                  integer.format(group.singleSigner),
                ],
              })),
            }}
          />
          <p className={styles.note}>
            Gruppi e numero di deputati vengono dall&apos;anagrafica open data della Camera acquisita il{" "}
            {italianDate(deputiesSource.acquiredAt)}.
            {totals.withoutGroup > 0
              ? ` ${integer.format(totals.withoutGroup)} proposte hanno un primo firmatario che non era in quell'anagrafica: restano nel totale ma fuori dalla tabella.`
              : ""}
          </p>

          <h3 className={styles.subtitle}>I dieci primi firmatari con più proposte</h3>
          <div className="table-scroll" role="region" aria-labelledby="firmatari-tabella" tabIndex={0}>
            <table className="table">
              <caption id="firmatari-tabella" className="table-caption">Proposte in cui il deputato è il primo firmatario</caption>
              <thead>
                <tr>
                  <th scope="col">Primo firmatario</th>
                  <th scope="col" className="num">Proposte</th>
                  <th scope="col" className="num">Inammissibili</th>
                  <th scope="col" className="num">Con una sola firma</th>
                </tr>
              </thead>
              <tbody>
                {view.proponents.map((row) => (
                  <tr key={row.name}>
                    <th scope="row">
                      {row.name}
                      <span className={styles.cellNote}>{row.groupLabel ?? "gruppo non presente nell'anagrafica acquisita"}</span>
                    </th>
                    <td className="num">{integer.format(row.amendments)}</td>
                    <td className="num">{integer.format(row.inadmissible)}</td>
                    <td className="num">{integer.format(row.singleSigner)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel" aria-labelledby="firme">
          <h2 id="firme" className="panel-title">Firme e testi identici</h2>
          <p className={styles.lede}>
            {integer.format(totals.singleSigner)} proposte hanno una sola firma. {integer.format(signatures.multiGroup)} sono
            firmate da deputati di gruppi diversi, e {integer.format(signatures.acrossCoalitions)} uniscono gruppi di maggioranza
            e di opposizione.
          </p>
          <BarChart
            title="Proposte per numero di firme"
            rows={signatures.bands.map((band) => ({
              key: band.label,
              label: band.label,
              segments: [{ tone: "plain", value: band.amendments }],
              value: integer.format(band.amendments),
              aside: `${pct(band.amendments, totals.amendments)} del totale`,
            }))}
            table={{
              columns: ["Proposte", "Quota"],
              rows: signatures.bands.map((band) => ({ label: band.label, values: [integer.format(band.amendments), pct(band.amendments, totals.amendments)] })),
            }}
          />

          {signatures.widest.length > 0 ? (
            <>
              <h3 className={styles.subtitle}>Le proposte firmate da più gruppi</h3>
              <div className="table-scroll" role="region" aria-labelledby="trasversali-tabella" tabIndex={0}>
                <table className={`table ${styles.cards}`}>
                  <caption id="trasversali-tabella" className="table-caption">Proposte con firmatari del maggior numero di gruppi</caption>
                  <thead>
                    <tr>
                      <th scope="col">Proposta</th>
                      <th scope="col">Gruppi dei firmatari</th>
                      <th scope="col" className="num">Firme</th>
                      <th scope="col">Esito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signatures.widest.map((row) => (
                      <tr key={row.id} data-shared={row.id}>
                        <th scope="row">
                          <a href={row.url} target="_blank" rel="noreferrer" aria-label={`Proposta ${row.id} sul sito della Camera, in una nuova scheda`}>
                            {row.id} ↗
                          </a>
                          {row.title ? <span className={styles.cellNote}>{row.title}</span> : null}
                        </th>
                        <td>
                          {integer.format(row.groups.length)} gruppi
                          <span className={styles.cellNote}>{row.groups.join(" · ")}</span>
                        </td>
                        <td className="num" data-label="Firme">{integer.format(row.signers)}</td>
                        <td><OutcomeBadge outcome={row.outcome} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          <h3 className={styles.subtitle}>Lo stesso testo, depositato più volte</h3>
          <p className={styles.lede}>
            {integer.format(identical.amendments)} proposte sono copie identiche di almeno un&apos;altra: i testi diversi sono{" "}
            {integer.format(identical.clusters)}. In {integer.format(identical.crossGroup)} casi lo stesso testo arriva da gruppi
            diversi, in {integer.format(identical.acrossCoalitions)} sia dalla maggioranza sia dall&apos;opposizione.
          </p>
          <div className="table-scroll" role="region" aria-labelledby="identici-tabella" tabIndex={0}>
            <table className={`table ${styles.cards}`}>
              <caption id="identici-tabella" className="table-caption">I testi con più copie identiche, secondo l&apos;elenco della Camera</caption>
              <thead>
                <tr>
                  <th scope="col">Prima proposta del gruppo</th>
                  <th scope="col">Gruppi dei primi firmatari</th>
                  <th scope="col" className="num">Copie</th>
                </tr>
              </thead>
              <tbody>
                {identical.largest.map((row) => (
                  <tr key={row.id} data-identical={row.id}>
                    <th scope="row">
                      <a href={row.url} target="_blank" rel="noreferrer" aria-label={`Proposta ${row.id} sul sito della Camera, in una nuova scheda`}>
                        {row.id} ↗
                      </a>
                      {row.title ? <span className={styles.cellNote}>{row.title}</span> : null}
                      <span className={styles.cellNote}>Identiche: {row.ids.join(", ")}</span>
                    </th>
                    <td>{row.groups.join(" · ")}</td>
                    <td className="num" data-label="Copie">{integer.format(row.copies)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.note}>
            L&apos;elenco della Camera segnala i testi identici, ma non dice chi li ha scritti né perché coincidono.
          </p>
        </section>

        <section className="panel" aria-labelledby="articoli">
          <h2 id="articoli" className="panel-title">Gli articoli più emendati</h2>
          <p className={styles.lede}>
            Le proposte sono raggruppate per articolo del disegno di legge. Gli articoli aggiuntivi, che propongono norme
            nuove, sono contati con l&apos;articolo dopo il quale chiedono di essere inseriti.
          </p>
          <BarChart
            title="I dieci articoli con più proposte, divise per esito"
            legend={OUTCOME_LEGEND}
            rows={view.sections.map((section) => ({
              key: section.section,
              label: section.section,
              segments: outcomeSegments(section),
              value: integer.format(section.amendments),
              aside: `${pct(section.inadmissible, section.amendments)} inammissibili`,
            }))}
            table={{
              columns: ["Proposte", "Ammesse all'esame", "In parte inammissibili", "Inammissibili per copertura", "Inammissibili per estraneità"],
              rows: view.sections.map((section) => ({
                label: section.section,
                values: [section.amendments, section.admissible, section.partial, section.coverage, section.matter].map((value) => integer.format(value)),
              })),
            }}
          />
        </section>

        <section className="panel" aria-labelledby="comuni">
          <h2 id="comuni" className="panel-title">Le proposte che nominano un solo Comune</h2>
          <p className={styles.lede}>
            {integer.format(municipalities.amendmentsNamingAny)} proposte nominano almeno un Comune nel testo;{" "}
            {integer.format(municipalities.rows.length)} ne nominano uno solo, per {integer.format(municipalities.distinctMunicipalities)} Comuni
            diversi. {comparable > 0 ? (
              <>
                In {integer.format(municipalities.sameRegion.yes)} casi su {integer.format(comparable)} il Comune è nella
                regione in cui il primo firmatario è stato eletto ({pct(municipalities.sameRegion.yes, comparable)}).
              </>
            ) : null}
          </p>
          {municipalities.regions.length > 0 ? (
            <BarChart
              title="Proposte con un solo Comune, per regione del Comune"
              rows={municipalities.regions.map((region) => ({
                key: region.code,
                label: region.name,
                segments: [{ tone: "place", value: region.amendments }],
                value: integer.format(region.amendments),
                aside: region.municipalities === 1 ? "1 Comune" : `${integer.format(region.municipalities)} Comuni`,
              }))}
              table={{
                columns: ["Proposte", "Comuni diversi"],
                rows: municipalities.regions.map((region) => ({ label: region.name, values: [integer.format(region.amendments), integer.format(region.municipalities)] })),
              }}
            />
          ) : null}
          <p className={styles.note}>
            Un Comune è contato quando il testo scrive «comune di», «comuni di» o «città di» seguito da un nome
            dell&apos;elenco ISTAT. Nominare un Comune non significa destinargli fondi: la frase da cui lo leggiamo è riportata
            in ogni riga, e il testo completo è sul sito della Camera.
            {municipalities.withAmbiguousOnly > 0
              ? ` ${integer.format(municipalities.withAmbiguousOnly)} proposte nominano solo Comuni con un omonimo in un'altra provincia e non sono attribuite.`
              : ""}
          </p>

          <h3 className={styles.subtitle} id="elenco-comuni">Tutte le {integer.format(municipalities.rows.length)} proposte</h3>
          <div className={`table-scroll ${styles.tall}`} role="region" aria-labelledby="elenco-comuni" tabIndex={0}>
            <table className={`table ${styles.cards}`}>
              <thead>
                <tr>
                  <th scope="col">Proposta</th>
                  <th scope="col">Comune</th>
                  <th scope="col">Primo firmatario</th>
                  <th scope="col">Esito</th>
                  <th scope="col" className="num">Spesa dichiarata 2027-2029</th>
                </tr>
              </thead>
              <tbody>
                {municipalities.rows.map((row) => (
                  <tr key={row.id} data-amendment={row.id}>
                    <th scope="row">
                      <a href={row.url} target="_blank" rel="noreferrer" aria-label={`Proposta ${row.id} sul sito della Camera, in una nuova scheda`}>
                        {row.id} ↗
                      </a>
                      <span className={styles.cellNote}>{row.section}</span>
                    </th>
                    <td>
                      <strong>{row.municipality.name}</strong>
                      <span className={styles.cellNote}>
                        {row.regionName}
                        {row.municipality.population === null ? "" : ` · ${integer.format(row.municipality.population)} abitanti`}
                      </span>
                      <span className={styles.evidence}>«{row.evidence}»</span>
                    </td>
                    <td>
                      {row.proponentName}
                      <span className={styles.cellNote}>
                        {row.groupLabel ?? "gruppo non presente nell'anagrafica acquisita"}
                        {row.signers > 1 ? ` · ${integer.format(row.signers)} firme` : " · firma unica"}
                      </span>
                      <span className={styles.cellNote}>
                        {row.sameRegion === null
                          ? "circoscrizione non confrontabile"
                          : `eletto in ${row.constituency}: ${row.sameRegion ? "stessa regione" : "altra regione"}`}
                      </span>
                    </td>
                    <td><OutcomeBadge outcome={row.outcome} reason={row.reason} /></td>
                    <td className="num" data-label="Spesa dichiarata 2027-2029"><SpendingCell spending={row.spending} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {municipalities.repeated.length > 0 ? (
            <>
              <h3 className={styles.subtitle}>I Comuni nominati più volte</h3>
              <ul className={styles.chips}>
                {municipalities.repeated.map((entry) => (
                  <li key={entry.municipality.istatCode}>
                    <strong>{entry.municipality.name}</strong> ({entry.regionName}): {integer.format(entry.amendments)} proposte
                  </li>
                ))}
              </ul>
              <p className={styles.note}>Qui contiamo ogni proposta che nomina il Comune, anche insieme ad altri.</p>
            </>
          ) : null}
        </section>

        <section className="panel" aria-labelledby="spesa">
          <h2 id="spesa" className="panel-title">Quanta spesa dichiarano i testi</h2>
          <p className={styles.lede}>
            {integer.format(spending.declared)} proposte contengono una formula esplicita di spesa, come «è autorizzata la
            spesa di» o «con una dotazione di». Per {integer.format(spending.withTriennium)} il testo lega ogni importo agli
            anni del triennio 2027-2029; per {integer.format(spending.withoutYears)} no, oppure riguarda solo altri anni, e
            non lo distribuiamo noi.
          </p>
          <BarChart
            title="Proposte per spesa dichiarata nel triennio 2027-2029"
            rows={spending.classes.map((item) => ({
              key: item.label,
              label: item.label,
              segments: [{ tone: "plain", value: item.amendments }],
              value: integer.format(item.amendments),
              aside: `${pct(item.amendments, spending.withTriennium)} di quelle con anni`,
            }))}
            table={{
              columns: ["Proposte"],
              rows: spending.classes.map((item) => ({ label: item.label, values: [integer.format(item.amendments)] })),
            }}
          />
          <p className={styles.note}>
            Non sommiamo gli importi tra proposte: molte sono identiche o alternative tra loro, quasi tutte indicano una
            copertura che riduce altri fondi, e la Camera non pubblica una relazione tecnica per ciascuna. La somma non
            sarebbe il costo di nulla.
          </p>

          <h3 className={styles.subtitle}>Le dieci con la spesa dichiarata più alta</h3>
          <div className="table-scroll" role="region" aria-labelledby="maggiori-tabella" tabIndex={0}>
            <table className={`table ${styles.cards}`}>
              <caption id="maggiori-tabella" className="table-caption">Importi scritti nel testo, triennio 2027-2029</caption>
              <thead>
                <tr>
                  <th scope="col">Proposta</th>
                  <th scope="col">Primo firmatario</th>
                  <th scope="col">Esito</th>
                  <th scope="col" className="num">Spesa dichiarata</th>
                </tr>
              </thead>
              <tbody>
                {spending.largest.map((row) => (
                  <tr key={row.id} data-largest={row.id}>
                    <th scope="row">
                      <a href={row.url} target="_blank" rel="noreferrer" aria-label={`Proposta ${row.id} sul sito della Camera, in una nuova scheda`}>
                        {row.id} ↗
                      </a>
                      {row.title ? <span className={styles.cellNote}>{row.title}</span> : null}
                      <span className={styles.evidence}>«{row.spending.evidence}»</span>
                    </th>
                    <td>
                      {row.proponentName}
                      <span className={styles.cellNote}>{row.groupLabel ?? "gruppo non presente nell'anagrafica acquisita"}</span>
                    </td>
                    <td><OutcomeBadge outcome={row.outcome} /></td>
                    <td className="num" data-label="Spesa dichiarata 2027-2029"><SpendingCell spending={row.spending} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel" aria-labelledby="coperture">
          <h2 id="coperture" className="panel-title">Da dove dicono di prendere i soldi</h2>
          <p className={styles.lede}>
            Chi propone una spesa deve indicare la copertura. {integer.format(coveredByFunds)} delle{" "}
            {integer.format(withCoverage)} proposte con una clausola di copertura riducono uno dei due fondi di riserva
            del bilancio ({pct(coveredByFunds, withCoverage)}).
          </p>
          <BarChart
            title="Proposte per fondo citato nella clausola di copertura"
            rows={view.coverage.map((row) => ({
              key: row.key,
              label: row.label,
              segments: [{ tone: row.key === "none" ? "partial" : "plain", value: row.amendments }],
              value: integer.format(row.amendments),
              aside: `${pct(row.amendments, totals.amendments)} del totale`,
            }))}
            table={{
              columns: ["Proposte", "Quota"],
              rows: view.coverage.map((row) => ({ label: row.label, values: [integer.format(row.amendments), pct(row.amendments, totals.amendments)] })),
            }}
          />
          <p className={styles.note}>
            Leggiamo le frasi con «si provvede», «mediante corrispondente riduzione» o «a valere su». Il FISPE è il fondo
            dell&apos;articolo 10, comma 5, del decreto-legge 282 del 2004; il Fondo per le esigenze indifferibili è quello
            dell&apos;articolo 1, comma 200, della legge 190 del 2014. Senza clausola non significa senza costi: molte proposte
            cambiano norme o importi senza una frase di copertura.
          </p>
        </section>

        <section className="panel" aria-labelledby="elenco">
          <h2 id="elenco" className="panel-title">Cerca tra le {integer.format(totals.amendments)} proposte</h2>
          <p className={styles.lede}>
            Cerca per numero, primo firmatario, titolo o Comune. Ogni riga porta al testo ufficiale sul sito della Camera.
          </p>
          <form className={styles.filters} action={PAGE_PATH + "#elenco"} method="get" role="search" aria-label="Cerca tra le proposte">
            <label>
              <span>Parole da cercare</span>
              <input type="search" name="q" defaultValue={query.q} maxLength={EXPLORER_QUERY_MAX} placeholder="Es. 89.010, Furfaro, asili nido" />
            </label>
            <label>
              <span>Gruppo del primo firmatario</span>
              <select name="gruppo" defaultValue={query.group}>
                <option value="">Tutti i gruppi</option>
                {data.groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Esito</span>
              <select name="esito" defaultValue={query.outcome}>
                <option value="">Tutti gli esiti</option>
                {Object.entries(EXPLORER_OUTCOMES).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className={styles.check}>
              <input type="checkbox" name="comune" value="1" defaultChecked={query.municipality} />
              <span>Solo proposte che nominano un Comune</span>
            </label>
            <div className={styles.filterActions}>
              <button type="submit">Cerca</button>
              {filtering ? <Link href={`${PAGE_PATH}#elenco`}>Azzera i filtri</Link> : null}
            </div>
          </form>
          <p className={styles.resultCount} role="status" data-result-total={result.total}>
            {result.total === 0
              ? "Nessuna proposta corrisponde ai filtri."
              : `${integer.format(result.total)} proposte${filtering ? " trovate" : ""} · pagina ${integer.format(result.page)} di ${integer.format(result.pages)}`}
          </p>
          {result.total > 0 ? (
            <>
              <div className="table-scroll" role="region" aria-labelledby="elenco-tabella" tabIndex={0}>
                <table className={`table ${styles.cards}`}>
                  <caption id="elenco-tabella" className="table-caption">Proposte in ordine di pubblicazione, {EXPLORER_PAGE_SIZE} per pagina</caption>
                  <thead>
                    <tr>
                      <th scope="col">Proposta</th>
                      <th scope="col">Primo firmatario</th>
                      <th scope="col">Esito</th>
                      <th scope="col" className="num">Spesa dichiarata 2027-2029</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={row.id} data-row={row.id}>
                        <th scope="row">
                          <a href={row.url} target="_blank" rel="noreferrer" aria-label={`Proposta ${row.id} sul sito della Camera, in una nuova scheda`}>
                            {row.id} ↗
                          </a>
                          <span className={styles.cellNote}>
                            {row.section}
                            {row.title ? ` · ${row.title}` : ""}
                          </span>
                          {row.municipalities.length > 0 ? (
                            <span className={styles.cellNote}>Comuni nominati: {row.municipalities.slice(0, 4).join(", ")}{row.municipalities.length > 4 ? ` e altri ${row.municipalities.length - 4}` : ""}</span>
                          ) : null}
                        </th>
                        <td>
                          {row.proponentName}
                          <span className={styles.cellNote}>
                            {row.groupLabel ?? "gruppo non presente nell'anagrafica acquisita"}
                            {row.signers > 1 ? ` · ${integer.format(row.signers)} firme` : " · firma unica"}
                          </span>
                        </td>
                        <td>
                          <OutcomeBadge outcome={row.outcome} reason={row.reason} />
                          {row.partialNote ? <span className={styles.cellNote}>{row.partialNote}</span> : null}
                        </td>
                        <td className="num" data-label="Spesa dichiarata 2027-2029">
                          {row.spending === null ? (
                            <span className={styles.muted}>nessuna formula di spesa letta</span>
                          ) : row.spending.trienniumCents === null ? (
                            <span className={styles.muted}>importo non legato agli anni 2027-2029</span>
                          ) : (
                            <>
                              {euro(row.spending.trienniumCents)}
                              {row.spending.permanent ? <span className={styles.cellNote}>prosegue dopo il 2029</span> : null}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.pages > 1 ? (
                <nav className={styles.pager} aria-label="Pagine dell'elenco">
                  {result.page > 1 ? <Link href={explorerHref(query, result.page - 1)} rel="prev" prefetch={false}>← Precedente</Link> : <span aria-hidden="true" />}
                  <span>Pagina {integer.format(result.page)} di {integer.format(result.pages)}</span>
                  {result.page < result.pages ? <Link href={explorerHref(query, result.page + 1)} rel="next" prefetch={false}>Successiva →</Link> : <span aria-hidden="true" />}
                </nav>
              ) : null}
            </>
          ) : null}
        </section>

        <section className="panel" aria-labelledby="come-leggere">
          <h2 id="come-leggere" className="panel-title">Come leggere questi dati</h2>
          <ul className={styles.points}>
            <li>
              Una proposta emendativa è una richiesta di modifica, non una spesa decisa: la maggior parte non viene
              approvata, e quelle approvate entrano nel testo solo con il voto finale.
            </li>
            <li>
              {integer.format(totals.withIdentical)} proposte hanno almeno una proposta identica presentata da altri: il
              numero totale conta i testi depositati, non le idee diverse.
            </li>
            <li>
              Esito, firmatari e numero vengono dall&apos;elenco e dalle pagine ufficiali. Comuni e importi sono letti dal
              testo con regole fisse e prudenti: restano fuori i Comuni citati in altre forme e gli importi scritti in
              modo diverso dalle formule indicate.
            </li>
            <li>
              Presentare molte proposte o vedersele dichiarare inammissibili non misura la qualità del lavoro di un
              gruppo o di un deputato.
            </li>
          </ul>
        </section>

        <section className="panel" aria-labelledby="fonti">
          <h2 id="fonti" className="panel-title">Fonti</h2>
          <ul className={styles.sources}>
            <li data-source="camera-emendamenti">
              <a href={source.listUrl} target="_blank" rel="noreferrer" aria-label={`${source.owner}: elenco delle proposte emendative, in una nuova scheda`}>
                {source.owner}: elenco delle proposte emendative a {act.number}, seduta del {sitting} ↗
              </a>
              <small>
                {act.committee}, {act.stage} · {integer.format(source.pages)} pagine ufficiali acquisite il {italianDate(source.acquiredAt)} ·{" "}
                {source.license}
              </small>
            </li>
            <li data-source="camera-atto">
              <a href={act.actUrl} target="_blank" rel="noreferrer" aria-label={`${source.owner}: scheda dell'atto ${act.number}, in una nuova scheda`}>
                {source.owner}: scheda dell&apos;atto {act.number} ↗
              </a>
              <small>{act.title}</small>
            </li>
            <li data-source="camera-deputati">
              <a href={deputiesSource.landingUrl} target="_blank" rel="noreferrer" aria-label={`${deputiesSource.owner}: open data dei deputati, in una nuova scheda`}>
                {deputiesSource.owner}: anagrafica open data di deputati e gruppi ↗
              </a>
              <small>Acquisita il {italianDate(deputiesSource.acquiredAt)} · {deputiesSource.license}</small>
            </li>
            <li data-source="istat-comuni">
              <a href={municipalitiesSource.landingUrl} target="_blank" rel="noreferrer" aria-label="ISTAT: elenco dei Comuni, in una nuova scheda">
                ISTAT: elenco dei Comuni (SITUAS) ↗
              </a>
              <small>
                Situazione al {italianDate(municipalitiesSource.referenceDate)} · usato per riconoscere i nomi dei Comuni, la regione e
                la popolazione
              </small>
            </li>
          </ul>
          <div className={styles.links}>
            <Link href="/parlamento">Spese di Camera, Senato e Quirinale</Link>
            <Link href="/parlamento/indennita">Indennità dei deputati e salari</Link>
            <Link href="/manovra">Manovra a confronto</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
