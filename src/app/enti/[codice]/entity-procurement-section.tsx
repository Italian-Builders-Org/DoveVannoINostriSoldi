import type { ReactElement } from "react";
import Link from "next/link";
import { integer } from "@/lib/format";
import type {
  AnacEntityProcurementPageState,
  AnacEntityProcurementPageView,
} from "@/lib/data/anac-entity-procurement-page";
import { countAnacAwardAttributions } from "@/lib/data/anac-entity-procurement-page";
import styles from "./entity-procurement.module.css";

const APPALTI_PATH = "/enti/:codice/appalti";

function appaltiHref(codiceIpa: string, query = "view=summary"): string {
  return APPALTI_PATH.replace(":codice", encodeURIComponent(codiceIpa)) + "?" + query;
}

function formatDecimalEuro(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, rawFraction = ""] = unsigned.split(".");
  const digits = `${rawFraction}000`.slice(0, 3);
  let cents = Number(digits.slice(0, 2));
  let wholeValue = BigInt(whole || "0");
  if (Number(digits[2] ?? "0") >= 5) cents += 1;
  if (cents >= 100) {
    cents -= 100;
    wholeValue += BigInt(1);
  }
  const grouped = wholeValue.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${cents.toString().padStart(2, "0")} €`;
}

type SourceDetails = Readonly<{
  datasetPageUrl: string;
  resourcePageUrl: string;
  assetUrl: string;
  assetSha256: string;
  assetBytes: number;
  sourceLastModified?: string;
  metadataModifiedAt?: string | null;
  assetObservedAt?: string;
  encoding?: string;
  delimiter?: string;
  license: Readonly<{ name: string; url: string }>;
}>;

function sourceDetails(value: unknown): SourceDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const datasetPageUrl = typeof source.datasetPageUrl === "string" ? source.datasetPageUrl : null;
  const resourcePageUrl = typeof source.resourcePageUrl === "string" ? source.resourcePageUrl : null;
  const license = source.license;
  if (!datasetPageUrl || !resourcePageUrl || !license || typeof license !== "object" || Array.isArray(license)) return null;
  const licenseObject = license as Record<string, unknown>;
  if (typeof licenseObject.name !== "string" || typeof licenseObject.url !== "string") return null;
  const optionalString = (key: string): string | undefined => typeof source[key] === "string" ? source[key] as string : undefined;
  const optionalInteger = (key: string): number | undefined => {
    const value = source[key];
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  };
  const assetUrl = optionalString("downloadUrl") ?? optionalString("resourceUrl");
  const assetSha256 = optionalString("sha256") ?? optionalString("archiveSha256");
  const assetBytes = optionalInteger("bytes") ?? optionalInteger("archiveBytes");
  if (!assetUrl || !assetSha256 || !/^[a-f0-9]{64}$/.test(assetSha256) || assetBytes === undefined) return null;
  return {
    datasetPageUrl,
    resourcePageUrl,
    assetUrl,
    assetSha256,
    assetBytes,
    sourceLastModified: optionalString("sourceLastModified"),
    metadataModifiedAt: source.metadataModifiedAt === null ? null : optionalString("metadataModifiedAt"),
    assetObservedAt: optionalString("assetObservedAt"),
    encoding: optionalString("encoding"),
    delimiter: optionalString("delimiter"),
    license: { name: licenseObject.name, url: licenseObject.url },
  };
}

function SourceRow({ label, source }: { label: string; source: SourceDetails }): ReactElement {
  const wireFormat = [
    source.encoding,
    source.delimiter ? `delimitatore «${source.delimiter}»` : undefined,
  ].filter(Boolean).join(" · ");
  const dates = [
    source.sourceLastModified ? `ultima modifica sorgente: ${source.sourceLastModified}` : undefined,
    source.metadataModifiedAt ? `metadati: ${source.metadataModifiedAt}` : undefined,
    source.assetObservedAt ? `osservato: ${source.assetObservedAt}` : undefined,
  ].filter(Boolean).join(" · ");
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <a href={source.datasetPageUrl}>dataset</a>{" · "}
        <a href={source.resourcePageUrl}>pagina risorsa</a>{" · "}
        <a href={source.assetUrl}>asset verificato</a>{" · "}
        <a href={source.license.url}>{source.license.name}</a>
        {` · ${integer(source.assetBytes)} byte · SHA-256 `}<code>{source.assetSha256}</code>
        {wireFormat ? <> · {wireFormat}</> : null}
        {dates ? <> · {dates}</> : null}
      </dd>
    </div>
  );
}

export function EntityProcurementSourceDetails({ profile }: { profile: AnacEntityProcurementPageView }): ReactElement {
  const provenance = profile.meta.provenance;
  const ipa = sourceDetails(provenance.ipa);
  const awards = sourceDetails(provenance.awards);
  const awardees = sourceDetails(provenance.awardees);
  return (
    <>
      {ipa ? <SourceRow label="IPA · identità ente" source={ipa} /> : null}
      {awards ? <SourceRow label="ANAC · aggiudicazioni" source={awards} /> : null}
      {awardees ? <SourceRow label="ANAC · aggiudicatari" source={awardees} /> : null}
    </>
  );
}

function scopeLine(profile?: AnacEntityProcurementPageView): ReactElement {
  return (
    <p className={styles.scopeLine}>
      <strong>CIG pubblicati 2025</strong>
      <span aria-hidden="true">·</span>
      <span>snapshot cross-temporale</span>
      <span aria-hidden="true">·</span>
      <span>non è copertura nazionale corrente</span>
      {profile ? (
        <>
          <span aria-hidden="true">·</span>
          <span>tutti i mesi del 2025</span>
        </>
      ) : null}
    </p>
  );
}

function StateNotice({ state }: { state: Exclude<AnacEntityProcurementPageState, { status: "available" }> }) {
  const title = state.status === "identity_drift"
    ? "Il collegamento ANAC è cambiato"
    : state.status === "not_found"
      ? "Nessun profilo ANAC pubblicato"
      : "Dati ANAC non disponibili";
  return (
    <section className="panel" aria-labelledby="anac-procurement-title">
      <span className={styles.kicker}>ANAC · aggiudicazioni</span>
      <h2 className="panel-title" id="anac-procurement-title">Contratti e aggiudicatari</h2>
      {scopeLine()}
      <div className="notice warning-notice">
        <strong>{title}</strong>
        <p>{state.message}. Non trasformiamo l’assenza o il disallineamento in zero.</p>
      </div>
    </section>
  );
}

function Summary({ profile }: { profile: AnacEntityProcurementPageView }) {
  const summary = profile.summary;
  return (
    <div className={"stat-strip " + styles.summary} aria-label="Sintesi degli appalti ANAC">
      <div>
        <span className="stat-label">Procedure (CIG)</span>
        <Link className="stat-value" href={appaltiHref(profile.codiceIpa, "view=procedures")}>{integer(summary.procedureCount)}</Link>
        <span className="stat-note">CIG pubblicati nella coorte 2025</span>
      </div>
      <div>
        <span className="stat-label">Aggiudicazioni</span>
        <Link className="stat-value" href={appaltiHref(profile.codiceIpa, "view=awards")}>{integer(summary.awardCount)}</Link>
        <span className="stat-note">coppie CIG / identificativo aggiudicazione</span>
      </div>
      <div>
        <span className="stat-label">Valore dichiarato</span>
        <Link className="stat-value" href={appaltiHref(profile.codiceIpa, "view=awards")}>{formatDecimalEuro(summary.awardValue)}</Link>
        <span className="stat-note">importo di aggiudicazione, non pagamento</span>
      </div>
      <div>
        <span className="stat-label">Operatori economici identificati</span>
        <Link className="stat-value" href={appaltiHref(profile.codiceIpa, "view=operators")} aria-describedby="anac-operator-definition">{integer(summary.awardeeCount)}</Link>
        <span className="stat-note">operatori unici nelle relazioni pubblicate</span>
      </div>
    </div>
  );
}

function RankingTable({
  profile,
  byValue,
}: {
  profile: AnacEntityProcurementPageView;
  byValue: boolean;
}) {
  const rows = [...profile.operators]
    .filter((operator) => byValue ? operator.rankByValue !== null : true)
    .sort((left, right) => {
      const leftRank = byValue ? left.rankByValue ?? Number.MAX_SAFE_INTEGER : left.rankByCount;
      const rightRank = byValue ? right.rankByValue ?? Number.MAX_SAFE_INTEGER : right.rankByCount;
      return leftRank - rightRank || left.name.localeCompare(right.name, "it");
    })
    .slice(0, 10);
  const title = byValue ? "Ranking per valore attribuibile" : "Ranking per numero di aggiudicazioni";
  const id = byValue ? "anac-ranking-value" : "anac-ranking-count";
  return (
    <section className={styles.ranking} aria-labelledby={id}>
      <div className={styles.sectionHeading}>
        <div>
          <h3 id={id}>{title}</h3>
          <p>
            {byValue
              ? "Ordinato solo sugli importi attribuibili a un unico aggiudicatario."
              : "Ogni aggiudicazione distinta conta una volta; il valore non viene replicato nei multipartiti."}
          </p>
        </div>
        <Link className="btn btn-secondary" href={appaltiHref(profile.codiceIpa, byValue ? "view=operators&metric=value" : "view=operators&metric=count")}>
          Vedi classifica completa →
        </Link>
      </div>
      {rows.length > 0 ? (
        <div className="table-scroll" role="region" aria-label={title} tabIndex={0}>
          <p className={styles.tableHint}>Scorri la tabella verso destra →</p>
          <table className="table">
            <caption>{title} · primi {rows.length} risultati</caption>
            <thead>
              <tr>
                <th scope="col">Pos.</th>
                <th scope="col">Aggiudicatario</th>
                <th scope="col" className="num">Aggiudicazioni</th>
                <th scope="col" className="num">Valore attribuibile</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((operator) => {
                const query = "view=operator&operator=" + encodeURIComponent(operator.ref);
                return (
                  <tr key={operator.ref}>
                    <td className="num"><Link href={appaltiHref(profile.codiceIpa, query)}>{byValue ? operator.rankByValue : operator.rankByCount}</Link></td>
                    <th scope="row">
                      <Link href={appaltiHref(profile.codiceIpa, query)}>{operator.name}</Link>
                      {operator.nameVariants > 1 ? <small>{operator.nameVariants} denominazioni osservate; una canonica pubblicata</small> : null}
                    </th>
                    <td className="num"><Link href={appaltiHref(profile.codiceIpa, query)}>{integer(operator.awardCount)}</Link></td>
                    <td className="num"><Link href={appaltiHref(profile.codiceIpa, query)}>{formatDecimalEuro(operator.attributedValue)}</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.note}>Nessun valore attribuibile a un singolo aggiudicatario nel perimetro osservato.</p>
      )}
    </section>
  );
}

function Available({ profile }: { profile: AnacEntityProcurementPageView }) {
  const attributionCounts = countAnacAwardAttributions(profile.awards);
  return (
    <section className={`panel ${styles.alignedSection}`} aria-labelledby="anac-procurement-title" id="dati-anac-aggiudicazioni">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.kicker}>ANAC · aggiudicazioni</span>
          <h2 className={styles.sectionTitle} id="anac-procurement-title">Contratti e aggiudicatari</h2>
        </div>
      </div>
      {scopeLine(profile)}
      <Summary profile={profile} />
      <p className={styles.note}>
        Il valore è quello dichiarato nell&apos;aggiudicazione e non misura pagamenti.{" "}
        {attributionCounts.notAttributed > 0
          ? <><Link href={appaltiHref(profile.codiceIpa, "view=awards")}>{integer(attributionCounts.notAttributed)}</Link>{" casi non hanno un valore attribuibile individualmente: "}{integer(attributionCounts.multipart)}{" multipartiti, "}{integer(attributionCounts.ambiguous)}{" con identità ambigua e "}{integer(attributionCounts.noAwardee)}{" senza aggiudicatario pubblicato."}</>
          : "Le aggiudicazioni con più aggiudicatari non moltiplicano il valore."}
      </p>
      <p className={styles.note} id="anac-operator-definition">
        Operatori economici unici identificati nelle relazioni pubblicate. Nei casi multipartiti o ambigui, il conteggio non attribuisce individualmente il valore; i codici fiscali degli operatori non sono pubblicati.
      </p>
      <RankingTable profile={profile} byValue={false} />
      <RankingTable profile={profile} byValue />
      <details className={styles.provenance}>
        <summary>Fonte, periodo e controlli</summary>
        <dl>
          <div><dt>Generato</dt><dd>{profile.meta.generatedAt}</dd></div>
          <div><dt>Perimetro</dt><dd>CIG pubblicati 2025 · snapshot cross-temporale</dd></div>
          <div><dt>Importo</dt><dd>Importo di aggiudicazione dichiarato; non è un dato di pagamento.</dd></div>
          <div><dt>Identità</dt><dd>Il codice fiscale dell&apos;ente proviene da IPA ed è usato per il controllo di identità; i codici fiscali degli operatori non sono pubblicati.</dd></div>
          <EntityProcurementSourceDetails profile={profile} />
          <div><dt>Shard</dt><dd>Artifact hash-pinned e validato offline prima della lettura.</dd></div>
        </dl>
      </details>
    </section>
  );
}

export function EntityProcurementSection({ state }: { state: AnacEntityProcurementPageState }) {
  return state.status === "available" ? <Available profile={state.profile} /> : <StateNotice state={state} />;
}
