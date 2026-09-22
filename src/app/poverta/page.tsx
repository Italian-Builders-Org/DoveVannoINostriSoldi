import type { Metadata } from "next";
import Link from "next/link";
import { compactEuroFromCents, longDate, percent } from "@/lib/format";
import {
  buildPovertaPageView,
  type PovertaAbsoluteThresholdView,
  type PovertaAropeView,
  type PovertaFamilyView,
  type PovertaRelativeThresholdView,
} from "@/lib/poverta-page";
import styles from "./poverta.module.css";

export const metadata: Metadata = {
  title: "Povertà assoluta, relativa e AROPE",
  description:
    "Indicatori ufficiali ISTAT di povertà assoluta e relativa, soglie monetarie e AROPE Eurostat (Europa 2030). Misure distinte, mai sommate.",
};

function rate(value: number | null): string {
  return value === null ? "Non disponibile" : percent(value);
}

function money(valueHundredths: number | null): string {
  return valueHundredths === null ? "Non disponibile" : compactEuroFromCents(valueHundredths);
}

function aropeRate(tenths: number): string {
  return percent(tenths / 10);
}

function aropePersons(thousands: number): string {
  return `${thousands.toLocaleString("it-IT")} mila`;
}

function FamilySection({ family }: { family: PovertaFamilyView }) {
  const latest = family.series.find((point) => point.year === family.latestYear);
  const seriesId = `serie-${family.key}`;
  const areasId = `ripartizioni-${family.key}`;

  return (
    <section className={styles.family} aria-labelledby={`titolo-${family.key}`}>
      <h2 id={`titolo-${family.key}`}>{family.title}</h2>
      <p className={styles.definition}>{family.definition}</p>

      <dl className={styles.latest}>
        <div className={styles.latestItem}>
          <dt className={styles.latestLabel}>Famiglie, {family.latestYear}</dt>
          <dd className={styles.latestValue}>{rate(latest?.households ?? null)}</dd>
        </div>
        <div className={styles.latestItem}>
          <dt className={styles.latestLabel}>Individui, {family.latestYear}</dt>
          <dd className={styles.latestValue}>{rate(latest?.individuals ?? null)}</dd>
        </div>
      </dl>

      <div className={styles.tables}>
        <div
          className="table-scroll"
          role="region"
          aria-labelledby={seriesId}
          tabIndex={0}
        >
          <table className="table">
            <caption id={seriesId} className="table-caption">
              Serie nazionale dal {family.period.from} al {family.period.to}: incidenza in Italia
            </caption>
            <thead>
              <tr>
                <th scope="col">Anno</th>
                <th scope="col" className="num">Famiglie</th>
                <th scope="col" className="num">Individui</th>
              </tr>
            </thead>
            <tbody>
              {family.series.map((point) => (
                <tr key={point.year}>
                  <th scope="row">{point.year}</th>
                  <td className="num">{rate(point.households)}</td>
                  <td className="num">{rate(point.individuals)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          className="table-scroll"
          role="region"
          aria-labelledby={areasId}
          tabIndex={0}
        >
          <table className="table">
            <caption id={areasId} className="table-caption">
              Ripartizioni nel {family.latestYear}: incidenza fra le famiglie
            </caption>
            <thead>
              <tr>
                <th scope="col">Ripartizione</th>
                <th scope="col" className="num">Famiglie</th>
              </tr>
            </thead>
            <tbody>
              {family.areas.map((area) => (
                <tr key={area.code}>
                  <th scope="row">{area.label}</th>
                  <td className="num">{rate(area.households)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className={styles.sourceNote}>
        Fonte: ISTAT, dataflow <code>{family.source.dataflowId}</code> · acquisito il{" "}
        {longDate(family.source.observedAt)} · licenza {family.source.licenseId === "not-declared" ? "non dichiarata" : family.source.licenseId} ·{" "}
        <a href={family.source.landingUrl}>vai al databrowser ISTAT</a>
      </p>
    </section>
  );
}

function AbsoluteThresholdSection({ threshold }: { threshold: PovertaAbsoluteThresholdView }) {
  const tableId = "soglia-assoluta-regioni";
  return (
    <section className={styles.family} aria-labelledby="titolo-soglia-assoluta">
      <h2 id="titolo-soglia-assoluta">Soglia monetaria di povertà assoluta</h2>
      <p className={styles.definition}>
        Importo mensile sotto il quale una famiglia è considerata in povertà assoluta.
        Non è un&apos;incidenza percentuale e non si somma né si confronta con le tabelle sopra.
      </p>
      <p className={styles.definition}>
        Contesto per il {threshold.year}: profilo <strong>{threshold.householdTypology.label}</strong>
        {" "}in <strong>{threshold.municipalitySize.label}</strong>. Altre combinazioni restano
        disponibili via API e MCP.
      </p>

      <div
        className="table-scroll"
        role="region"
        aria-labelledby={tableId}
        tabIndex={0}
      >
        <table className="table">
          <caption id={tableId} className="table-caption">
            Soglia mensile per regione nel {threshold.year}, ordine geografico della fonte
          </caption>
          <thead>
            <tr>
              <th scope="col">Regione</th>
              <th scope="col" className="num">Soglia mensile</th>
            </tr>
          </thead>
          <tbody>
            {threshold.regions.map((region) => (
              <tr key={region.code}>
                <th scope="row">{region.label}</th>
                <td className="num">{money(region.valueHundredths)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.sourceNote}>
        Fonte: ISTAT, dataflow <code>{threshold.source.dataflowId}</code> · acquisito il{" "}
        {longDate(threshold.source.observedAt)} · licenza{" "}
        {threshold.source.licenseId === "not-declared" ? "non dichiarata" : threshold.source.licenseId} ·{" "}
        <a href={threshold.source.landingUrl}>vai al databrowser ISTAT</a> ·{" "}
        <Link
          href={`/api/territori/poverta-soglia-assoluta?${new URLSearchParams({
            anno: "2024",
            tipologia: "40",
            ampiezza: "INH_OTH_UN5000",
          }).toString()}`}
        >
          stessa selezione via API
        </Link>
      </p>
    </section>
  );
}

function RelativeThresholdSection({ threshold }: { threshold: PovertaRelativeThresholdView }) {
  const tableId = "soglia-relativa-ampiezze";
  return (
    <section className={styles.family} aria-labelledby="titolo-soglia-relativa">
      <h2 id="titolo-soglia-relativa">Soglia monetaria di povertà relativa</h2>
      <p className={styles.definition}>
        Importo mensile nazionale sotto il quale una famiglia è considerata in povertà relativa.
        Non è un&apos;incidenza percentuale e non si confronta con la soglia assoluta né con le
        tabelle di incidenza sopra.
      </p>
      <p className={styles.definition}>
        Contesto per il {threshold.year}, solo Italia, per ampiezza del nucleo. L&apos;anno{" "}
        {threshold.excludedYear} è escluso dalla serie pubblicata perché i valori della fonte sono
        incoerenti con il resto della serie.
      </p>

      <div
        className="table-scroll"
        role="region"
        aria-labelledby={tableId}
        tabIndex={0}
      >
        <table className="table">
          <caption id={tableId} className="table-caption">
            Soglia mensile nazionale per ampiezza familiare nel {threshold.year}
          </caption>
          <thead>
            <tr>
              <th scope="col">Componenti</th>
              <th scope="col" className="num">Soglia mensile</th>
            </tr>
          </thead>
          <tbody>
            {threshold.rows.map((row) => (
              <tr key={row.code}>
                <th scope="row">{row.label}</th>
                <td className="num">{money(row.valueHundredths)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.sourceNote}>
        Fonte: ISTAT, dataflow <code>{threshold.source.dataflowId}</code> · acquisito il{" "}
        {longDate(threshold.source.observedAt)} · licenza{" "}
        {threshold.source.licenseId === "not-declared" ? "non dichiarata" : threshold.source.licenseId} ·{" "}
        <a href={threshold.source.landingUrl}>vai al databrowser ISTAT</a> ·{" "}
        <Link
          href={`/api/territori/poverta-soglia-relativa?${new URLSearchParams({
            territorio: "IT",
            anno: String(threshold.year),
          }).toString()}`}
        >
          stessa selezione via API
        </Link>
      </p>
    </section>
  );
}

function AropeSection({ arope }: { arope: PovertaAropeView }) {
  const latest = arope.rows.find((row) => row.year === arope.latestYear);
  const tableId = "arope-serie";
  return (
    <section className={styles.family} aria-labelledby="titolo-arope">
      <h2 id="titolo-arope">Rischio di povertà o esclusione sociale (AROPE)</h2>
      <p className={styles.definition}>{arope.definitionNote}</p>
      <p className={styles.definition}>
        Contesto nazionale Europa 2030 (Eurostat <code>ilc_peps01n</code>). Non è la povertà
        assoluta né quella relativa ISTAT: restano misure separate, senza somme o differenze.
      </p>

      <dl className={styles.latest}>
        <div className={styles.latestItem}>
          <dt className={styles.latestLabel}>Tasso, {arope.latestYear}</dt>
          <dd className={styles.latestValue}>{latest ? aropeRate(latest.rateTenths) : "Non disponibile"}</dd>
        </div>
        <div className={styles.latestItem}>
          <dt className={styles.latestLabel}>Persone, {arope.latestYear}</dt>
          <dd className={styles.latestValue}>
            {latest ? aropePersons(latest.personsThousands) : "Non disponibile"}
          </dd>
        </div>
      </dl>

      <div className="table-scroll" role="region" aria-labelledby={tableId} tabIndex={0}>
        <table className="table">
          <caption id={tableId} className="table-caption">
            Serie nazionale AROPE, Italia
          </caption>
          <thead>
            <tr>
              <th scope="col">Anno</th>
              <th scope="col" className="num">Tasso</th>
              <th scope="col" className="num">Persone</th>
            </tr>
          </thead>
          <tbody>
            {[...arope.rows].reverse().map((row) => (
              <tr key={row.year}>
                <th scope="row">{row.year}</th>
                <td className="num">{aropeRate(row.rateTenths)}</td>
                <td className="num">{aropePersons(row.personsThousands)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.sourceNote}>
        Fonte: Eurostat, dataset <code>{arope.source.dataflowId}</code> · acquisito il{" "}
        {longDate(arope.source.observedAt)} · licenza {arope.source.licenseId} ·{" "}
        <a href={arope.source.landingUrl}>vai al databrowser Eurostat</a> ·{" "}
        <Link
          href={`/api/spese/arope?${new URLSearchParams({
            territorio: "IT",
            anno: String(arope.latestYear),
          }).toString()}`}
        >
          stessa selezione via API
        </Link>
      </p>
    </section>
  );
}

export default function PovertaPage() {
  const view = buildPovertaPageView();
  const [assoluta, relativa] = view.families;

  return (
    <main className={`shell page ${styles.page}`}>
      <header className="page-intro">

        <h1>Povertà in Italia</h1>
        <p>
          Gli indicatori ufficiali ISTAT, dal {assoluta.period.from} al {assoluta.period.to}, per
          l&apos;Italia e le sue ripartizioni. Sono <strong>due misure distinte</strong>: la povertà
          assoluta guarda al costo di un paniere di beni essenziali, quella relativa alla distanza
          dalla spesa media delle famiglie italiane. Sotto, in sezioni separate, le soglie monetarie
          e l&apos;AROPE Eurostat (Europa 2030): contesti diversi, mai sommati.
        </p>
        <p className={styles.leadLinks}>
          <Link href="/disuguaglianza">Distribuzione dei redditi →</Link>
          <Link href="/fonti">Registro delle fonti →</Link>
          <Link href="/dati">Catalogo dati →</Link>
        </p>
      </header>

      <div className={styles.families}>
        <FamilySection family={assoluta} />
        <FamilySection family={relativa} />
        <AbsoluteThresholdSection threshold={view.absoluteThreshold} />
        <RelativeThresholdSection threshold={view.relativeThreshold} />
        <AropeSection arope={view.arope} />
      </div>

      <details className="data-details">
        <summary>Definizioni, limiti e copertura</summary>
      <section className="notice" aria-labelledby="limiti-pagina">
        <h2 id="limiti-pagina">Come leggere gli indicatori</h2>
        <p>
          <strong>Non è spesa pubblica.</strong> Questi numeri dicono quante famiglie e quante
          persone vivono sotto una soglia, non quanto lo Stato spende per contrastare la povertà.
          Non vanno sommati né accostati a SIOPE, ai bilanci OpenBDAP o all&apos;IRPEF dichiarata.
        </p>
        <p>
          <strong>Le due misure non si sommano e non si sottraggono.</strong> Sono entrambe
          percentuali di famiglie, ma rispondono a domande diverse e gli insiemi non sono annidati:
          non esiste un totale «povertà», e la differenza fra le due non è una grandezza dotata di
          significato.
        </p>
        <p>
          <strong>Le soglie monetarie non sono incidenze.</strong> Gli importi mensili delle sezioni
          dedicate non si confrontano né si sommano con le percentuali di famiglie o individui, né
          fra soglia assoluta e relativa (territori e definizioni diverse). Non inventiamo un «gap»
          rispetto alla soglia: la fonte non lo pubblica. Nella soglia relativa l&apos;anno{" "}
          {view.relativeThreshold.excludedYear} è escluso perché i valori della fonte sono
          incoerenti con il resto della serie.
        </p>
        <p>
          <strong>AROPE non è povertà assoluta né relativa.</strong> È l&apos;indicatore composito
          Europa 2030 pubblicato da Eurostat (<code>{view.arope.source.dataflowId}</code>): rischio
          di povertà, grave deprivazione materiale e sociale, bassa intensità di lavoro. Non si
          somma né si confronta con le tabelle ISTAT sopra.
        </p>
        <p>
          <strong>Non c&apos;è una classifica.</strong> Le ripartizioni e le regioni sono elencate in
          ordine geografico, non per valore, e la pagina non attribuisce la povertà di un territorio
          a una manovra, a un governo o a una responsabilità locale.
        </p>
        <p>
          ISTAT non pubblica la povertà a livello comunale: è un&apos;indagine campionaria, e per la
          povertà assoluta l&apos;incidenza si ferma alle ripartizioni mentre la soglia monetaria
          assoluta espone le regioni per profili familiari; la soglia relativa resta nazionale.
        </p>
      </section>

      <section aria-labelledby="nota-ripartizioni">
        <h2 id="nota-ripartizioni">Perché Nord e Mezzogiorno non sono in tabella</h2>
        <p>
          La fonte pubblica anche{" "}
          {view.excludedComposites.map((area, index) => (
            <span key={area.code}>
              {index > 0 ? " e " : ""}
              <strong>{area.label}</strong>
            </span>
          ))}
          , che però sono aggregazioni delle ripartizioni già elencate sopra: Nord somma Nord-ovest e
          Nord-est, Mezzogiorno somma Sud e Isole. Metterli nella stessa tabella accanto alle loro
          parti sarebbe un doppio conteggio, quindi restano fuori dall&apos;elenco e sono disponibili
          via API per chi li cerca.
        </p>
      </section>
      </details>
    </main>
  );
}
