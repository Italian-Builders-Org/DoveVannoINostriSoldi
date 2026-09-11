import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { integer, longDate } from "@/lib/format";
import {
  BELOW_THRESHOLD_REQUIRED_INPUTS,
  BELOW_THRESHOLD_STATUS,
  OPERATOR_THRESHOLD_METHODOLOGY_URL,
  anacCigDetailUrl,
  describeDistinctContractingAuthorities,
  distinctContractingAuthorities,
  publishedProcedureFields,
} from "@/lib/anac-operator-award-insights";
import { getAnacOperatorByRef } from "@/lib/data/anac-operator-records";
import {
  ANAC_OPERATOR_INDEX,
  isAnacOperatorRef,
  loadAnacOperatorIndexMeta,
} from "@/lib/data/anac-operator-awards-index";
import styles from "../operatori.module.css";

type PageProps = {
  params: Promise<{ ref: string }>;
};

function formatDecimalEuro(value: string | null): string {
  if (value === null) return "n.d.";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function yearRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return "anni non disponibili";
  if (min === max) return String(min);
  return `${min ?? "?"}-${max ?? "?"}`;
}

function amountStatusLabel(status: string): string {
  switch (status) {
    case "positive-exact-cent":
      return "positivo (centesimi)";
    case "positive-subcent":
      return "positivo (oltre 2 decimali)";
    case "zero":
      return "zero";
    case "negative":
      return "negativo in fonte";
    case "missing":
      return "mancante in fonte";
    case "invalid":
      return "non valido in fonte";
    case "conflicting":
      return "conflittuale in fonte";
    default:
      return status;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { ref } = await params;
  if (!isAnacOperatorRef(ref)) {
    return { title: "Operatore non trovato", robots: { index: false, follow: false } };
  }
  const operator = getAnacOperatorByRef(ref);
  if (!operator) {
    return { title: "Operatore non trovato", robots: { index: false, follow: false } };
  }
  return {
    title: `${operator.name} · aggiudicazioni ANAC`,
    description: `Aggiudicazioni ANAC per ${operator.name}: conteggi e importi di aggiudicazione dichiarati.`,
    robots: { index: false, follow: false },
  };
}

export default async function OperatoreDetailPage({ params }: PageProps) {
  const { ref } = await params;
  if (!isAnacOperatorRef(ref)) notFound();
  const operator = getAnacOperatorByRef(ref);
  if (!operator) notFound();
  const meta = loadAnacOperatorIndexMeta();
  const authorityCount = distinctContractingAuthorities(operator.topContractingAuthorities);

  return (
    <main className={`shell page ${styles.page}`}>
      <nav aria-label="Percorso">
        <Link href="/appalti">Appalti pubblici</Link> /{" "}
        <Link href="/appalti/operatori">Imprese aggiudicatarie</Link> / Scheda
      </nav>
      <div className="page-intro">
        <p className={styles.eyebrow}>Scheda operatore · ref opaco {operator.ref}</p>
        <h1>{operator.name}</h1>
        <p>
          Riepilogo delle aggiudicazioni nei full snapshot ANAC. Il codice fiscale non è
          pubblicato. Varianti di denominazione osservate: {integer(operator.nameVariants)}.
        </p>
      </div>

      <div className={`stat-strip ${styles.stats}`} aria-label="Riepilogo operatore">
        <div>
          <span className="stat-label">Aggiudicazioni</span>
          <strong className="stat-value">{integer(operator.awardCount)}</strong>
          <span className="stat-note">{yearRange(operator.yearMin, operator.yearMax)}</span>
        </div>
        <div>
          <span className="stat-label">Valore attribuibile</span>
          <strong className="stat-value">{formatDecimalEuro(operator.attributedValue)}</strong>
          <span className="stat-note">
            {integer(operator.attributedAwardCount)} aggiudicazioni a operatore unico
          </span>
        </div>
      </div>

      <aside className="notice" aria-labelledby="operatore-caveat">
        <h2 id="operatore-caveat">Chi è questo soggetto (da fonte)</h2>
        <p>
          Denominazione e aggiudicazioni da snapshot ANAC aggiudicatari/aggiudicazioni; oggetto,
          CPV e stazione appaltante dai CIG annuali 2007-2025 quando il CIG è presente in quei file.
          Qui sotto: fino a {ANAC_OPERATOR_INDEX.maxAwardsPublished} CIG più recenti. Gli euro sono
          importi di aggiudicazione, non pagamenti. Varianti di nome:{" "}
          {integer(operator.nameVariants)}
          {operator.procedureMatchedAwards !== undefined
            ? ` · procedure CIG abbinate: ${integer(operator.procedureMatchedAwards)}/${integer(operator.awardsPublished)}`
            : ""}
          .
        </p>
        {operator.topCpv && operator.topCpv.length > 0 ? (
          <p>
            CPV osservati:{" "}
            {operator.topCpv.map((item) => `${item.label} (${integer(item.count)})`).join(" · ")}.
          </p>
        ) : null}
        {operator.topContractingAuthorities && operator.topContractingAuthorities.length > 0 ? (
          <p>
            {describeDistinctContractingAuthorities(authorityCount)} tra le aggiudicazioni
            pubblicate e abbinate ai CIG annuali:{" "}
            {operator.topContractingAuthorities
              .map((item) => `${item.label} (${integer(item.count)})`)
              .join(" · ")}
            {authorityCount.capped ? " (elenco limitato alle prime 5 voci)" : ""}.
          </p>
        ) : null}
      </aside>

      <section aria-labelledby="operatore-awards-title">
        <h2 id="operatore-awards-title">Aggiudicazioni pubblicate</h2>
        <p className={styles.note}>
          Mostrate {integer(operator.awardsPublished)} di {integer(operator.awardCount)}{" "}
          aggiudicazioni
          {operator.awardsTruncated
            ? ` (massimo ${ANAC_OPERATOR_INDEX.maxAwardsPublished} più recenti)`
            : ""}
          .
        </p>
        <div className="table-scroll" role="region" aria-label="Tabella aggiudicazioni" tabIndex={0}>
          <table className="table">
            <caption>CIG, procedura ANAC, data, importo dichiarato e attributo</caption>
            <thead>
              <tr>
                <th scope="col">CIG</th>
                <th scope="col">Oggetto / CPV / SA</th>
                <th scope="col">Data</th>
                <th scope="col" className="num">
                  Importo dichiarato
                </th>
                <th scope="col">Stato importo</th>
                <th scope="col">Attributo</th>
              </tr>
            </thead>
            <tbody>
              {operator.awards.map((award) => {
                const procedure = publishedProcedureFields(award.procedure);
                const cigUrl = anacCigDetailUrl(award.cig);
                return (
                <tr key={`${award.cig}-${award.awardId}`}>
                  <th scope="row">
                    {cigUrl ? (
                      <a href={cigUrl} target="_blank" rel="noreferrer">
                        {award.cig} ↗
                      </a>
                    ) : (
                      award.cig
                    )}
                  </th>
                  <td>
                    {procedure ? (
                      <>
                        <div>{procedure.oggetto ?? "oggetto n.d. in CIG"}</div>
                        <div className={styles.note}>
                          {[
                            procedure.cpvLabel || procedure.cpvCode
                              ? `CPV ${procedure.cpvLabel ?? procedure.cpvCode}`
                              : null,
                            procedure.contractingAuthority
                              ? `SA ${procedure.contractingAuthority}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "dettaglio procedura parziale"}
                        </div>
                      </>
                    ) : (
                      <span className={styles.note}>CIG non abbinato agli snapshot 2007-2025</span>
                    )}
                  </td>
                  <td>{award.awardedAt ? longDate(award.awardedAt) : "n.d."}</td>
                  <td className="num">{formatDecimalEuro(award.amount)}</td>
                  <td>{amountStatusLabel(award.amountStatus)}</td>
                  <td>
                    {award.attribution === "single-operator"
                      ? "operatore unico"
                      : "multi-operatore"}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="operatore-sotto-soglia-title">
        <h2 id="operatore-sotto-soglia-title" className="panel-title">Sotto soglia: stato pubblicato</h2>
        <p>
          Per questi affidamenti lo stato è <strong>{BELOW_THRESHOLD_STATUS}</strong>. Non
          pubblichiamo un numero di affidamenti sotto soglia, né per l&apos;impresa né per il
          singolo CIG, perché non è determinabile dai campi che abbiamo: una soglia unica applicata
          a tutti gli importi sarebbe sbagliata, dato che la soglia dipende dal periodo, dalla
          categoria e dal settore della gara.
        </p>
        <p className={styles.note}>Per classificare un affidamento servirebbero, riga per riga:</p>
        <ul className={styles.requiredInputs}>
          {BELOW_THRESHOLD_REQUIRED_INPUTS.map((input) => (
            <li key={input}>{input}.</li>
          ))}
        </ul>
        <p className={styles.note}>
          L&apos;importo in tabella è l&apos;importo di aggiudicazione dichiarato in ANAC, non il
          valore stimato a base di gara, e non è un pagamento. Essere aggiudicatari frequenti, o
          avere importi vicini a una soglia, non indica di per sé un illecito.{" "}
          <a href={OPERATOR_THRESHOLD_METHODOLOGY_URL} target="_blank" rel="noreferrer">
            Metodo e dati richiesti ↗
          </a>
          {" · "}
          <Link href="/appalti">Fascia di soglia sui CIG 2025 →</Link>
        </p>
      </section>

      <section className="panel" aria-labelledby="operatore-source-title">
        <h2 id="operatore-source-title">Fonte</h2>
        <p>
          Snapshot osservato il {meta.observedAt.slice(0, 10)}. Licenza CC BY-SA 4.0. Ogni CIG in
          tabella apre il dettaglio ufficiale ANAC, così il numero resta riconducibile al record di
          origine.{" "}
          <Link href="/appalti/operatori">Torna alla ricerca</Link>.
        </p>
      </section>
    </main>
  );
}
