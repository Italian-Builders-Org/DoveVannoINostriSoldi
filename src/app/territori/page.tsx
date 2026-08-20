import Link from "next/link";
import { MunicipalSpendingTrendChart } from "@/components/charts/municipal-spending-trend-chart";
import { SpendingBarChart } from "@/components/charts/spending-bar-chart";
import {
  regionsByPerCapita,
  siopeMunicipalSnapshot as data,
} from "@/lib/siope-snapshot";
import styles from "./territori.module.css";

export const metadata = {
  title: "Territori",
  description:
    "Pagamenti di cassa SIOPE dei Comuni italiani: flussi mensili, regioni, categorie e principali amministrazioni.",
};

const euro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const integer = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 0,
});

function compactEuro(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("it-IT", { maximumFractionDigits: 2 })} mld €`;
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mln €`;
  }
  return euro.format(value);
}

function dateTime(value: string | null): string {
  if (!value) return "non disponibile";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(date);
}

const regionTotalData = data.regions.map((region) => ({
  label: region.region,
  value: region.value,
  code: `${integer.format(region.municipalities)} Comuni`,
}));

const regionPerCapitaData = regionsByPerCapita(data).map((region) => ({
  label: region.region,
  value: region.perCapita ?? 0,
  code: `${integer.format(region.municipalities)} Comuni`,
}));

const titleData = data.titles.map((title) => ({
  label: title.label,
  value: title.value,
  code: `Titolo ${title.code}`,
}));

const coverageRatio = data.coverage.activeSiopeMunicipalities > 0
  ? (data.coverage.withMovements / data.coverage.activeSiopeMunicipalities) * 100
  : 0;

export default function TerritoriesPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}>
            <span aria-hidden="true" /> SIOPE · CASSA DEI COMUNI
          </div>
          <h1>Dove spendono i Comuni italiani.</h1>
          <p>
            Pagamenti pubblicati da SIOPE e riuniti per territorio. La vista regionale raggruppa
            i Comuni in base alla sede dell&apos;ente: non dice necessariamente dove è avvenuta la spesa.
          </p>
        </div>

        <div className={styles.heroMeta}>
          <span>ULTIMO MESE DISPONIBILE</span>
          <strong>{data.latestMonthLabel} {data.year}</strong>
          <small>Snapshot generato {dateTime(data.generatedAt)}</small>
        </div>
      </section>

      <section className={styles.metricStrip} aria-label="Indicatori SIOPE dei Comuni">
        <article className={styles.primaryMetric}>
          <span>PAGAMENTI DA GENNAIO</span>
          <strong>{compactEuro(data.totalPaid)}</strong>
          <small>{euro.format(data.totalPaid)} · cassa SIOPE</small>
        </article>
        <article>
          <span>PER ABITANTE COPERTO</span>
          <strong>{data.nationalPerCapita === null ? "—" : euro.format(data.nationalPerCapita)}</strong>
          <small>rapporto descrittivo, non costo individuale</small>
        </article>
        <article>
          <span>COMUNI CON MOVIMENTI</span>
          <strong>{integer.format(data.coverage.withMovements)}</strong>
          <small>{coverageRatio.toLocaleString("it-IT", { maximumFractionDigits: 2 })}% degli enti comunali attivi SIOPE</small>
        </article>
        <article>
          <span>RIGHE ELABORATE</span>
          <strong>{integer.format(data.coverage.includedMovementRows)}</strong>
          <small>{integer.format(data.coverage.movementRows)} movimenti letti dalla fonte</small>
        </article>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionIndex}>01 · ANDAMENTO</span>
            <h2>Il ritmo dei pagamenti durante l&apos;anno</h2>
          </div>
          <p>
            Qui ogni barra mostra i pagamenti registrati nel singolo mese. Il totale da gennaio
            è la somma dei mesi già disponibili.
          </p>
        </div>
        <MunicipalSpendingTrendChart data={data.monthly} />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionIndex}>02 · REGIONI</span>
            <h2>Confrontare volume e intensità</h2>
          </div>
          <p>
            Le regioni più grandi tendono ad avere totali maggiori. Per questo mostriamo anche
            gli euro per abitante della popolazione coperta.
          </p>
        </div>

        <div className={styles.chartPair}>
          <article className={styles.chartPanel}>
            <header>
              <div>
                <span>TOTALE PAGATO</span>
                <h3>Regioni per pagamenti comunali</h3>
              </div>
              <b>{data.regions.length} regioni</b>
            </header>
            <SpendingBarChart
              data={regionTotalData}
              ariaLabel="Regioni italiane ordinate per pagamenti SIOPE dei Comuni"
              maxItems={10}
              height={430}
            />
            <p className={styles.chartNote}>Prime 10 per volume cumulato da gennaio.</p>
          </article>

          <article className={styles.chartPanel}>
            <header>
              <div>
                <span>NORMALIZZATO</span>
                <h3>Euro per abitante coperto</h3>
              </div>
              <b>€/abitante</b>
            </header>
            <SpendingBarChart
              data={regionPerCapitaData}
              ariaLabel="Regioni italiane ordinate per pagamenti comunali SIOPE per abitante"
              maxItems={10}
              height={430}
            />
            <p className={styles.chartNote}>
              Rapporto tra pagamenti dei Comuni aggregati e popolazione delle anagrafiche SIOPE abbinate.
            </p>
          </article>
        </div>
      </section>

      <section className={styles.splitSection}>
        <div className={styles.categoryPanel}>
          <div className={styles.panelHeading}>
            <div>
              <span className={styles.sectionIndex}>03 · NATURA ECONOMICA</span>
              <h2>Che tipo di uscita è</h2>
            </div>
          </div>
          <SpendingBarChart
            data={titleData}
            ariaLabel="Pagamenti dei Comuni per titolo SIOPE"
            maxItems={10}
            height={365}
          />
          <p className={styles.chartNote}>
            Raggruppamento per titolo ricavato dalla codifica gestionale SIOPE; il dettaglio delle singole voci arriverà nel drill-down dell&apos;ente.
          </p>
        </div>

        <aside className={styles.coveragePanel}>
          <span className={styles.sectionIndex}>COPERTURA</span>
          <h2>Quanto del registro stiamo leggendo</h2>
          <div className={styles.coverageNumber}>
            <strong>{coverageRatio.toLocaleString("it-IT", { maximumFractionDigits: 2 })}%</strong>
            <span>{integer.format(data.coverage.withMovements)} / {integer.format(data.coverage.activeSiopeMunicipalities)} enti</span>
          </div>
          <div className={styles.coverageTrack} aria-hidden="true">
            <i style={{ width: `${Math.min(coverageRatio, 100)}%` }} />
          </div>
          <dl className={styles.coverageList}>
            <div>
              <dt>Abbinati a regione IPA</dt>
              <dd>{integer.format(data.coverage.matchedToIpaRegion)}</dd>
            </div>
            <div>
              <dt>Non abbinati automaticamente</dt>
              <dd>{integer.format(data.coverage.unmatchedToIpaRegion)}</dd>
            </div>
            <div>
              <dt>Righe malformate</dt>
              <dd>{integer.format(data.coverage.malformedRows)}</dd>
            </div>
            <div>
              <dt>Popolazione coperta</dt>
              <dd>{integer.format(data.populationCovered)}</dd>
            </div>
          </dl>
          <p>
            Gli enti non abbinati restano fuori dalle aggregazioni regionali: preferiamo una lacuna dichiarata a un join geografico indovinato.
          </p>
        </aside>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionIndex}>04 · AMMINISTRAZIONI</span>
            <h2>I maggiori volumi comunali</h2>
          </div>
          <p>
            È una classifica per volume di pagamenti di cassa, non una classifica di efficienza,
            merito o spreco. Dimensione, funzioni e popolazione rendono i Comuni non direttamente equivalenti.
          </p>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Comune</th>
                <th scope="col">Regione</th>
                <th scope="col">Pagamenti YTD</th>
                <th scope="col">€/abitante</th>
              </tr>
            </thead>
            <tbody>
              {data.topMunicipalities.slice(0, 15).map((municipality, index) => (
                <tr key={municipality.codiceFiscale}>
                  <td>{String(index + 1).padStart(2, "0")}</td>
                  <th scope="row">
                    <strong>{municipality.name}</strong>
                    <small>CF {municipality.codiceFiscale}</small>
                  </th>
                  <td>{municipality.region}</td>
                  <td>{euro.format(municipality.value)}</td>
                  <td>{municipality.perCapita === null ? "—" : euro.format(municipality.perCapita)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.provenance}>
        <div className={styles.provenanceIntro}>
          <span className={styles.sectionIndex}>05 · PROVENIENZA</span>
          <h2>Il grafico non è la fonte.</h2>
          <p>
            Lo snapshot conserva gli URL upstream e i loro validator. Il controllo gira
            frequentemente, ma il dato cambia soltanto quando cambia la pubblicazione ufficiale.
          </p>
          <Link href="/fonti/stato" className={styles.inlineLink}>
            Stato di tutte le fonti <span aria-hidden="true">→</span>
          </Link>
        </div>

        <div className={styles.sourceLedger}>
          <a href={data.source.siopeMovementsUrl} target="_blank" rel="noreferrer">
            <span>01</span>
            <div>
              <strong>SIOPE · movimenti di uscita {data.year}</strong>
              <small>Fonte primaria · modificata {dateTime(data.source.siopeMovementsLastModified)}</small>
            </div>
            <i aria-hidden="true">↗</i>
          </a>
          <a href={data.source.siopeRegistryUrl} target="_blank" rel="noreferrer">
            <span>02</span>
            <div>
              <strong>SIOPE · anagrafiche</strong>
              <small>Ente, codice fiscale e popolazione · modificata {dateTime(data.source.siopeRegistryLastModified)}</small>
            </div>
            <i aria-hidden="true">↗</i>
          </a>
          <a href={data.source.ipaUrl} target="_blank" rel="noreferrer">
            <span>03</span>
            <div>
              <strong>Indice PA · amministrazioni</strong>
              <small>Join codice fiscale → regione · modificata {dateTime(data.source.ipaLastModified)}</small>
            </div>
            <i aria-hidden="true">↗</i>
          </a>
        </div>
      </section>

      <section className={styles.methodologyNotice}>
        <div>
          <span>COME LEGGERE QUESTI NUMERI</span>
          <strong>{data.methodology.measure}</strong>
        </div>
        <p>{data.methodology.warning}</p>
        <Link href="/metodologia">Metodologia completa →</Link>
      </section>
    </main>
  );
}
