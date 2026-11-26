import type { Metadata } from "next";
import Link from "next/link";

import { ChartDataTable } from "@/components/charts/chart-data-table";
import { anacCigUrl, type ConventionYear } from "@/lib/pa-licenze-software";
import { LicenzeSnapshotUnavailableError, loadLicenzeView, type LicenzePageData } from "@/lib/pa-licenze-software-store";

import styles from "./licenze.module.css";

const PAGE_PATH = "/appalti/licenze-software";

export const metadata: Metadata = {
  title: "Licenze software della PA: quanto spende lo Stato e a chi vanno i soldi",
  description:
    "Ordini delle pubbliche amministrazioni sulle convenzioni Consip per licenze software (Microsoft, Oracle, VMware, SAP e altri), acquisti sul MePA, aggiudicazioni ANAC con CPV 48 e pagamenti delle ASL: tre fonti ufficiali che non si sommano.",
  alternates: { canonical: PAGE_PATH },
};

// Read from dvns_snapshots at request time, once per instance: a build without database
// must not freeze the "not available" state into a static page.
export const dynamic = "force-dynamic";

const integer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });
const oneDecimal = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

function euro(cents: number): string {
  const value = cents / 100;
  if (value >= 1_000_000_000) return `${compact.format(value / 1_000_000_000)} mld €`;
  if (value >= 1_000_000) return `${compact.format(value / 1_000_000)} mln €`;
  return `${integer.format(Math.round(value))} €`;
}

function pct(part: number, total: number): string {
  return total === 0 ? "n.d." : `${oneDecimal.format((part / total) * 100)}%`;
}

function plural(value: number, one: string, many: string): string {
  return `${integer.format(value)} ${value === 1 ? one : many}`;
}

function italianDate(iso: string): string {
  return iso.split("-").reverse().join("/");
}

type Bar = { key: string; label: string; note?: string; cents: number; tone: "proprietary" | "open" | "plain"; aside?: string };

function Bars({ title, rows, columns, values }: { title: string; rows: Bar[]; columns: string[]; values: (row: Bar) => string[] }) {
  const max = Math.max(1, ...rows.map((row) => row.cents));
  return (
    <figure style={{ margin: 0 }}>
      <ol className={styles.bars} aria-label={title}>
        {rows.map((row) => (
          <li key={row.key} data-bar={row.key}>
            <span className={styles.barLabel}>
              {row.label}
              {row.note ? <span className={styles.cellNote}>{row.note}</span> : null}
            </span>
            <span className={styles.barTrack} aria-hidden="true">
              <span className={styles.barFill} data-tone={row.tone} style={{ width: `${(row.cents / max) * 100}%` }} />
            </span>
            <span className={styles.barValue}>
              <strong>{euro(row.cents)}</strong>
              {row.aside ? <span className={styles.cellNote}>{row.aside}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <ChartDataTable label={title} columns={columns} rows={rows.map((row) => ({ label: row.label, values: values(row) }))} />
    </figure>
  );
}

function yearLabel(year: ConventionYear | { year: number }, partialYear: number, updatedAt: string): string {
  return year.year === partialYear ? `${year.year} (fino al ${italianDate(updatedAt)})` : String(year.year);
}

function Unavailable() {
  return (
    <main className="shell page">
      <div className="page-intro">
        <h1>Licenze software della PA</h1>
        <p>
          Dati temporaneamente non disponibili. La pagina legge uno snapshot verificato degli open data Consip, ANAC e
          SIOPE: quando non è raggiungibile o non corrisponde alla ricevuta pubblicata, non mostriamo numeri.
        </p>
      </div>
      <div className={styles.links}>
        <Link href="/appalti">Appalti pubblici</Link>
        <Link href="/appalti/mepa">MePA e bandi Consip</Link>
        <a href="https://dati.consip.it/" target="_blank" rel="noreferrer">Open data Consip ↗</a>
      </div>
    </main>
  );
}

export default async function LicenzeSoftwarePage() {
  let data: LicenzePageData;
  try {
    data = await loadLicenzeView();
  } catch (error) {
    if (error instanceof LicenzeSnapshotUnavailableError) return <Unavailable />;
    throw error;
  }
  const { snapshot, view } = data;
  const ref = view.referenceYear;
  const { anac, siope, sources } = snapshot;
  const mepaRef = view.mepaYears.find((year) => year.year === ref.year);
  const partial = view.partialYear;
  const updated = snapshot.partialYearUpdatedAt;
  const openVendors = ref.vendors.filter((row) => row.openSource).map((row) => row.vendor);
  const siopeComplete = siope.byYear.filter((year) => year.monthsObserved === 12);
  const siopeRef = siopeComplete.at(-1);
  // Ten named types and the rest together: the rows still add up to the year total.
  const topTypes = ref.byAdministrationType.slice(0, 10);
  const otherTypes = ref.byAdministrationType.slice(10);
  const administrationRows = otherTypes.length
    ? [...topTypes, { type: `Altre ${otherTypes.length} tipologie`, cents: otherTypes.reduce((sum, row) => sum + row.cents, 0), orders: otherTypes.reduce((sum, row) => sum + row.orders, 0) }]
    : topTypes;

  return (
    <main className="shell page">
      <div className="page-intro">
        <nav className={styles.breadcrumb} aria-label="Percorso">
          <Link href="/appalti">Appalti</Link>
          <span aria-hidden="true">/</span>
          <span>Licenze software</span>
        </nav>
        <h1>Licenze software della PA: {euro(ref.cents)} ordinati nel {ref.year} sulle convenzioni Consip</h1>
        <p>
          Nel {ref.year} le pubbliche amministrazioni hanno ordinato {euro(ref.cents)} di licenze, sottoscrizioni e
          manutenzione software attraverso le convenzioni Consip dedicate. {euro(ref.microsoftCents)} ({pct(ref.microsoftCents, ref.cents)})
          sono andati a prodotti Microsoft. Sono numeri di fonti ufficiali, ma misurano cose diverse: per questo li
          mostriamo separati e non li sommiamo mai.
        </p>
        <nav className={styles.toc} aria-label="In questa pagina">
          <a href="#convenzioni">Convenzioni Consip per produttore</a>
          <a href="#mepa">MePA</a>
          <a href="#anac">Gare con CPV software (ANAC)</a>
          <a href="#asl">Pagamenti delle ASL</a>
          <a href="#metodo">Perché non sommiamo e non stimiamo risparmi</a>
          <a href="#fonti">Fonti</a>
        </nav>
      </div>

      <dl className="stat-strip">
        <div>
          <dt>Convenzioni software Consip, {ref.year}</dt>
          <dd data-stat="convenzioni">{euro(ref.cents)}</dd>
          <span className="stat-note">{integer.format(ref.orders)} ordini, importo ordinato</span>
        </div>
        <div>
          <dt>Di cui Microsoft</dt>
          <dd data-stat="microsoft">{pct(ref.microsoftCents, ref.cents)}</dd>
          <span className="stat-note">{euro(ref.microsoftCents)}</span>
        </div>
        <div>
          <dt>Sottoscrizioni open source</dt>
          <dd data-stat="open-source">{pct(ref.openSourceCents, ref.cents)}</dd>
          <span className="stat-note">{openVendors.join(" e ")}: {euro(ref.openSourceCents)}</span>
        </div>
        {mepaRef ? (
          <div>
            <dt>MePA, categoria licenze, {ref.year}</dt>
            <dd data-stat="mepa">{euro(mepaRef.cents)}</dd>
            <span className="stat-note">ordini diretti, produttore non indicato</span>
          </div>
        ) : null}
      </dl>

      <div className={styles.sections}>
        <section className="panel" aria-labelledby="convenzioni">
          <h2 id="convenzioni" className="panel-title">A chi vanno i soldi delle convenzioni Consip</h2>
          <p className={styles.lede}>
            Consip pubblica gli ordini fatti dalle amministrazioni su ogni convenzione e lotto. Contiamo tre famiglie di
            convenzioni software: {snapshot.consip.families.map((family) => family.label).join(", ")}. Il produttore è
            scritto nel nome del lotto (per esempio «Prodotti Oracle e servizi connessi»); per Microsoft Enterprise
            Agreement è uno solo.
          </p>
          <ul className={styles.legend} aria-label="Legenda">
            <li><span className={styles.swatch} data-tone="proprietary" aria-hidden="true" />Software proprietario</li>
            <li><span className={styles.swatch} data-tone="open" aria-hidden="true" />Sottoscrizioni open source, come le chiama la fonte</li>
          </ul>
          <Bars
            title={`Importo ordinato per produttore, convenzioni software Consip ${ref.year}`}
            rows={ref.vendors.map((row) => ({
              key: row.vendor,
              label: row.vendor,
              note: row.openSource ? "open source: sottoscrizione e assistenza" : undefined,
              cents: row.cents,
              tone: row.openSource ? "open" : "proprietary",
              aside: `${pct(row.cents, ref.cents)} · ${plural(row.orders, "ordine", "ordini")}`,
            }))}
            columns={["Importo ordinato", "Quota", "Ordini"]}
            values={(row) => {
              const vendor = ref.vendors.find((item) => item.vendor === row.key);
              return [euro(row.cents), pct(row.cents, ref.cents), integer.format(vendor?.orders ?? 0)];
            }}
          />
          <p className={styles.note}>
            «Open source» qui non vuol dire gratis: Red Hat e SUSE sono pagati per sottoscrizioni, aggiornamenti e
            assistenza. Gli importi comprendono anche i servizi connessi previsti dai lotti (installazione, supporto).
          </p>

          <h3 className={styles.subtitle}>Anno per anno</h3>
          <div className="table-scroll" role="region" aria-labelledby="anni-tabella" tabIndex={0}>
            <table className="table">
              <caption id="anni-tabella" className="table-caption">Convenzioni software Consip: importo ordinato per anno</caption>
              <thead>
                <tr>
                  <th scope="col">Anno</th>
                  <th scope="col" className="num">Licenze software</th>
                  <th scope="col" className="num">Di cui Microsoft</th>
                  <th scope="col" className="num">Ordini</th>
                  <th scope="col" className="num">Quota sul totale delle convenzioni Consip</th>
                </tr>
              </thead>
              <tbody>
                {view.conventionYears.map((year) => {
                  const microsoft = year.byVendor.find((row) => row.vendor === "Microsoft")?.cents ?? 0;
                  return (
                    <tr key={year.year} data-year={year.year}>
                      <th scope="row">{yearLabel(year, snapshot.partialYear, updated)}</th>
                      <td className="num">{euro(year.cents)}</td>
                      <td className="num">{euro(microsoft)}</td>
                      <td className="num">{integer.format(year.orders)}</td>
                      <td className="num">{pct(year.cents, year.allConventionsCents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {partial ? (
            <p className={styles.note}>
              Il {partial.year} è parziale: ordini fino all&apos;aggiornamento Consip del {italianDate(updated)}. Non va
              confrontato con gli anni interi.{" "}
              {partial.byConvention[0]
                ? `La voce più grande del ${partial.year} è ${partial.byConvention[0].convention}, con ${euro(partial.byConvention[0].cents)}: gli accordi pluriennali si rinnovano a ondate, quindi gli importi oscillano da un anno all'altro.`
                : null}
            </p>
          ) : null}

          <h3 className={styles.subtitle}>Per convenzione, {ref.year}</h3>
          <Bars
            title={`Importo ordinato per convenzione, ${ref.year}`}
            rows={ref.byConvention.map((row) => ({ key: row.convention, label: row.convention, cents: row.cents, tone: "plain", aside: `${plural(row.orders, "ordine", "ordini")}` }))}
            columns={["Importo ordinato", "Ordini"]}
            values={(row) => [euro(row.cents), integer.format(ref.byConvention.find((item) => item.convention === row.key)?.orders ?? 0)]}
          />

          <h3 className={styles.subtitle}>Chi ordina, {ref.year}</h3>
          <Bars
            title={`Importo ordinato per tipo di amministrazione, ${ref.year}`}
            rows={administrationRows.map((row) => ({ key: row.type, label: row.type, cents: row.cents, tone: "plain", aside: pct(row.cents, ref.cents) }))}
            columns={["Importo ordinato", "Quota"]}
            values={(row) => [euro(row.cents), pct(row.cents, ref.cents)]}
          />
          <p className={styles.note}>Tipologie di amministrazione come classificate da Consip.</p>
        </section>

        <section className="panel" aria-labelledby="mepa">
          <h2 id="mepa" className="panel-title">Acquisti diretti sul MePA</h2>
          <p className={styles.lede}>
            Fuori dalle convenzioni, le amministrazioni comprano licenze anche sul Mercato elettronico (MePA), nelle
            categorie «{snapshot.consip.mepaCategories.join("» e «")}». Qui Consip non indica il produttore né, per queste
            righe, il numero di ordini: pubblichiamo solo l&apos;importo.
          </p>
          <Bars
            title="Importo degli ordini MePA nella categoria licenze software, per anno"
            rows={view.mepaYears.map((year) => ({
              key: String(year.year),
              label: yearLabel(year, snapshot.partialYear, updated),
              cents: year.cents,
              tone: "plain",
              aside: `${pct(year.cents, year.allMepaCents)} di tutto il MePA`,
            }))}
            columns={["Importo ordinato", "Quota di tutto il MePA"]}
            values={(row) => {
              const year = view.mepaYears.find((item) => String(item.year) === row.key);
              return [euro(row.cents), year ? pct(year.cents, year.allMepaCents) : "n.d."];
            }}
          />
          <p className={styles.note}>
            Convenzioni e MePA sono canali distinti di Consip: le due cifre non contengono gli stessi ordini, ma la
            categoria MePA comprende anche servizi sulle licenze. Le teniamo separate perché il perimetro non coincide.
          </p>
        </section>

        <section className="panel" aria-labelledby="anac">
          <h2 id="anac" className="panel-title">Gare con oggetto software: le aggiudicazioni ANAC</h2>
          <p className={styles.lede}>
            ANAC classifica ogni procedura con un codice CPV. Le procedure della divisione {anac.cpvDivision} («pacchetti
            software e sistemi di informazione») della coorte «{anac.cohort}» hanno aggiudicazioni per{" "}
            <strong>{euro(anac.cents)}</strong> ({integer.format(anac.awards)} aggiudicazioni). È un perimetro più largo
            delle licenze: comprende anche sviluppo e gestione di sistemi, e contiene gli ordini Consip come CIG derivati.
          </p>
          <div className={`${styles.callout} ${styles.warning}`}>
            Questa cifra non va sommata a quelle Consip: gli stessi acquisti compaiono in entrambe. Un importo aggiudicato
            può coprire più anni e non è un pagamento.
          </div>
          <h3 className={styles.subtitle}>Per codice CPV</h3>
          <Bars
            title={`Importo aggiudicato per CPV, divisione ${anac.cpvDivision}`}
            rows={anac.byCpv.map((row) => ({ key: row.code, label: row.label.toLowerCase(), note: row.code, cents: row.cents, tone: "plain", aside: `${plural(row.awards, "aggiudicazione", "aggiudicazioni")}` }))}
            columns={["Codice", "Importo aggiudicato", "Aggiudicazioni"]}
            values={(row) => {
              const item = anac.byCpv.find((entry) => entry.code === row.key);
              return [row.key, euro(row.cents), integer.format(item?.awards ?? 0)];
            }}
          />

          <h3 className={styles.subtitle}>Le dieci aggiudicazioni più grandi</h3>
          <div className="table-scroll" role="region" aria-labelledby="cig-tabella" tabIndex={0}>
            <table className="table">
              <caption id="cig-tabella" className="table-caption">Verificabili una per una sul portale ANAC tramite il CIG</caption>
              <thead>
                <tr>
                  <th scope="col">CIG</th>
                  <th scope="col">Ente</th>
                  <th scope="col">Aggiudicatario</th>
                  <th scope="col" className="num">Importo</th>
                </tr>
              </thead>
              <tbody>
                {anac.largestAwards.map((award) => (
                  <tr key={award.cig} data-cig={award.cig}>
                    <th scope="row">
                      <a href={anacCigUrl(award.cig)} target="_blank" rel="noreferrer">{award.cig} ↗</a>
                      <span className={styles.cellNote}>CPV {award.cpv}</span>
                    </th>
                    <td>
                      <Link prefetch={false} href={`/enti/${encodeURIComponent(award.codiceIpa)}/appalti`}>{award.entity ?? award.codiceIpa}</Link>
                    </td>
                    <td>{award.vendor ?? <span className={styles.cellNote}>più operatori o non indicato</span>}</td>
                    <td className="num">{euro(award.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className={styles.subtitle}>Enti con più importi aggiudicati</h3>
          <Bars
            title="Importo aggiudicato per ente, divisione CPV 48"
            rows={anac.topEntities.map((row) => ({ key: row.codiceIpa, label: row.entity ?? row.codiceIpa, cents: row.cents, tone: "plain", aside: `${plural(row.awards, "aggiudicazione", "aggiudicazioni")}` }))}
            columns={["Importo aggiudicato", "Aggiudicazioni"]}
            values={(row) => [euro(row.cents), integer.format(anac.topEntities.find((item) => item.codiceIpa === row.key)?.awards ?? 0)]}
          />

          <h3 className={styles.subtitle}>Aggiudicatari</h3>
          <Bars
            title="Importo aggiudicato per operatore, solo aggiudicazioni a un singolo operatore"
            rows={anac.topVendors.map((row) => ({ key: row.vendor, label: row.vendor, cents: row.cents, tone: "plain", aside: `${plural(row.awards, "aggiudicazione", "aggiudicazioni")}` }))}
            columns={["Importo aggiudicato", "Aggiudicazioni"]}
            values={(row) => [euro(row.cents), integer.format(anac.topVendors.find((item) => item.vendor === row.key)?.awards ?? 0)]}
          />
          <p className={styles.note}>
            Gli aggiudicatari sono spesso rivenditori o integratori, non il produttore del software. Attribuiamo un
            importo solo quando l&apos;aggiudicazione ha un unico operatore: {pct(anac.attributedCents, anac.cents)} del
            totale. Raggruppiamo i nomi che differiscono solo per forma societaria o punteggiatura.
          </p>
        </section>

        <section className="panel" aria-labelledby="asl">
          <h2 id="asl" className="panel-title">Quanto pagano davvero le ASL</h2>
          <p className={styles.lede}>
            Il SIOPE registra i pagamenti di cassa. Solo il piano dei conti degli enti del Servizio sanitario ha una voce
            dedicata, «{siope.label}» (codice {siope.code}): per Comuni, Regioni e Ministeri le licenze sono mescolate ad
            altri servizi informatici e non si possono isolare.
          </p>
          <Bars
            title={`Pagamenti SIOPE sul codice ${siope.code}, enti sanitari presenti nel nostro archivio`}
            rows={siope.byYear.map((year) => ({
              key: String(year.year),
              label: year.monthsObserved === 12 ? String(year.year) : `${year.year} (${year.monthsObserved} mesi)`,
              cents: year.cents,
              tone: "plain",
              aside: `${plural(year.entities, "ente", "enti")}`,
            }))}
            columns={["Pagamenti", "Enti con pagamenti", "Mesi osservati"]}
            values={(row) => {
              const year = siope.byYear.find((item) => String(item.year) === row.key);
              return [euro(row.cents), integer.format(year?.entities ?? 0), integer.format(year?.monthsObserved ?? 0)];
            }}
          />
          <p className={styles.note}>
            {siopeRef ? `Nel ${siopeRef.year} pagano su questa voce ${integer.format(siopeRef.entities)} enti sanitari. ` : null}
            È un sottoinsieme degli enti del Servizio sanitario, quelli acquisiti nel nostro archivio SIOPE: non è il totale
            nazionale della sanità.
          </p>
        </section>

        <section className="panel" aria-labelledby="metodo">
          <h2 id="metodo" className="panel-title">Perché non sommiamo e non stimiamo risparmi</h2>
          <ul className={styles.sources}>
            <li>
              <strong>Tre misure diverse.</strong> Consip pubblica l&apos;ordinato, ANAC l&apos;aggiudicato (anche pluriennale), il
              SIOPE il pagato. Gli ordini Consip ricompaiono in ANAC, e i pagamenti delle ASL derivano in parte da entrambi.
              Sommarli conterebbe due o tre volte la stessa spesa.
            </li>
            <li>
              <strong>Nessuna stima di risparmio.</strong> Per dire quanto si risparmierebbe passando al software libero
              servirebbero i costi di migrazione, formazione e assistenza dell&apos;alternativa per gli stessi usi. Nessuna fonte
              ufficiale li pubblica: qualunque cifra sarebbe un&apos;ipotesi nostra, non un dato.
            </li>
            <li>
              <strong>Non è tutta la spesa in licenze.</strong> Mancano le licenze comprate con gare autonome classificate
              con altri CPV, quelle incluse in contratti di servizi e gli abbonamenti cloud contabilizzati altrove.
            </li>
            <li>
              <strong>Il produttore viene dal nome del lotto.</strong> Ogni lotto delle convenzioni Multibrand e On Premise
              nomina un solo produttore; un lotto non riconosciuto blocca la pubblicazione invece di finire in «altro».
            </li>
          </ul>
        </section>

        <section className="panel" aria-labelledby="fonti">
          <h2 id="fonti" className="panel-title">Fonti</h2>
          <ul className={styles.sources}>
            <li>
              <a href={sources.consip.landingUrl} target="_blank" rel="noreferrer">{sources.consip.owner}, open data ordini in convenzione e sul MePA ↗</a>{" "}
              · licenza <a href={sources.consip.licenseUrl} target="_blank" rel="noreferrer">{sources.consip.license}</a> · file acquisiti il{" "}
              {italianDate(sources.consip.acquiredAt)} e verificati con SHA-256.
            </li>
            <li>
              <a href={sources.anac.landingUrl} target="_blank" rel="noreferrer">{sources.anac.owner}, open data CIG e aggiudicazioni ↗</a>{" "}
              · {sources.anac.cohort} · licenza <a href={sources.anac.licenseUrl} target="_blank" rel="noreferrer">{sources.anac.license}</a>.
              Denominazioni degli enti dall&apos;
              <a href={sources.ipa.url} target="_blank" rel="noreferrer">Indice dei domicili digitali della PA (IPA) ↗</a>.
            </li>
            <li>
              <a href={sources.siope.landingUrl} target="_blank" rel="noreferrer">SIOPE, {sources.siope.owner} ↗</a> · licenza {sources.siope.license}.
            </li>
          </ul>
          <div className={styles.links} style={{ marginTop: 12 }}>
            <Link href="/appalti/mepa">Bandi e gare Consip</Link>
            <Link href="/appalti/operatori">Imprese aggiudicatarie</Link>
            <Link href="/appalti">Appalti pubblici</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
