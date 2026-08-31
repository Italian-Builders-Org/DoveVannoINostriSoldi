import type { ReactElement } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { integer } from "@/lib/format";
import {
  clampEntityProcurementPage,
  countAnacAwardAttributions,
  decodeEntityProcurementRouteCode,
  getEntityProcurementPage,
  type AnacEntityProcurementPageView,
} from "@/lib/data/anac-entity-procurement-page";
import { getIpaEntityByCode } from "@/lib/ipa";
import { EntityProcurementSection, EntityProcurementSourceDetails } from "../entity-procurement-section";
import styles from "./appalti.module.css";

type PageProps = {
  params: Promise<{ codice: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

type ProcurementView = "summary" | "operators" | "procedures" | "awards" | "operator";
type RankingMetric = "count" | "value";

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function formatDecimalEuro(value: string | null): string {
  if (value === null) return "non disponibile";
  const [whole, fraction = ""] = value.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (fraction ? "," + fraction : ",00") + " €";
}

function attributionLabel(value: AnacEntityProcurementPageView["awards"][number]["attribution"]): string {
  switch (value) {
    case "single-operator": return "aggiudicatario singolo";
    case "multipart": return "più aggiudicatari · valore non attribuito";
    case "ambiguous": return "identità aggiudicatario ambigua · valore non attribuito";
    case "no-awardee": return "nessun aggiudicatario pubblicato";
  }
}

function amountStatusLabel(value: AnacEntityProcurementPageView["awards"][number]["amountStatus"]): string {
  switch (value) {
    case "positive-exact-cent": return "importo positivo ai centesimi";
    case "positive-subcent": return "importo positivo con frazioni di centesimo";
    case "zero": return "importo zero";
    case "negative": return "importo negativo";
    case "missing": return "importo mancante";
    case "invalid": return "importo non valido";
    case "conflicting": return "importo in conflitto";
  }
}

function awardStatusLabel(award: AnacEntityProcurementPageView["awards"][number]): string {
  const attribution = attributionLabel(award.attribution);
  return award.amountStatus === "conflicting"
    ? `${attribution}; importo in conflitto, escluso dal valore`
    : `${attribution}; ${amountStatusLabel(award.amountStatus)}`;
}

function pageSize(value: string): 25 | 50 {
  return value === "50" ? 50 : 25;
}

function totalRowsForView(
  profile: AnacEntityProcurementPageView,
  selectedView: ProcurementView,
  operatorRef: string | undefined,
  metric: RankingMetric,
): number {
  if (selectedView === "operators") {
    return profile.operators.filter((operator) => metric === "count" || operator.rankByValue !== null).length;
  }
  if (selectedView === "procedures") return profile.procedures.length;
  if (selectedView === "operator") return profile.awards.filter((award) => !operatorRef || award.operatorRefs.includes(operatorRef)).length;
  if (selectedView === "awards") return profile.awards.length;
  return 1;
}

function view(value: string): ProcurementView {
  return value === "operators" || value === "procedures" || value === "awards" || value === "operator"
    ? value
    : "summary";
}

function href(codice: string, values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const query = params.toString();
  return "/enti/" + encodeURIComponent(codice) + "/appalti" + (query ? "?" + query : "");
}

function scopeLine(): ReactElement {
  return (
    <p className={styles.scopeLine}>
      <strong>CIG pubblicati 2025</strong>
      <span aria-hidden="true">·</span>
      <span>snapshot cross-temporale</span>
      <span aria-hidden="true">·</span>
      <span>non è copertura nazionale corrente</span>
      <span aria-hidden="true">·</span>
      <span>tutti i mesi del 2025</span>
    </p>
  );
}

function Pager({
  codice,
  currentPage,
  total,
  size,
  values,
}: {
  codice: string;
  currentPage: number;
  total: number;
  size: 25 | 50;
  values: Record<string, string | number | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages < 2) return null;
  return (
    <nav className={styles.pager} aria-label="Paginazione">
      {currentPage > 1 ? <Link href={href(codice, { ...values, page: currentPage - 1, pageSize: size })}>← Precedente</Link> : <span aria-disabled="true">← Precedente</span>}
      <span>Pagina {currentPage} di {pages}</span>
      {currentPage < pages ? <Link href={href(codice, { ...values, page: currentPage + 1, pageSize: size })}>Successiva →</Link> : <span aria-disabled="true">Successiva →</span>}
    </nav>
  );
}

function Views({ codice, active, operator, metric }: { codice: string; active: ProcurementView; operator?: string; metric: RankingMetric }) {
  const links: Array<[ProcurementView, string]> = [
    ["summary", "Sintesi"],
    ["operators", "Aggiudicatari"],
    ["procedures", "Procedure"],
    ["awards", "Aggiudicazioni"],
  ];
  return (
    <nav className={styles.views} aria-label="Vista dati ANAC">
      {links.map(([key, label]) => (
        <Link key={key} className={active === key ? styles.activeView : undefined} href={href(codice, { view: key, operator, metric })} aria-current={active === key ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

function RankingMetricToggle({ codice, metric, size }: { codice: string; metric: RankingMetric; size: 25 | 50 }) {
  return (
    <nav className={styles.views} aria-label="Ordine della classifica aggiudicatari">
      <span>Ordina per:</span>
      <Link
        className={metric === "count" ? styles.activeView : undefined}
        href={href(codice, { view: "operators", metric: "count", pageSize: size })}
        aria-current={metric === "count" ? "page" : undefined}
        aria-label="Numero di aggiudicazioni"
      >
        Numero
      </Link>
      <Link
        className={metric === "value" ? styles.activeView : undefined}
        href={href(codice, { view: "operators", metric: "value", pageSize: size })}
        aria-current={metric === "value" ? "page" : undefined}
        aria-label="Valore attribuibile"
      >
        Valore
      </Link>
    </nav>
  );
}

function Summary({ profile, codice }: { profile: AnacEntityProcurementPageView; codice: string }) {
  const s = profile.summary;
  const attributionCounts = countAnacAwardAttributions(profile.awards);
  return (
    <section className="panel" aria-labelledby="summary-title">
      <h2 className="panel-title" id="summary-title">Sintesi del perimetro</h2>
      <div className={styles.summaryGrid}>
        <Link href={href(codice, { view: "procedures" })}><span>Procedure (CIG)</span><strong>{integer(s.procedureCount)}</strong></Link>
        <Link href={href(codice, { view: "awards" })}><span>Aggiudicazioni</span><strong>{integer(s.awardCount)}</strong></Link>
        <Link href={href(codice, { view: "awards" })}><span>Valore dichiarato</span><strong>{formatDecimalEuro(s.awardValue)}</strong></Link>
        <Link href={href(codice, { view: "operators" })} aria-describedby="operators-definition"><span>Operatori economici identificati</span><strong>{integer(s.awardeeCount)}</strong></Link>
      </div>
      <p className={styles.note}>
        L&apos;importo di aggiudicazione è dichiarato nella fonte e non equivale a un pagamento.
        {attributionCounts.notAttributed > 0 ? <> {integer(attributionCounts.notAttributed)} casi non hanno un valore attribuibile individualmente: {integer(attributionCounts.multipart)} multipartiti, {integer(attributionCounts.ambiguous)} con identità ambigua e {integer(attributionCounts.noAwardee)} senza aggiudicatario pubblicato.</> : ""}
      </p>
      <p className={styles.note} id="operators-definition">
        Operatori economici unici identificati nelle relazioni pubblicate; nei casi multipartiti o ambigui il conteggio non attribuisce individualmente il valore.
      </p>
    </section>
  );
}

function Operators({
  profile,
  codice,
  currentPage,
  size,
  metric,
}: {
  profile: AnacEntityProcurementPageView;
  codice: string;
  currentPage: number;
  size: 25 | 50;
  metric: RankingMetric;
}) {
  const rows = [...profile.operators]
    .filter((operator) => metric === "count" || operator.rankByValue !== null)
    .sort((left, right) => {
      const leftRank = metric === "value" ? left.rankByValue ?? Number.MAX_SAFE_INTEGER : left.rankByCount;
      const rightRank = metric === "value" ? right.rankByValue ?? Number.MAX_SAFE_INTEGER : right.rankByCount;
      return leftRank - rightRank || left.name.localeCompare(right.name, "it");
    });
  const pageRows = rows.slice((currentPage - 1) * size, currentPage * size);
  return (
    <section className="panel" aria-labelledby="operators-title">
      <h2 className="panel-title" id="operators-title">Ranking completo degli aggiudicatari · {metric === "value" ? "valore" : "numero di aggiudicazioni"}</h2>
      <div className="table-scroll" role="region" aria-label="Ranking completo degli aggiudicatari" tabIndex={0}>
        <p className={styles.tableHint}>Scorri la tabella verso destra →</p>
        <table className="table">
          <caption>Aggiudicatari ordinati per {metric === "value" ? "valore attribuibile" : "numero di aggiudicazioni"}</caption>
          <thead><tr><th scope="col">Pos.</th><th scope="col">Aggiudicatario</th><th scope="col" className="num">Aggiudicazioni</th><th scope="col" className="num">Valore attribuibile</th></tr></thead>
          <tbody>
            {pageRows.map((operator) => (
              <tr key={operator.ref}>
                <td className="num"><Link href={href(codice, { view: "operator", operator: operator.ref, metric })}>{metric === "value" ? operator.rankByValue : operator.rankByCount}</Link></td>
                <th scope="row"><Link href={href(codice, { view: "operator", operator: operator.ref })}>{operator.name}</Link></th>
                <td className="num"><Link href={href(codice, { view: "operator", operator: operator.ref })}>{integer(operator.awardCount)}</Link></td>
                <td className="num"><Link href={href(codice, { view: "operator", operator: operator.ref })}>{formatDecimalEuro(operator.attributedValue)}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager codice={codice} currentPage={currentPage} total={rows.length} size={size} values={{ view: "operators", metric }} />
    </section>
  );
}

function Procedures({
  profile,
  codice,
  currentPage,
  size,
}: {
  profile: AnacEntityProcurementPageView;
  codice: string;
  currentPage: number;
  size: 25 | 50;
}) {
  const rows = [...profile.procedures].sort((left, right) => (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "") || left.cig.localeCompare(right.cig));
  const pageRows = rows.slice((currentPage - 1) * size, currentPage * size);
  return (
    <section className="panel" aria-labelledby="procedures-title">
      <h2 className="panel-title" id="procedures-title">Procedure pubblicate</h2>
      <div className="table-scroll" role="region" aria-label="Procedure ANAC" tabIndex={0}>
        <p className={styles.tableHint}>Scorri la tabella verso destra →</p>
        <table className="table">
          <caption>CIG pubblicati nel periodo</caption>
          <thead><tr><th scope="col">CIG</th><th scope="col">Pubblicato</th><th scope="col">Fonte</th></tr></thead>
          <tbody>
            {pageRows.map((procedure) => (
              <tr key={procedure.cig}>
                <th scope="row"><a href={"https://dati.anticorruzione.it/superset/dashboard/dettaglio_cig/?cig=" + encodeURIComponent(procedure.cig)} target="_blank" rel="noreferrer">{procedure.cig} ↗</a></th>
                <td>{procedure.publishedAt ?? "non disponibile"}</td>
                <td>ANAC · dettaglio CIG</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager codice={codice} currentPage={currentPage} total={rows.length} size={size} values={{ view: "procedures" }} />
    </section>
  );
}

function Awards({
  profile,
  codice,
  currentPage,
  size,
  operator,
}: {
  profile: AnacEntityProcurementPageView;
  codice: string;
  currentPage: number;
  size: 25 | 50;
  operator?: string;
}) {
  const rows = [...profile.awards]
    .filter((award) => !operator || award.operatorRefs.includes(operator))
    .sort((left, right) => (right.awardedAt ?? "").localeCompare(left.awardedAt ?? "") || left.cig.localeCompare(right.cig) || left.awardId.localeCompare(right.awardId));
  const pageRows = rows.slice((currentPage - 1) * size, currentPage * size);
  return (
    <section className="panel" aria-labelledby="awards-title">
      <h2 className="panel-title" id="awards-title">{operator ? "Aggiudicazioni dell’aggiudicatario" : "Aggiudicazioni pubblicate"}</h2>
      <div className="table-scroll" role="region" aria-label="Aggiudicazioni ANAC" tabIndex={0}>
        <p className={styles.tableHint}>Scorri la tabella verso destra →</p>
        <table className="table">
          <caption>Aggiudicazioni distinte per coppia CIG e identificativo</caption>
          <thead><tr><th scope="col">CIG</th><th scope="col">ID aggiudicazione</th><th scope="col">Data</th><th scope="col" className="num">Importo</th><th scope="col">Stato</th></tr></thead>
          <tbody>
            {pageRows.map((award) => (
              <tr key={award.cig + ":" + award.awardId}>
                <th scope="row"><a href={"https://dati.anticorruzione.it/superset/dashboard/dettaglio_cig/?cig=" + encodeURIComponent(award.cig)} target="_blank" rel="noreferrer">{award.cig} ↗</a></th>
                <td>{award.awardId}</td>
                <td>{award.awardedAt ?? "non disponibile"}</td>
                <td className="num">{formatDecimalEuro(award.amount)}</td>
                <td>{awardStatusLabel(award)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager codice={codice} currentPage={currentPage} total={rows.length} size={size} values={{ view: operator ? "operator" : "awards", operator }} />
    </section>
  );
}

function OperatorDetail({ profile, codice, operatorRef, currentPage, size }: {
  profile: AnacEntityProcurementPageView;
  codice: string;
  operatorRef: string;
  currentPage: number;
  size: 25 | 50;
}) {
  const operator = profile.operators.find((candidate) => candidate.ref === operatorRef);
  if (!operator) return <div className="notice warning-notice"><strong>Aggiudicatario non trovato</strong><p>Il riferimento richiesto non appartiene al profilo pubblicato.</p></div>;
  return (
    <>
      <section className="panel" aria-labelledby="operator-title">
        <h2 className="panel-title" id="operator-title">{operator.name}</h2>
        <div className={styles.operatorFacts}>
          <div><span>Aggiudicazioni</span><Link href={href(codice, { view: "operator", operator: operatorRef })}><strong>{integer(operator.awardCount)}</strong></Link></div>
          <div><span>Aggiudicazioni con valore attribuito</span><Link href={href(codice, { view: "operator", operator: operatorRef })}><strong>{integer(operator.attributedAwardCount)}</strong></Link></div>
          <div><span>Valore attribuibile</span><Link href={href(codice, { view: "operator", operator: operatorRef })}><strong>{formatDecimalEuro(operator.attributedValue)}</strong></Link></div>
        </div>
        {operator.nameVariants > 1 ? <p className={styles.note}>Il dataset segnala {operator.nameVariants} denominazioni osservate; una canonica è pubblicata, senza elencare le varianti né usarle come identificativi.</p> : null}
      </section>
      <Awards profile={profile} codice={codice} currentPage={currentPage} size={size} operator={operatorRef} />
    </>
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { codice } = await params;
  const normalizedCode = decodeEntityProcurementRouteCode(codice);
  if (!normalizedCode) notFound();
  try {
    const entity = await getIpaEntityByCode(normalizedCode);
    return { title: "Appalti · " + (entity?.denominazione ?? normalizedCode) };
  } catch {
    return { title: "Appalti · " + normalizedCode };
  }
}

export default async function EntityProcurementPage({ params, searchParams }: PageProps) {
  const { codice } = await params;
  const normalizedCode = decodeEntityProcurementRouteCode(codice);
  if (!normalizedCode) notFound();
  const entity = await getIpaEntityByCode(normalizedCode);
  if (!entity) notFound();
  const state = await getEntityProcurementPage(entity);
  if (state.status !== "available") {
    return (
      <main className={"shell page " + styles.page}>
        <p><Link href={"/enti/" + encodeURIComponent(normalizedCode)}>← Torna alla scheda ente</Link></p>
        <EntityProcurementSection state={state} />
      </main>
    );
  }
  const profile = state.profile;
  const query = await searchParams;
  const selectedView = view(first(query.view));
  const metric: RankingMetric = first(query.metric) === "value" ? "value" : "count";
  const operatorRef = first(query.operator) || undefined;
  const size = pageSize(first(query.pageSize));
  const currentPage = clampEntityProcurementPage(
    first(query.page),
    totalRowsForView(profile, selectedView, operatorRef, metric),
    size,
  );
  return (
    <main className={"shell page " + styles.page}>
      <p><Link href={"/enti/" + encodeURIComponent(normalizedCode)}>← Torna alla scheda ente</Link></p>
      <div className="page-intro">
        <h1>Aggiudicazioni ANAC · {entity.denominazione || normalizedCode}</h1>
        <p>Procedure, aggiudicazioni e aggiudicatari collegati a questo ente.</p>
      </div>
      {scopeLine()}
      <Views codice={normalizedCode} active={selectedView} operator={operatorRef} metric={metric} />
      {selectedView === "operators" ? <RankingMetricToggle codice={normalizedCode} metric={metric} size={size} /> : null}
      <div className={styles.pageSize}>
        <span>Righe per pagina:</span>
        <Link href={href(normalizedCode, { view: selectedView, operator: operatorRef, metric, pageSize: 25 })} aria-current={size === 25 ? "page" : undefined}>25</Link>
        <Link href={href(normalizedCode, { view: selectedView, operator: operatorRef, metric, pageSize: 50 })} aria-current={size === 50 ? "page" : undefined}>50</Link>
      </div>
      {selectedView === "summary" ? <Summary profile={profile} codice={normalizedCode} /> : null}
      {selectedView === "operators" ? <Operators profile={profile} codice={normalizedCode} currentPage={currentPage} size={size} metric={metric} /> : null}
      {selectedView === "procedures" ? <Procedures profile={profile} codice={normalizedCode} currentPage={currentPage} size={size} /> : null}
      {selectedView === "awards" ? <Awards profile={profile} codice={normalizedCode} currentPage={currentPage} size={size} /> : null}
      {selectedView === "operator" && operatorRef ? <OperatorDetail profile={profile} codice={normalizedCode} operatorRef={operatorRef} currentPage={currentPage} size={size} /> : null}
      <section className="panel" aria-labelledby="method-title">
        <h2 className="panel-title" id="method-title">Fonte e limiti</h2>
        <p className={styles.note}>Snapshot CIG pubblicati 2025, cross-temporale: non è copertura nazionale corrente. L&apos;importo di aggiudicazione è dichiarato e non è un pagamento. Il codice fiscale dell&apos;ente proviene da IPA ed è usato per controllare l&apos;identità; i codici fiscali degli aggiudicatari/operatori non sono pubblicati.</p>
        <p className={styles.note}>Le righe sono pagine del profilo hash-pinned; i conflitti e i casi senza attribuzione restano indicati nella tabella.</p>
        <dl className={styles.sourceList}>
          <div><dt>Generato</dt><dd>{profile.meta.generatedAt}</dd></div>
          <div><dt>Perimetro temporale</dt><dd>CIG pubblicati nel 2025 · tutti i mesi · snapshot cross-temporale</dd></div>
          <EntityProcurementSourceDetails profile={profile} />
        </dl>
      </section>
    </main>
  );
}
