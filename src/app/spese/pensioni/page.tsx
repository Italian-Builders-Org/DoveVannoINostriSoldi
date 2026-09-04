import type { Metadata } from "next";
import Link from "next/link";
import { compactEuroFromCents, exactEuro, integer, longDate, percent } from "@/lib/format";
import type { IstatPensionCategory } from "@/lib/data/istat-pensions-contract";
import { millionTenthsToCents } from "@/lib/data/inps-pensions-contract";
import { inpsPensionsOsservatorioSnapshot as inps } from "@/lib/inps-pensions-snapshot";
import {
  istatPensionsData,
  istatPensionsSources,
} from "@/lib/istat-pensions-snapshot";
import styles from "./pensioni.module.css";

export const metadata: Metadata = {
  title: "Pensioni e pensionati · INPS e ISTAT",
  description:
    "Pensioni erogate dall'INPS al 1 gennaio 2026 e Casellario ISTAT 2012-2022, con perimetri, fonti e limiti tenuti distinti.",
};

type BenefitPoint = {
  year: number;
  pensionCount: number;
  grossAmountCents: number;
  averagePensionCents: number;
};

type PensionerPoint = {
  year: number;
  pensionerCount: number;
  averagePensionerIncomeCents: number;
};

type Category = {
  code: string;
  label: string;
  pensionCount: number;
  grossAmountCents: number;
};

type Source = {
  id: string;
  title: string;
  url: string;
  sha256: string;
  observedAt: string;
  period: string;
};

type PensionsPageSnapshot = {
  pensionBenefits: {
    series: readonly BenefitPoint[];
    latest: BenefitPoint & { categories: readonly Category[] };
  };
  pensioners: {
    series: readonly PensionerPoint[];
    latest: PensionerPoint;
  };
  sources: readonly Source[];
  methodology: readonly string[];
  caveats: readonly string[];
};

const CATEGORY_LABELS: Readonly<Record<Exclude<IstatPensionCategory, "ALL">, string>> = {
  OLSEN1: "Vecchiaia e anzianità",
  SURV: "Superstiti",
  DISAB1: "Invalidità previdenziale",
  CIVDIS: "Invalidità civile",
  NOCONT: "Pensioni sociali",
  COMP: "Indennitarie",
  WAR: "Pensioni di guerra",
};

const IVS_AND_COMPENSATORY_CODES = new Set(["OLSEN1", "SURV", "DISAB1", "COMP"]);

function toCentsFromThousandEuros(value: number): number {
  const cents = value * 100_000;
  if (!Number.isSafeInteger(cents)) {
    throw new Error("Importo ISTAT fuori dal range intero sicuro");
  }
  return cents;
}

const benefitSeries = istatPensionsData.pensionBenefits.observations
  .filter((row) => row.pensionType === "ALL")
  .map((row) => ({
    year: row.year,
    pensionCount: row.pensionCount,
    grossAmountCents: toCentsFromThousandEuros(row.grossAnnualThousandEuros),
    averagePensionCents: Math.round(row.grossAnnualMeanEuros * 100),
  }));
const pensionerSeries = istatPensionsData.pensioners.observations.map((row) => ({
  year: row.year,
  pensionerCount: row.pensionerCount,
  averagePensionerIncomeCents: Math.round(row.grossAnnualMeanEuros * 100),
}));
const latestBenefit = benefitSeries.at(-1);
const latestPensioner = pensionerSeries.at(-1);

if (!latestBenefit || !latestPensioner || latestBenefit.year !== latestPensioner.year) {
  throw new Error("Serie ISTAT pensioni e pensionati non allineate");
}

const data: PensionsPageSnapshot = {
  pensionBenefits: {
    series: benefitSeries,
    latest: {
      ...latestBenefit,
      categories: istatPensionsData.pensionBenefits.observations
        .filter((row) => row.year === latestBenefit.year && row.pensionType !== "ALL")
        .map((row) => {
          if (row.pensionType === "ALL") {
            throw new Error("Il totale ISTAT non può essere una categoria di composizione");
          }
          return {
            code: row.pensionType,
            label: CATEGORY_LABELS[row.pensionType],
            pensionCount: row.pensionCount,
            grossAmountCents: toCentsFromThousandEuros(row.grossAnnualThousandEuros),
          };
        }),
    },
  },
  pensioners: { series: pensionerSeries, latest: latestPensioner },
  sources: istatPensionsSources.map((source) => ({
    ...source,
    period: `dal ${source.period.from} al ${source.period.to}`,
  })),
  methodology: [
    "Pensioni e pensionati provengono da due dataflow ISTAT distinti e restano separati nel contratto dati.",
    "La spesa è una misura tendenziale ricavata dallo stock al 31 dicembre: può non coincidere con la spesa di bilancio.",
    "Il rapporto prestazioni per pensionato è una derivazione DVNS tra stock dello stesso anno, non una misura pubblicata da ISTAT.",
  ],
  caveats: Object.values(istatPensionsData.caveats),
};

function ratio(value: number): string {
  return (value / 100).toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function yearRows(): readonly (BenefitPoint & {
  pensionerCount: number;
  averagePensionerIncomeCents: number;
})[] {
  const pensionersByYear = new Map(
    data.pensioners.series.map((point) => [point.year, point]),
  );

  return data.pensionBenefits.series.flatMap((point) => {
    const pensioner = pensionersByYear.get(point.year);
    return pensioner
      ? [{ ...point, pensionerCount: pensioner.pensionerCount, averagePensionerIncomeCents: pensioner.averagePensionerIncomeCents }]
      : [];
  });
}

export default function PensionsPage() {
  const latestBenefits = data.pensionBenefits.latest;
  const latestPensioners = data.pensioners.latest;
  const rows = yearRows();
  const latestYear = latestBenefits.year;
  const categories = [...latestBenefits.categories].sort(
    (left, right) => right.grossAmountCents - left.grossAmountCents,
  );
  const largestCategoryAmount = categories[0]?.grossAmountCents ?? 1;
  const ivsAndCompensatoryAmount = categories
    .filter((category) => IVS_AND_COMPENSATORY_CODES.has(category.code))
    .reduce((sum, category) => sum + category.grossAmountCents, 0);
  const civilSocialAndWarAmount = categories
    .filter((category) => !IVS_AND_COMPENSATORY_CODES.has(category.code))
    .reduce((sum, category) => sum + category.grossAmountCents, 0);
  const pensionsPerPensionerBps = Math.round(
    (latestBenefits.pensionCount / latestPensioners.pensionerCount) * 100,
  );
  const inpsAmountCents = millionTenthsToCents(inps.stock.amountMillionTenths);
  const inpsCategories = [...inps.categories.items].sort(
    (left, right) => right.pensionCount - left.pensionCount,
  );
  const largestInpsCategory = inpsCategories[0]?.pensionCount ?? 1;
  const inpsGroups = [...inps.managementGroups.items].sort(
    (left, right) => right.pensionCount - left.pensionCount,
  );
  const largestInpsGroup = inpsGroups[0]?.pensionCount ?? 1;
  const inpsSeries = [...inps.stockSeries.observations].reverse();
  const previdenziali = inps.nature.items[0];
  const assistenziali = inps.nature.items[1];

  return (
    <main className="shell page">
      <header className="page-intro">
        <h1>Pensioni e pensionati: quanto valgono</h1>
        <p>
          Due perimetri restano distinti. L’INPS pubblica le pensioni che eroga, vigenti al 1
          gennaio 2026. ISTAT pubblica il Casellario di tutti gli enti osservati, con ultimo anno
          2022. I numeri non si sommano.
        </p>
      </header>

      <div className={`stat-strip ${styles.stats}`}>
        <div>
          <span className="stat-label">Pensioni INPS vigenti · 1 gennaio 2026</span>
          <span className="stat-value">{integer(inps.stock.pensionCount)}</span>
          <span className="stat-note">solo prestazioni erogate dall’INPS, inclusa la Gestione dipendenti pubblici</span>
        </div>
        <div>
          <span className="stat-label">Importo complessivo annuo INPS · 2026</span>
          <span className="stat-value">{compactEuroFromCents(inpsAmountCents)}</span>
          <span className="stat-note">13 mensilità sull’importo di gennaio; 12 se indennità di accompagnamento</span>
        </div>
        <div>
          <span className="stat-label">Di cui assistenziali · 2026</span>
          <span className="stat-value">{percent(assistenziali.sharePercent)}</span>
          <span className="stat-note">{integer(assistenziali.pensionCount)} prestazioni · sociali e invalidi civili</span>
        </div>
        <div>
          <span className="stat-label">Liquidate nel 2025</span>
          <span className="stat-value">{integer(inps.awardedIn2025.pensionCount)}</span>
          <span className="stat-note">flusso dell’anno, non lo stock e non la tavola per decorrenza</span>
        </div>
      </div>

      <div className="notice">
        <strong>INPS e Casellario ISTAT non descrivono lo stesso insieme</strong>
        <p>
          Lo stock INPS esclude enti diversi dall’INPS e la Gestione Ex Inpgi. Il Casellario ISTAT
          conta prestazioni e persone di tutti gli enti osservati, al 31 dicembre. L’invalidità
          civile di questa pagina è lo stock INPS; la spesa di bilancio sta in{" "}
          <Link href="/spese/invalidita">Invalidità INPS</Link>.
        </p>
      </div>

      <section className="panel" aria-labelledby="inps-nature-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 className="panel-title" id="inps-nature-title">
              Come si compone lo stock INPS al 1 gennaio 2026
            </h2>
            <p>Conteggi e importi della fonte, ordinati per numero di prestazioni.</p>
          </div>
          <span className="tag tag-neutral">{inpsCategories.length} categorie</span>
        </div>
        <dl className={styles.compositionSummary}>
          <div>
            <dt>Previdenziali</dt>
            <dd>{integer(previdenziali.pensionCount)}</dd>
          </div>
          <div>
            <dt>Assistenziali</dt>
            <dd>{integer(assistenziali.pensionCount)}</dd>
          </div>
        </dl>
        <figure className={styles.composition} aria-labelledby="inps-nature-title">
          <ol>
            {inpsCategories.map((category) => {
              const share = (category.pensionCount / inps.stock.pensionCount) * 100;
              const width = (category.pensionCount / largestInpsCategory) * 100;
              return (
                <li key={category.id}>
                  <div className={styles.compositionLabel}>
                    <strong>{category.label}</strong>
                    <span>{category.nature === "previdenziali" ? "previdenziale" : "assistenziale"}</span>
                  </div>
                  <span className={styles.barTrack} aria-hidden="true">
                    <i style={{ width: `${width}%` }} />
                  </span>
                  <span className={styles.compositionAmount}>
                    {integer(category.pensionCount)} · {percent(share)} ·{" "}
                    {compactEuroFromCents(millionTenthsToCents(category.amountMillionTenths))}
                  </span>
                </li>
              );
            })}
          </ol>
          <figcaption className={styles.note}>
            La quota è sul numero di pensioni vigenti, non sulle persone. Gli importi in milioni
            possono non quadrare al decimo per arrotondamento della fonte.
          </figcaption>
        </figure>
      </section>

      <section className="panel" aria-labelledby="inps-gestione-title">
        <h2 className="panel-title" id="inps-gestione-title">Per gestione INPS · 1 gennaio 2026</h2>
        <p className={styles.note}>
          Aggregati della Tavola 1 delle Statistiche in breve. I fondi sostitutivi restano
          distinti dal FPLD; il cumulo non si somma alle gestioni di origine.
        </p>
        <figure className={styles.composition}>
          <ol>
            {inpsGroups.map((group) => {
              const share = (group.pensionCount / inps.stock.pensionCount) * 100;
              const width = (group.pensionCount / largestInpsGroup) * 100;
              return (
                <li key={group.id}>
                  <div className={styles.compositionLabel}>
                    <strong>{group.label}</strong>
                    <span>{compactEuroFromCents(millionTenthsToCents(group.amountMillionTenths))} annui</span>
                  </div>
                  <span className={styles.barTrack} aria-hidden="true">
                    <i style={{ width: `${width}%` }} />
                  </span>
                  <span className={styles.compositionAmount}>
                    {integer(group.pensionCount)} · {percent(share)}
                  </span>
                </li>
              );
            })}
          </ol>
        </figure>
      </section>

      <section className="panel" aria-labelledby="inps-series-title">
        <h2 className="panel-title" id="inps-series-title">Stock INPS dal 2012 al 2026</h2>
        <p className={styles.note}>
          Conteggio delle pensioni vigenti al 1 gennaio. La quota assistenziale è calcolata sul
          totale dello stesso anno. Gli importi a prezzi 2012 della fonte non sono riportati qui.
        </p>
        <div
          className="table-scroll"
          role="region"
          aria-label="Serie INPS di pensioni vigenti; scorri orizzontalmente per vedere tutte le colonne"
          tabIndex={0}
        >
          <table className="table">
            <caption className={styles.visuallyHidden}>
              Pensioni INPS vigenti al 1 gennaio, previdenziali e assistenziali, dal 2012 al 2026.
            </caption>
            <thead>
              <tr>
                <th scope="col">Anno</th>
                <th scope="col" className="num">Previdenziali</th>
                <th scope="col" className="num">Assistenziali</th>
                <th scope="col" className="num">Totale</th>
                <th scope="col">Quota assistenziale</th>
              </tr>
            </thead>
            <tbody>
              {inpsSeries.map((point) => {
                const share = (point.assistenziali / point.total) * 100;
                return (
                  <tr key={point.year}>
                    <th scope="row">{point.year}</th>
                    <td className="num">{integer(point.previdenziali)}</td>
                    <td className="num">{integer(point.assistenziali)}</td>
                    <td className="num">{integer(point.total)}</td>
                    <td>
                      <span className={styles.shareLine}>
                        <span className={styles.barTrack} aria-hidden="true">
                          <i style={{ width: `${share}%` }} />
                        </span>
                        {percent(share)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="inps-decorrenza-title">
        <h2 className="panel-title" id="inps-decorrenza-title">
          Pensioni per anno di decorrenza
        </h2>
        <p>
          Lo stesso osservatorio pubblica la tavola navigabile che classifica questo stock per
          anno di decorrenza, sesso, categoria e gestione. Serve a vedere quanto dello stock
          oggi in pagamento è iniziato in un certo anno, non quante pensioni sono state
          liquidate in quell’anno.
        </p>
        <p>
          <a
            href={inps.vintageCube.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`${inps.vintageCube.title}, si apre in una nuova scheda`}
          >
            Apri la tavola INPS per anno di decorrenza ↗
          </a>
        </p>
        <p className={styles.note}>{inps.vintageCube.warning}</p>
      </section>

      <div className={`stat-strip ${styles.stats}`}>
        <div>
          <span className="stat-label">Prestazioni Casellario ISTAT · {latestYear}</span>
          <span className="stat-value">{integer(latestBenefits.pensionCount)}</span>
          <span className="stat-note">stock al 31 dicembre · tutti gli enti del Casellario</span>
        </div>
        <div>
          <span className="stat-label">Pensionati ISTAT · {latestYear}</span>
          <span className="stat-value">{integer(latestPensioners.pensionerCount)}</span>
          <span className="stat-note">persone con almeno una prestazione nel perimetro ISTAT</span>
        </div>
        <div>
          <span className="stat-label">Prestazioni per pensionato · {latestYear}</span>
          <span className="stat-value">{ratio(pensionsPerPensionerBps)}</span>
          <span className="stat-note">rapporto tra i due stock, non persone diverse</span>
        </div>
        <div>
          <span className="stat-label">Spesa lorda ISTAT · {latestYear}</span>
          <span className="stat-value">{compactEuroFromCents(latestBenefits.grossAmountCents)}</span>
          <span className="stat-note">importi nominali, non depurati dall’inflazione</span>
        </div>
      </div>

      <section className="panel" aria-labelledby="series-title">
        <h2 className="panel-title" id="series-title">Casellario ISTAT dal 2012 al {latestYear}</h2>
        <p className={styles.note}>
          Stock rilevati al 31 dicembre. La spesa è lorda e nominale; la media per pensione e il
          reddito medio per pensionato sono indicatori descrittivi del rispettivo perimetro.
        </p>
        <div
          className="table-scroll"
          role="region"
          aria-label="Serie ISTAT di pensioni, pensionati e spesa; scorri orizzontalmente per vedere tutte le colonne"
          tabIndex={0}
        >
          <table className="table">
            <caption className={styles.visuallyHidden}>
              Pensioni, pensionati e spesa pensionistica ISTAT dal 2012 al {latestYear}.
            </caption>
            <thead>
              <tr>
                <th scope="col">Anno</th>
                <th scope="col" className="num">Pensioni</th>
                <th scope="col" className="num">Pensionati</th>
                <th scope="col" className="num">Spesa lorda</th>
                <th scope="col" className="num">Media per pensione</th>
                <th scope="col" className="num">Media per pensionato</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((point) => (
                <tr key={point.year}>
                  <th scope="row">{point.year}</th>
                  <td className="num">{integer(point.pensionCount)}</td>
                  <td className="num">{integer(point.pensionerCount)}</td>
                  <td className="num">{compactEuroFromCents(point.grossAmountCents)}</td>
                  <td className="num">{exactEuro(point.averagePensionCents / 100)}</td>
                  <td className="num">{exactEuro(point.averagePensionerIncomeCents / 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="composition-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 className="panel-title" id="composition-title">
              Come si compone la spesa lorda ISTAT {latestYear}
            </h2>
            <p>Barre ordinate per importo, con valori e percentuali leggibili senza dipendere dal colore.</p>
          </div>
          <span className="tag tag-neutral">{categories.length} categorie</span>
        </div>
        <dl className={styles.compositionSummary}>
          <div>
            <dt>IVS e indennitarie</dt>
            <dd>{compactEuroFromCents(ivsAndCompensatoryAmount)}</dd>
          </div>
          <div>
            <dt>Civili, sociali e guerra</dt>
            <dd>{compactEuroFromCents(civilSocialAndWarAmount)}</dd>
          </div>
        </dl>
        <figure className={styles.composition} aria-labelledby="composition-title">
          <ol>
            {categories.map((category) => {
              const share = (category.grossAmountCents / latestBenefits.grossAmountCents) * 100;
              const width = (category.grossAmountCents / largestCategoryAmount) * 100;
              return (
                <li key={category.code}>
                  <div className={styles.compositionLabel}>
                    <strong>{category.label}</strong>
                    <span>{integer(category.pensionCount)} prestazioni</span>
                  </div>
                  <span className={styles.barTrack} aria-hidden="true">
                    <i style={{ width: `${width}%` }} />
                  </span>
                  <span className={styles.compositionAmount}>
                    {compactEuroFromCents(category.grossAmountCents)} lordi · {percent(share)}
                  </span>
                </li>
              );
            })}
          </ol>
          <figcaption className={styles.note}>
            La quota è calcolata sulla spesa lorda totale. Le due sintesi sopra derivano dalle sette
            categorie: IVS e indennitarie comprende vecchiaia, superstiti, invalidità previdenziale
            e indennitarie; l’altro blocco comprende invalidità civile, pensioni sociali e guerra.
            Gli importi non vanno sommati a voci della pagina Invalidità INPS né allo stock INPS 2026.
          </figcaption>
        </figure>
      </section>

      <div className={styles.columns}>
        <section className="panel" aria-labelledby="method-title">
          <h2 className="panel-title" id="method-title">Metodo e limiti</h2>
          <ul className={styles.methodList}>
            <li>{inps.methodology.perimeter}</li>
            <li>{inps.methodology.definitions}</li>
            <li>{inps.methodology.amounts}</li>
            {data.methodology.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <ul className={styles.methodList}>
            {data.caveats.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
        <section className="panel" aria-labelledby="scope-title">
          <h2 className="panel-title" id="scope-title">Perimetro da ricordare</h2>
          <dl className={styles.scopeList}>
            <div><dt>INPS</dt><dd>stock al 1 gennaio 2026, solo ente erogatore INPS</dd></div>
            <div><dt>ISTAT</dt><dd>stock al 31 dicembre {latestYear}, tutti gli enti del Casellario</dd></div>
            <div><dt>Importi INPS</dt><dd>complessivo annuo da mensilità di gennaio, con arrotondamento della fonte</dd></div>
            <div><dt>Importi ISTAT</dt><dd>lordi, nominali, senza rivalutazione</dd></div>
          </dl>
        </section>
      </div>

      <section className="panel" aria-labelledby="sources-title">
        <h2 className="panel-title" id="sources-title">Fonti ufficiali e riproducibilità</h2>
        <ul className={styles.sourceList}>
          {inps.sources.map((source) => (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer" aria-label={`${source.title}, si apre in una nuova scheda`}>
                {source.title} ↗
              </a>
              <span>{source.locator} · osservato il {longDate(source.observedAt)}</span>
              <code>sha256:{source.sha256}</code>
            </li>
          ))}
          {data.sources.map((source) => (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer" aria-label={`${source.title}, si apre in una nuova scheda`}>
                {source.title} ↗
              </a>
              <span>periodo {source.period} · osservato il {longDate(source.observedAt)}</span>
              <code>sha256:{source.sha256}</code>
            </li>
          ))}
        </ul>
        <p className={styles.note}>
          Snapshot condiviso dall’API <code>/api/spese/pensioni</code>. Per interrogare gli stessi
          perimetri in modo read-only, usa i dataset MCP dalla <Link href="/mcp">pagina MCP →</Link>
        </p>
      </section>
    </main>
  );
}
