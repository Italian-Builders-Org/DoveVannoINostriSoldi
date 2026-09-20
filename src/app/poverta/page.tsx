import type { Metadata } from "next";
import Link from "next/link";
import { compactEuroFromCents, longDate, percent } from "@/lib/format";
import {
  buildPovertaPageView,
  type PovertaAbsoluteThresholdView,
  type PovertaFamilyView,
} from "@/lib/poverta-page";
import styles from "./poverta.module.css";

export const metadata: Metadata = {
  title: "Povertà assoluta e relativa",
  description:
    "Indicatori ufficiali ISTAT di povertà assoluta e relativa, più la soglia monetaria assoluta per regione come contesto. Misure distinte, mai sommate.",
};

function rate(value: number | null): string {
  return value === null ? "Non disponibile" : percent(value);
}

function money(valueHundredths: number | null): string {
  return valueHundredths === null ? "Non disponibile" : compactEuroFromCents(valueHundredths);
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
          dalla spesa media delle famiglie italiane. Sotto, in sezione separata, la soglia monetaria
          assoluta per regione: un importo, non una percentuale.
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
          <strong>La soglia monetaria non è un&apos;incidenza.</strong> L&apos;importo mensile della
          sezione dedicata non si confronta né si somma con le percentuali di famiglie o individui.
          Non inventiamo un «gap» rispetto alla soglia: la fonte non lo pubblica.
        </p>
        <p>
          <strong>Non c&apos;è una classifica.</strong> Le ripartizioni e le regioni sono elencate in
          ordine geografico, non per valore, e la pagina non attribuisce la povertà di un territorio
          a una manovra, a un governo o a una responsabilità locale.
        </p>
        <p>
          ISTAT non pubblica la povertà a livello comunale: è un&apos;indagine campionaria, e per la
          povertà assoluta l&apos;incidenza si ferma alle ripartizioni mentre la soglia monetaria
          espone le regioni per profili familiari e ampiezze demografiche.
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
