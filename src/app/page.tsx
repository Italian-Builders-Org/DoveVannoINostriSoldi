import Link from "next/link";
import { HomeMonthlyChart } from "@/components/charts/home-monthly-chart";
import { InfoTooltip } from "@/components/info-tooltip";
import { ItalyRegionsMap } from "@/components/italy-regions-map";
import { PeriodSelector } from "@/components/period-selector";
import { classifyFreshness } from "@/lib/data/freshness";
import { SOURCE_POLICIES } from "@/lib/data/source-policy";
import {
  openCoesioneSnapshot as cohesion,
} from "@/lib/opencoesione-snapshot";
import {
  availableSiopeYears,
  getSiopeMunicipalSnapshot,
} from "@/lib/siope-snapshot";
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

function selectedYear(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] ?? "" : value ?? "", 10);
  return availableSiopeYears.includes(parsed) ? parsed : availableSiopeYears[0];
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ anno?: string | string[] }>;
}) {
  const year = selectedYear((await searchParams).anno);
  const siope = getSiopeMunicipalSnapshot(year);
  const period = `gennaio a ${siope.latestMonthLabel.toLocaleLowerCase("it-IT")} ${siope.year}`;
  const coverageRatio = siope.coverage.activeSiopeMunicipalities > 0
    ? (siope.coverage.withMovements / siope.coverage.activeSiopeMunicipalities) * 100
    : 0;
  const cohesionPoint = cohesion.annualSeries.find((point) => point.year === year) ?? null;
  const cohesionRatioPercent = cohesionPoint && cohesionPoint.commitmentsCents > 0
    ? (cohesionPoint.paymentsCents / cohesionPoint.commitmentsCents) * 100
    : null;

  return (
    <main className={styles.dashboard}>
      <header className={styles.overviewHeader}>
        <div>
          <h1>Dove vanno i nostri soldi?</h1>
          <p>Scopri quanto spendono Stato e Comuni, da quali fonti arrivano i dati e a quale periodo si riferiscono.</p>
        </div>
        <div className={styles.headerActions}>
          <PeriodSelector activeYear={year} years={availableSiopeYears} pathname="/" />
          <Link href="/fonti/stato">Quando sono aggiornati i dati <span>→</span></Link>
        </div>
      </header>

      <section className={styles.pulse} aria-label="Copertura attuale della piattaforma">
        <div><strong>{sourceCounts.active}</strong><span>fonti collegate</span></div>
        <div><strong>{integer.format(siope.coverage.includedMovementRows)}</strong><span>pagamenti comunali letti</span></div>
        <div><strong>{integer.format(siope.coverage.withMovements)}</strong><span>Comuni presenti</span></div>
        <div><strong>{siope.regions.length}</strong><span>regioni confrontabili</span></div>
        <div><strong>{integer.format(siope.populationCovered)}</strong><span>abitanti coperti</span></div>
      </section>

      {year === 2025 ? <section className={styles.auditCallout} aria-labelledby="audit-title">
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
            <h3>Ipotesi centrale</h3>
            <p>È una stima costruita su ipotesi dichiarate. Non è denaro già disponibile.</p>
          </article>
        </div>
        <Link href="/controlli">Capire i numeri da controllare <span>→</span></Link>
      </section> : (
        <section className={styles.yearNotice} aria-label={`Controlli disponibili per il ${year}`}>
          <strong>Controlli approfonditi per il {year}</strong>
          <p>
            Non abbiamo ancora un insieme completo di indicatori confrontabili per questo anno.
            I dati SIOPE e OpenCoesione qui sotto cambiano davvero con il periodo scelto.
          </p>
          <Link href="/controlli">Vedi tutti i controlli con la loro data <span>→</span></Link>
        </section>
      )}

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
          <Link href={`/territori?anno=${year}`}>Apri il dettaglio territoriale <span>→</span></Link>
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
          <Link href={`/territori?anno=${year}`}>Tabelle e classificazioni <span>→</span></Link>
        </header>
        <ItalyRegionsMap regions={siope.regions} period={period} />
        <footer className={styles.mapAttribution}>
          Confini amministrativi a fini statistici: {" "}
          <a href="https://www.istat.it/storage/cartografia/confini_amministrativi/generalizzati/2026/Limiti01012026_g.zip" target="_blank" rel="noreferrer">ISTAT, 1 gennaio 2026</a>
          {", "}<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>
          {", "}geometria semplificata.
        </footer>
      </section>

      <section className={styles.secondaryGrid}>
        <article className={styles.cohesionPanel}>
          <header className={styles.panelHeader}>
            <div>
              <span className={styles.sectionLabelText}>FONDI E PROGETTI · OPENCOESIONE</span>
              <h2>Impegni e pagamenti fino al {year}</h2>
            </div>
            <span className={cohesionFreshnessClass}>{cohesionFreshnessLabel}</span>
          </header>

          <div className={styles.cohesionStats}>
            <div><span>Impegni fino al {year}</span><strong>{cohesionPoint ? compactEuro(cohesionPoint.commitmentsCents / 100) : "Non disponibile"}</strong></div>
            <div><span>Pagamenti fino al {year}</span><strong>{cohesionPoint ? compactEuro(cohesionPoint.paymentsCents / 100) : "Non disponibile"}</strong></div>
            <div><span>Pagato sugli impegni</span><strong>{cohesionRatioPercent === null ? "Non disponibile" : `${cohesionRatioPercent.toLocaleString("it-IT", { maximumFractionDigits: 2 })}%`}</strong></div>
          </div>

          <div className={styles.ratioBlock}>
            <div>
              <span className={styles.inlineTerm}>
                Pagato sugli impegni
                <InfoTooltip id="cohesion-ratio-tip" label="Che cosa significa questo rapporto?">
                  Confronta i pagamenti e gli impegni registrati fino all&apos;anno scelto. Non dice quante opere sono finite.
                </InfoTooltip>
              </span>
              <strong>{cohesionRatioPercent === null ? "Non disponibile" : `${cohesionRatioPercent.toLocaleString("it-IT", { maximumFractionDigits: 2 })}%`}</strong>
            </div>
            <div className={styles.ratioTrack} aria-hidden="true"><i style={{ width: `${Math.min(cohesionRatioPercent ?? 0, 100)}%` }} /></div>
            <p>La serie è pubblicata da OpenCoesione e cresce nel tempo. Non è la spesa del solo {year}.</p>
          </div>

          <footer>
            <span>Serie annuale fino al {year}. Fonte controllata il {date(cohesion.source.observedAt)}.</span>
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
                <div><dt>File aggiornato</dt><dd>{date(siope.source.siopeMovementsLastModified)}</dd></div>
                <div><dt>Scaricato da noi</dt><dd>{date(siope.generatedAt)}</dd></div>
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
