import type { Metadata } from "next";
import Link from "next/link";
import { integer } from "@/lib/format";
import {
  ADE_IMMOBILI_ACQUISITION_DATE,
  ADE_IMMOBILI_LANDING,
  ADE_IMMOBILI_OPEN_DATA_ZIP,
  ADE_IMMOBILI_PRELIEVO_DATASET,
  ADE_IMMOBILI_TABELLE_DATASET,
  ADE_IMMOBILI_UTILIZZO_DATASET,
  buildPrelievoChartSeries,
  getAdeImmobiliAnalysis,
} from "@/lib/ade-immobili-italia-2026";
import {
  getAdeImmobiliHousingInsights,
  type HousingTerritoryInsight,
} from "@/lib/ade-immobili-utilizzo-insights";
import { getAdeImmobiliTabelleInsights } from "@/lib/ade-immobili-tabelle-insights";
import { PrelievoChart } from "./prelievo-chart";
import styles from "./immobili-italia-2026.module.css";

export const metadata: Metadata = {
  title: "Gli immobili in Italia 2026 · fiscalità e stock catastale",
  description:
    "Come leggere i dati AdE 2026: quanto preleva l’Italia su IMU e cedolare secca, e come sono usate le abitazioni (anno d’imposta 2023).",
  alternates: { canonical: "/analisi/immobili-italia-2026" },
};

const moneyMld = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

const pctFormat = new Intl.NumberFormat("it-IT", {
  style: "percent",
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

const euroFormat = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

type Search = Record<string, string | string[] | undefined>;

function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatMld(raw: string): string {
  return moneyMld.format(Number.parseFloat(raw.replace(",", ".")));
}

const STACK_COLORS = [
  "var(--color-accent-700)",
  "var(--color-accent-500, #c45c4a)",
  "var(--color-neutral-600)",
  "var(--color-neutral-500)",
  "var(--color-neutral-400)",
  "var(--color-neutral-300)",
  "var(--color-neutral-200)",
];

function HousingBars({
  insight,
  muted = false,
  showStack = false,
}: {
  insight: HousingTerritoryInsight;
  muted?: boolean;
  showStack?: boolean;
}) {
  const max = Math.max(...insight.uses.map((use) => use.count), 1);
  const accounted = insight.uses.reduce((sum, use) => sum + use.count, 0);
  return (
    <div>
      {showStack && insight.totalHomes && accounted > 0 ? (
        <>
          <div
            className={styles.stack}
            role="img"
            aria-label={`Composizione abitazioni · ${insight.territoryLabel}`}
          >
            {insight.uses.map((use, index) => (
              <div
                key={use.label}
                className={styles.stackSeg}
                style={{
                  width: `${(use.count / accounted) * 100}%`,
                  background: STACK_COLORS[index % STACK_COLORS.length],
                  opacity: muted ? 0.55 : 1,
                }}
                title={`${use.label}: ${integer(use.count)}`}
              />
            ))}
          </div>
          <ul className={styles.stackLegend}>
            {insight.uses.slice(0, 4).map((use, index) => (
              <li key={use.label}>
                <span className={styles.swatch} style={{ background: STACK_COLORS[index % STACK_COLORS.length] }} />
                {use.label}
                {use.shareOfTotal !== null ? ` ${pctFormat.format(use.shareOfTotal)}` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className={styles.bars} role="list" aria-label={`Utilizzo abitazioni · ${insight.territoryLabel}`}>
        {insight.uses.map((use) => {
          const width = `${Math.max(2, (use.count / max) * 100)}%`;
          return (
            <div key={use.label} className={styles.barRow} role="listitem">
              <div className={styles.barLabel}>
                <strong>{use.label}</strong>
                <span className={styles.barMeta}>
                  {integer(use.count)}
                  {use.shareOfTotal !== null ? ` · ${pctFormat.format(use.shareOfTotal)}` : ""}
                </span>
              </div>
              <div className={styles.track} aria-hidden="true">
                <div className={muted ? styles.fillMuted : styles.fill} style={{ width }} />
              </div>
              <p className={styles.barHint}>{use.hint}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function AdeImmobiliItalia2026Page({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const search = await searchParams;
  const analysis = getAdeImmobiliAnalysis();
  const prelievoSeries = buildPrelievoChartSeries(analysis);
  const housing = await getAdeImmobiliHousingInsights(param(search.prov));
  const tables = await getAdeImmobiliTabelleInsights();

  const imu2024 = formatMld(analysis.hero.imuGettito2024Mld);
  const cedolare2024 = prelievoSeries
    .find((voice) => voice.voice === "Cedolare secca")
    ?.points.find((point) => point.year === 2024)?.mld;
  const cedolare2015 = prelievoSeries
    .find((voice) => voice.voice === "Cedolare secca")
    ?.points.find((point) => point.year === 2015)?.mld;
  const principali = housing.national.uses.find((use) => use.label === "Abitazione principale");

  return (
    <main className={`shell page ${styles.page}`}>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>Agenzia delle Entrate · volume 2026</p>
        <h1>Gli immobili in Italia</h1>
        <p className={styles.lede}>
          Nel 2024 l’IMU ha portato circa <strong>{imu2024} miliardi di euro</strong> di gettito
          nazionale. Nel frattempo la cedolare secca sugli affitti è cresciuta da{" "}
          {cedolare2015 !== null && cedolare2015 !== undefined ? moneyMld.format(cedolare2015) : "n.d."} a{" "}
          {cedolare2024 !== null && cedolare2024 !== undefined ? moneyMld.format(cedolare2024) : "n.d."}{" "}
          miliardi. Sotto: come leggere queste tasse e come sono usate le abitazioni catastali
          (anno d’imposta {analysis.coverage.taxYear}).
        </p>
        <p className={styles.meta}>
          Fonte ufficiale AdE · acquisizione snapshot {ADE_IMMOBILI_ACQUISITION_DATE}. Non sono
          bilanci comunali né pagamenti SIOPE.
        </p>
        <nav className={styles.jump} aria-label="Sezioni">
          <a href="#prelievo">Prelievo fiscale</a>
          <a href="#stock">Come si usano le case</a>
          <a href="#aree">Nord, Centro, Sud</a>
          <a href="#valore">Valore per regione</a>
          <a href="#proprietari">Chi possiede</a>
          <a href="#provincia">La tua provincia</a>
          <a href="#fonti">Fonti</a>
        </nav>
      </header>

      <aside className={styles.note}>
        <strong>Come leggere i numeri</strong>
        IMU e cedolare secca qui sono <em>gettito nazionale</em> pubblicato da AdE (tabella 4.4), non
        l’aliquota del tuo Comune. Stock e utilizzi sono dati catastali/dichiarativi 2023: contano
        immobili, non euro di bilancio.
      </aside>

      <dl className={styles.stats} aria-label="Tre numeri da ricordare">
        <div>
          <dt>Gettito IMU 2024</dt>
          <dd data-testid="ade-imu-2024-mld">{imu2024}</dd>
          <span className={styles.hint}>miliardi di € · Italia intera</span>
        </div>
        <div>
          <dt>Cedolare secca 2024</dt>
          <dd>
            {cedolare2024 !== null && cedolare2024 !== undefined ? moneyMld.format(cedolare2024) : "n.d."}
          </dd>
          <span className={styles.hint}>miliardi di € · quasi il doppio del 2015</span>
        </div>
        <div>
          <dt>Abitazioni principali</dt>
          <dd>{principali ? integer(principali.count) : "n.d."}</dd>
          <span className={styles.hint}>
            unità · {principali?.shareOfTotal !== null && principali?.shareOfTotal !== undefined
              ? pctFormat.format(principali.shareOfTotal)
              : "n.d."}{" "}
            dello stock abitativo 2023
          </span>
        </div>
      </dl>

      <section id="prelievo" className={styles.sectionWide} aria-labelledby="prelievo-title">
        <h2 id="prelievo-title">Quanto si preleva sugli immobili</h2>
        <p>
          Dal 2015 l’IMU resta intorno ai 21 miliardi. La TASI sparisce dopo il 2019 (abolita). La
          cedolare secca, invece, cresce ogni anno: è l’imposta sostitutiva sugli affitti abitativi.
        </p>
        <ul className={styles.takeaways}>
          <li>
            <strong>IMU: stabile</strong>
            Tra 20,3 e 21,2 miliardi dal 2016 al 2024. Non confonderla con «quanto paga il mio
            Comune»: qui manca ancora il dettaglio per comune nelle tabelle API.
          </li>
          <li>
            <strong>Cedolare secca: in salita</strong>
            Da {cedolare2015 !== null && cedolare2015 !== undefined ? moneyMld.format(cedolare2015) : "n.d."}{" "}
            mld (2015) a{" "}
            {cedolare2024 !== null && cedolare2024 !== undefined ? moneyMld.format(cedolare2024) : "n.d."}{" "}
            mld (2024). Segnale di più locazioni tassate in questo regime, non di IMU comunale.
          </li>
          <li>
            <strong>TASI: fuori scena</strong>
            Nei dati AdE dopo il 2019 il valore non è più significativo (abolizione). Nel grafico
            diventa «n.d.».
          </li>
        </ul>
        <PrelievoChart series={prelievoSeries} />
        <p className={styles.datasetLinks}>
          <Link href={`/dati/${ADE_IMMOBILI_PRELIEVO_DATASET}`}>Dataset prelievo 2015–2024 →</Link>
        </p>
      </section>

      <section id="stock" className={styles.sectionWide} aria-labelledby="stock-title">
        <h2 id="stock-title">Come sono usate le abitazioni in Italia</h2>
        <p>
          Open data AdE, anno d’imposta {housing.national.taxYear}. Contiamo le unità nella categoria
          «abitazioni». Sul totale nazionale (
          {housing.national.totalHomes ? integer(housing.national.totalHomes) : "n.d."} immobili PF+PNF)
          la fetta più grande è l’abitazione principale; poi locati e immobili a disposizione.
        </p>
        <HousingBars insight={housing.national} showStack />
        <p className={styles.datasetLinks}>
          <Link href={`/dati/${ADE_IMMOBILI_UTILIZZO_DATASET}`}>Dataset utilizzo per provincia →</Link>
          <Link href="/territori/irpef">Redditi IRPEF per territorio →</Link>
        </p>
      </section>

      <section id="aree" className={styles.sectionWide} aria-labelledby="aree-title" data-testid="macro-aree">
        <h2 id="aree-title">Nord, Centro, Sud: come cambia l’uso</h2>
        <p>
          Immobili di proprietà di <strong>persone fisiche</strong>, anno 2023. Tutti gli usi AdE
          dell’area (quote sul totale unità PF; arrotondamenti AdE a 0,1 pp). In evidenza
          abitazione principale, a disposizione e locati; sotto, pertinenze e residui.
        </p>
        <div className={styles.areaGrid}>
          {tables.macroAreas.map((area) => (
            <article key={area.area} className={styles.areaCard}>
              <h3>{area.area}</h3>
              <ul>
                {area.uses.map((use) => (
                  <li key={use.label} className={use.focus ? undefined : styles.areaUseMuted}>
                    <span>{use.label}</span>
                    <strong>
                      {pctFormat.format(use.share)}
                      <span className={styles.areaCount}>{integer(use.count)}</span>
                    </strong>
                  </li>
                ))}
              </ul>
              <a className={styles.areaSource} href={area.sourceUrl} rel="noreferrer" target="_blank">
                Tabella AdE ↗
              </a>
            </article>
          ))}
        </div>
        <p className={styles.caption}>
          Nel Sud la quota «a disposizione» è più alta (
          {pctFormat.format(
            tables.macroAreas.find((area) => area.area === "Sud")!.uses.find((use) => use.label === "A disposizione")!.share,
          )}
          ); al Nord pesano di più i locati (
          {pctFormat.format(
            tables.macroAreas.find((area) => area.area === "Nord")!.uses.find((use) => use.label === "Locati")!.share,
          )}
          ). Le pertinenze (garage, cantine…) spiegano gran parte del resto, soprattutto al Nord.
        </p>
      </section>

      <section id="valore" className={styles.sectionWide} aria-labelledby="valore-title" data-testid="valore-regioni">
        <h2 id="valore-title">Quanto vale il patrimonio residenziale</h2>
        <p>
          Valore stimato di mercato (VSM) di abitazioni e pertinenze, anno 2023. In Italia fa circa{" "}
          <strong>
            {tables.italyResidentialMld !== null ? `${moneyMld.format(tables.italyResidentialMld)} mld €` : "n.d."}
          </strong>
          {tables.italyResidentialOverGdp !== null
            ? ` — ${moneyMld.format(tables.italyResidentialOverGdp)} volte il PIL 2023`
            : ""}
          . Non è gettito fiscale.
        </p>
        <div className={styles.tableWrap} role="region" aria-label="VSM residenziale per regione">
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th scope="col">Regione</th>
                <th scope="col">VSM residenziale</th>
                <th scope="col">Quota Italia</th>
                <th scope="col">VSM / PIL</th>
              </tr>
            </thead>
            <tbody>
              {tables.regions.map((region) => (
                <tr key={region.region}>
                  <th scope="row">{region.region}</th>
                  <td>{moneyMld.format(region.residentialMld)} mld €</td>
                  <td>{pctFormat.format(region.territorialShare)}</td>
                  <td>{moneyMld.format(region.residentialOverGdp)}×</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.datasetLinks}>
          <a href={tables.sources.regions} rel="noreferrer" target="_blank">
            Fonte tabella 2026_02_01_03 ↗
          </a>
        </p>
      </section>

      <section id="proprietari" className={styles.sectionWide} aria-labelledby="proprietari-title" data-testid="proprietari">
        <h2 id="proprietari-title">Chi possiede (e con quale reddito)</h2>
        <p>
          Tra i contribuenti, la quota di chi risulta proprietario di immobili sale con il reddito
          complessivo. Sotto: classi di reddito e, a parte, i proprietari di abitazioni per tipo di
          reddito prevalente (con VSM medio).
        </p>
        <h3 className={styles.subhead}>Tasso di proprietà per classe di reddito</h3>
        <div className={styles.bars} role="list" aria-label="Proprietà per classe di reddito">
          {tables.incomeClasses.map((row) => (
            <div key={row.label} className={styles.barRow} role="listitem">
              <div className={styles.barLabel}>
                <strong>{row.label}</strong>
                <span className={styles.barMeta}>
                  {pctFormat.format(row.ownershipRate)} proprietari · {integer(row.owners)} su{" "}
                  {integer(row.taxpayers)}
                </span>
              </div>
              <div className={styles.track} aria-hidden="true">
                <div className={styles.fill} style={{ width: `${Math.max(2, row.ownershipRate * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
        <h3 className={styles.subhead}>Proprietari di abitazioni per reddito prevalente</h3>
        <div className={styles.tableWrap} role="region" aria-label="Proprietari per tipo di reddito">
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th scope="col">Reddito prevalente</th>
                <th scope="col">Proprietari</th>
                <th scope="col">Reddito medio</th>
                <th scope="col">VSM medio (stima mercato)</th>
              </tr>
            </thead>
            <tbody>
              {tables.incomeTypes.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{integer(row.owners)}</td>
                  <td>{euroFormat.format(row.meanIncome)}</td>
                  <td>{euroFormat.format(row.meanVsm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.caption}>
          Chi ha reddito prevalente da fabbricati è pochi proprietari ma con VSM medio più alto (
          {euroFormat.format(tables.incomeTypes.find((row) => row.label === "Fabbricati")?.meanVsm ?? 0)}
          ): profilo diverso da dipendenti e pensionati, non un «ricchi vs poveri» automatico.
        </p>
        <p className={styles.datasetLinks}>
          <a href={tables.sources.incomeClasses} rel="noreferrer" target="_blank">
            Classi di reddito ↗
          </a>
          <a href={tables.sources.incomeTypes} rel="noreferrer" target="_blank">
            Reddito prevalente ↗
          </a>
        </p>
      </section>

      <section id="provincia" className={styles.sectionWide} aria-labelledby="provincia-title">
        <h2 id="provincia-title">Confronta con una provincia</h2>
        <p>
          Stessi indicatori, stessa fonte. Scegli una sigla catastale: a sinistra resta l’Italia, a
          destra la provincia. Le percentuali sono sul totale abitazioni di quel territorio.
        </p>
        <form action="/analisi/immobili-italia-2026#provincia" method="get" className={styles.provinceForm}>
          <label htmlFor="prov">
            Provincia
            <select className="input" id="prov" name="prov" defaultValue={housing.requestedProvince ?? ""}>
              <option value="">Scegli…</option>
              {housing.provinces.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" type="submit">
            Mostra
          </button>
          {housing.requestedProvince ? (
            <Link className="btn btn-secondary" href="/analisi/immobili-italia-2026#provincia">
              Solo Italia
            </Link>
          ) : null}
        </form>

        {housing.requestedProvince && !housing.selectedProvince ? (
          <p role="alert" className="notice">
            Sigla «{housing.requestedProvince}» non presente nell’open data AdE di questa edizione.
          </p>
        ) : null}

        <div className={styles.compare}>
          <div>
            <h3>Italia</h3>
            <p className={styles.compareLead}>
              {housing.national.totalHomes
                ? `${integer(housing.national.totalHomes)} abitazioni (PF+PNF)`
                : "Totale non disponibile"}
            </p>
            <HousingBars insight={housing.national} muted={Boolean(housing.selectedProvince)} />
          </div>
          {housing.selectedProvince ? (
            <div data-testid="utilizzo-status">
              <h3>{housing.selectedProvince.territoryLabel}</h3>
              <p className={styles.compareLead}>
                {housing.selectedProvince.totalHomes
                  ? `${integer(housing.selectedProvince.totalHomes)} abitazioni (PF+PNF)`
                  : "Totale non disponibile"}
              </p>
              <HousingBars insight={housing.selectedProvince} />
            </div>
          ) : (
            <div>
              <h3>Provincia</h3>
              <p className={styles.compareLead}>
                Seleziona una sigla per vedere lo stesso schema sul territorio. Es. RM, MI, NA, TO.
              </p>
            </div>
          )}
        </div>
      </section>

      <aside className={styles.missing} aria-labelledby="missing-title">
        <h2 id="missing-title">Cosa non c’è (ancora) in questa pagina</h2>
        <p>
          Il capitolo AdE sulle <strong>aliquote IMU per Comune</strong> e i margini di manovra non
          è nelle tabelle/API scaricabili di questa edizione ({integer(analysis.coverage.tablesMissingViaApi.length)}{" "}
          tabelle rispondono <code>null</code>). Non inventiamo aliquote: quando saranno negli open
          data, entreranno qui e nelle schede Comune.
        </p>
      </aside>

      <section id="fonti" className={styles.sources} aria-labelledby="fonti-title">
        <h2 id="fonti-title">Fonti e licenza</h2>
        <p>
          Anno d’imposta <strong>{analysis.coverage.taxYear}</strong> per stock e utilizzi; serie di
          prelievo fino al <strong>2024</strong>. Licenza CC BY 3.0 IT · © Agenzia delle Entrate /
          MEF.
        </p>
        <ul>
          <li>
            <a href={ADE_IMMOBILI_LANDING}>Portale AdE · Gli immobili in Italia 2026</a>
          </li>
          <li>
            <a href={analysis.sources.openDataPortalUrl}>Portale open data MEF/AdE</a>
          </li>
          <li>
            <a href={ADE_IMMOBILI_OPEN_DATA_ZIP}>Archivio open data (ZIP)</a>
          </li>
          <li>
            <a href={analysis.sources.volumePdfUrl}>Volume PDF 2026</a>
          </li>
          <li>
            <a href={analysis.sources.licenseUrl}>Licenza CC BY 3.0 IT</a>
          </li>
        </ul>
        <p className={styles.datasetLinks}>
          <Link href={`/dati/${ADE_IMMOBILI_PRELIEVO_DATASET}`}>Prelievo</Link>
          <Link href={`/dati/${ADE_IMMOBILI_UTILIZZO_DATASET}`}>Utilizzo province</Link>
          <Link href={`/dati/${ADE_IMMOBILI_TABELLE_DATASET}`}>Celle tabelle API</Link>
        </p>
        <details>
          <summary>Avvertenze tecniche</summary>
          <ul>
            {analysis.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </details>
      </section>
    </main>
  );
}
