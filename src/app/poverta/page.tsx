import type { Metadata } from "next";
import Link from "next/link";
import { longDate, percent } from "@/lib/format";
import { buildPovertaPageView, type PovertaFamilyView } from "@/lib/poverta-page";
import styles from "./poverta.module.css";

export const metadata: Metadata = {
  title: "Povertà assoluta e relativa",
  description:
    "Gli indicatori ufficiali ISTAT di povertà assoluta e relativa in Italia e per ripartizione, dal 2014. Due definizioni distinte, mai sommate.",
};

function rate(value: number | null): string {
  return value === null ? "n.d." : percent(value);
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
        {longDate(family.source.observedAt)} · licenza {family.source.licenseId} ·{" "}
        <a href={family.source.landingUrl}>vai al databrowser ISTAT</a>
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
        <p className="eyebrow">Condizioni economiche · Povertà</p>
        <h1>Povertà assoluta e relativa in Italia</h1>
        <p>
          Gli indicatori ufficiali ISTAT, dal {assoluta.period.from} al {assoluta.period.to}, per
          l&apos;Italia e le sue ripartizioni. Sono <strong>due misure distinte</strong>: la povertà
          assoluta guarda al costo di un paniere di beni essenziali, quella relativa alla distanza
          dalla spesa media delle famiglie italiane.
        </p>
        <p className={styles.leadLinks}>
          <Link href="/fonti">Registro delle fonti →</Link>
          <Link href="/dati">Catalogo dati →</Link>
        </p>
      </header>

      <section className="notice" aria-labelledby="limiti-pagina">
        <h2 id="limiti-pagina">Cosa non è questa pagina</h2>
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
          <strong>Non c&apos;è una classifica.</strong> Le ripartizioni sono elencate in ordine
          geografico, non per valore, e la pagina non attribuisce la povertà di un territorio a una
          manovra, a un governo o a una responsabilità locale.
        </p>
        <p>
          ISTAT non pubblica la povertà a livello comunale: è un&apos;indagine campionaria, e per la
          povertà assoluta il dettaglio si ferma alle ripartizioni.
        </p>
      </section>

      <div className={styles.families}>
        <FamilySection family={assoluta} />
        <FamilySection family={relativa} />
      </div>

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
    </main>
  );
}
