import Link from "next/link";
import { HomeMonthlyChart } from "@/components/charts/home-monthly-chart";
import { InfoTooltip } from "@/components/info-tooltip";
import { ItalyRegionsMap } from "@/components/italy-regions-map";
import { classifyFreshness } from "@/lib/data/freshness";
import { SOURCE_POLICIES } from "@/lib/data/source-policy";
import {
  openCoesionePaymentCostRatio,
  openCoesioneSnapshot as cohesion,
} from "@/lib/opencoesione-snapshot";
import { siopeMunicipalSnapshot as siope } from "@/lib/siope-snapshot";
import { publicSources, sourceCounts } from "@/lib/sources";
import { auditScenarios, procurementComparison } from "@/lib/audit-data";
import styles from "./home.module.css";

const integer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const exactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

function compactEuro(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("it-IT", { maximumFractionDigits: 2 })} mld €`;
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mln €`;
  }
  return exactEuro.format(value);
}

function date(value: string | null): string {
  if (!value) return "non disponibile";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "non disponibile";
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Rome",
  }).format(parsed);
}

const period = `gennaio–${siope.latestMonthLabel.toLocaleLowerCase("it-IT")} ${siope.year}`;
const coverageRatio =
  siope.coverage.activeSiopeMunicipalities > 0
    ? (siope.coverage.withMovements / siope.coverage.activeSiopeMunicipalities) * 100
    : 0;
const cohesionRatioPercent = openCoesionePaymentCostRatio * 100;
const cohesionFreshness = classifyFreshness(
  SOURCE_POLICIES.opencoesione.staleAfterSeconds,
  cohesion.referenceDate,
  new Date(cohesion.generatedAt),
);
const cohesionFreshnessLabel =
  cohesionFreshness.state === "stale"
    ? "Aggiornamento atteso"
    : cohesionFreshness.state === "fresh"
      ? "Dato nei tempi attesi"
      : "Freschezza non determinabile";
const cohesionFreshnessClass =
  cohesionFreshness.state === "stale"
    ? styles.expected
    : cohesionFreshness.state === "fresh"
      ? styles.current
      : styles.unknown;

const sourceBySlug = new Map(publicSources.map((source) => [source.slug, source]));
const sourceRows = ["siope", "openbdap", "ipa", "opencoesione", "partecipazioni-pubbliche"]
  .map((slug) => sourceBySlug.get(slug))
  .filter((source): source is NonNullable<typeof source> => Boolean(source));

const analysisPaths = [
  { href: "/spese", area: "Stato", detail: "Quanto paga e per quali funzioni", source: "RGS · OpenBDAP", status: "Disponibile" },
  { href: "/territori", area: "Comuni e regioni", detail: "Pagamenti e confronti tra territori", source: "SIOPE · IPA", status: "Disponibile" },
  { href: "/coesione", area: "Fondi e progetti", detail: "Costo, pagamenti e progetti seguiti", source: "OpenCoesione", status: "Disponibile" },
  { href: "/enti", area: "Enti pubblici", detail: "Cerca un ente nel registro nazionale", source: "IPA · AgID", status: "Disponibile" },
  { href: "/partecipazioni", area: "Società partecipate", detail: "Chi partecipa in quali società", source: "MEF · dati 2023", status: "Disponibile" },
  { href: "/fonti", area: "Contratti pubblici", detail: "Gare, affidamenti e aggiudicazioni", source: "ANAC · BDNCP", status: "In lavorazione" },
];

export default function HomePage() {
  return (
    <main className={styles.dashboard}>
      <header className={styles.overviewHeader}>
        <div>
          <h1>Dove vanno i nostri soldi?</h1>
          <p>Una dashboard per capire i dati pubblici italiani e risalire sempre alla fonte.</p>
        </div>
        <Link href="/fonti/stato">Quando sono aggiornati i dati <span>→</span></Link>
      </header>

      <section className={styles.pulse} aria-label="Copertura attuale della piattaforma">
        <div><strong>{sourceCounts.active}</strong><span>fonti collegate</span></div>
        <div><strong>{integer.format(siope.coverage.includedMovementRows)}</strong><span>pagamenti comunali letti</span></div>
        <div><strong>{integer.format(siope.coverage.withMovements)}</strong><span>Comuni presenti</span></div>
        <div><strong>{siope.regions.length}</strong><span>regioni confrontabili</span></div>
        <div><strong>{integer.format(cohesion.totals.projects)}</strong><span>progetti seguiti</span></div>
      </section>

      <section className={styles.auditCallout} aria-labelledby="audit-title">
        <header>
          <span className={styles.sectionLabelText}>LEGGERE BENE I NUMERI</span>
          <h2 id="audit-title">Tre dati che raccontano cose diverse</h2>
          <p>Una cifra grande non è automaticamente uno spreco. Il contesto cambia il significato.</p>
        </header>
        <div>
          <article data-tone="attention">
            <strong>{procurementComparison.byNumber.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%</strong>
            <h3>Procedure con meno confronto</h3>
            <p>Quota per numero di procedure sopra 40.000 €, non stima di corruzione.</p>
          </article>
          <article data-tone="observed">
            <strong>{procurementComparison.byValue.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%</strong>
            <h3>Quota sul valore dei contratti</h3>
            <p>Lo stesso fenomeno pesa molto meno se misurato in euro.</p>
          </article>
          <article data-tone="policy">
            <strong>{auditScenarios[1].annualBillion.toLocaleString("it-IT", { maximumFractionDigits: 1 })} mld €</strong>
            <h3>Scenario centrale</h3>
            <p>È un esercizio di policy con ipotesi dichiarate, non denaro già disponibile.</p>
          </article>
        </div>
        <Link href="/controlli">Capire i numeri dell&apos;audit <span>→</span></Link>
      </section>

      <section className={styles.siopeGrid} aria-labelledby="siope-title">
        <article className={styles.primaryMetric}>
          <div className={styles.sectionLabel}>
              <span>PAGAMENTI DEI COMUNI · SIOPE</span>
            <InfoTooltip id="cash-payments-tip" label="Che cosa sono i pagamenti di cassa?">
              Uscite effettivamente registrate in SIOPE dai Comuni. Non rappresentano tutta la spesa pubblica italiana.
            </InfoTooltip>
          </div>
          <h2 id="siope-title">Quanto hanno pagato i Comuni</h2>
          <strong>{compactEuro(siope.totalPaid)}</strong>
          <p>Totale da {period}</p>
          <dl>
            <div><dt>Comuni inclusi</dt><dd>{integer.format(siope.coverage.withMovements)}</dd></div>
            <div>
              <dt className={styles.inlineTerm}>
                Copertura
                <InfoTooltip id="coverage-tip" label="Come calcoliamo la copertura?">
                  Comuni con almeno un movimento nel periodo divisi per gli enti comunali attivi nell&apos;anagrafica SIOPE.
                </InfoTooltip>
              </dt>
              <dd>{coverageRatio.toLocaleString("it-IT", { maximumFractionDigits: 2 })}%</dd>
            </div>
            <div><dt>Fonte aggiornata il</dt><dd>{date(siope.source.siopeMovementsLastModified)}</dd></div>
          </dl>
          <Link href="/territori">Apri il dettaglio territoriale <span>→</span></Link>
        </article>

        <figure className={styles.monthlyPanel}>
          <header>
            <div>
              <span className={styles.sectionLabelText}>MESE PER MESE · EURO</span>
              <h2>Come cambia la spesa durante l&apos;anno</h2>
            </div>
            <b>SIOPE diretto</b>
          </header>
          <HomeMonthlyChart data={siope.monthly} />
          <figcaption>Pagamenti registrati ogni mese. Fonte SIOPE · {period}. Passa sul grafico per il valore esatto.</figcaption>
        </figure>
      </section>

      <section className={styles.mapPanel} aria-labelledby="map-title">
        <header className={styles.panelHeader}>
          <div>
            <span className={styles.sectionLabelText}>TERRITORI · SIOPE</span>
            <h2 id="map-title">Quanto spendono i Comuni in ogni regione</h2>
            <p>Euro per abitante. Seleziona una regione per vedere il dettaglio.</p>
          </div>
          <Link href="/territori">Tabelle e classificazioni <span>→</span></Link>
        </header>
        <ItalyRegionsMap regions={siope.regions} period={period} />
        <footer className={styles.mapAttribution}>
          Confini amministrativi a fini statistici: {" "}
          <a href="https://www.istat.it/storage/cartografia/confini_amministrativi/generalizzati/2026/Limiti01012026_g.zip" target="_blank" rel="noreferrer">ISTAT, 1 gennaio 2026</a>
          {" · "}<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>
          {" · "}geometria semplificata.
        </footer>
      </section>

      <section className={styles.secondaryGrid}>
        <article className={styles.cohesionPanel}>
          <header className={styles.panelHeader}>
            <div>
              <span className={styles.sectionLabelText}>FONDI E PROGETTI · OPENCOESIONE</span>
              <h2>Quanto costano e quanto è stato pagato</h2>
            </div>
            <span className={cohesionFreshnessClass}>{cohesionFreshnessLabel}</span>
          </header>

          <div className={styles.cohesionStats}>
            <div><span>Costo previsto</span><strong>{compactEuro(cohesion.totals.publicCostCents / 100)}</strong></div>
            <div><span>Già pagato</span><strong>{compactEuro(cohesion.totals.paymentsCents / 100)}</strong></div>
            <div><span>Progetti seguiti</span><strong>{integer.format(cohesion.totals.projects)}</strong></div>
          </div>

          <div className={styles.ratioBlock}>
            <div>
              <span className={styles.inlineTerm}>
                Pagato sul costo previsto
                <InfoTooltip id="cohesion-ratio-tip" label="Che cosa significa questo rapporto?">
                  Rapporto finanziario aggregato. Non indica avanzamento fisico, qualità o completamento dei progetti.
                </InfoTooltip>
              </span>
              <strong>{cohesionRatioPercent.toLocaleString("it-IT", { maximumFractionDigits: 2 })}%</strong>
            </div>
            <div className={styles.ratioTrack} aria-hidden="true"><i style={{ width: `${Math.min(cohesionRatioPercent, 100)}%` }} /></div>
            <p>Confronta euro pagati e costo previsto. Non dice quante opere sono finite.</p>
          </div>

          <footer>
            <span>Dati riferiti al {date(cohesion.referenceDate)} · fonte controllata il {date(cohesion.source.observedAt)}</span>
            <Link href="/coesione">Apri OpenCoesione <span>→</span></Link>
          </footer>
        </article>

        <aside className={styles.freshnessPanel}>
          <header>
            <span className={styles.sectionLabelText}>AGGIORNAMENTI</span>
            <h2>Quanto sono recenti i dati</h2>
            <p>Mostriamo sia la data della fonte sia quando l&apos;abbiamo controllata.</p>
          </header>
          <div className={styles.freshnessRows}>
            <article>
              <div><strong>SIOPE</strong><span>Pagamenti dei Comuni</span></div>
              <dl>
                <div><dt>Dati fino a</dt><dd>{siope.latestMonthLabel} {siope.year}</dd></div>
                <div><dt>File · ultima modifica</dt><dd>{date(siope.source.siopeMovementsLastModified)}</dd></div>
                <div><dt>Acquisizione</dt><dd>{date(siope.generatedAt)}</dd></div>
                <div><dt>Controllo</dt><dd>ogni ora</dd></div>
              </dl>
            </article>
            <article>
              <div><strong>OpenCoesione</strong><span>Aggregati nazionali</span></div>
              <dl>
                <div><dt>Data del dato</dt><dd>{date(cohesion.referenceDate)}</dd></div>
                <div><dt>Ultimo controllo</dt><dd>{date(cohesion.source.observedAt)}</dd></div>
                <div><dt>Cadenza</dt><dd>bimestrale prevista</dd></div>
                <div><dt>Controllo</dt><dd>ogni 6 ore</dd></div>
              </dl>
            </article>
          </div>
          <Link href="/fonti/stato">Vedi stato operativo completo <span>→</span></Link>
        </aside>
      </section>

      <section className={styles.pathsPanel} aria-labelledby="paths-title">
        <header className={styles.panelHeader}>
          <div>
              <span className={styles.sectionLabelText}>ESPLORA</span>
              <h2 id="paths-title">Scegli da dove iniziare</h2>
          </div>
          <Link href="/metodologia">Come leggiamo i dati <span>→</span></Link>
        </header>
        <div className={styles.pathTable}>
          <div className={styles.pathHead} aria-hidden="true"><span>Area</span><span>Contenuto</span><span>Fonte</span><span>Stato</span><span /></div>
          {analysisPaths.map((item) => (
            <Link href={item.href} className={styles.pathRow} key={item.area}>
              <strong>{item.area}</strong><span>{item.detail}</span><span>{item.source}</span>
              <b className={item.status === "In lavorazione" ? styles.integrating : ""}>{item.status}</b>
              <i aria-hidden="true">→</i>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.sourceRegister} aria-labelledby="sources-title">
        <div>
          <h2 id="sources-title">Da dove arrivano questi numeri</h2>
          <p>Ogni dato mostra la fonte ufficiale, la data e ciò che non può spiegare.</p>
        </div>
        <div className={styles.sourceLinks}>
          {sourceRows.map((source) => (
            <a href={source.url} target="_blank" rel="noreferrer" key={source.slug}>
              <span><strong>{source.name}</strong><small>{source.owner}</small></span><i aria-hidden="true">↗</i>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
