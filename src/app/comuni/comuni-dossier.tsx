import type { CSSProperties } from "react";
import { compactEuro, integer, longDate, percent } from "@/lib/format";
import { footprintStatusLabel, type ComuniFootprint } from "@/lib/comuni-footprint";
import type { ReportedMeasure } from "@/lib/mef-irpef-snapshot";
import { schoolServicesSource } from "@/lib/municipality-school-services";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { ChangeComuneButton } from "./change-comune-button";
import { ComuniRadar } from "./comuni-radar";
import styles from "./comuni.module.css";

function monthName(month: number): string {
  return new Intl.DateTimeFormat("it-IT", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, month - 1, 1)),
  );
}

function periodLabel(footprint: ComuniFootprint): string {
  if (footprint.completeness === "partial") {
    const name = monthName(footprint.latestMonth);
    return `Da gennaio ${/^[aeiou]/i.test(name) ? "ad" : "a"} ${name} ${footprint.year}`;
  }
  return `Anno ${footprint.year}`;
}

function statusClass(index: number | null): string {
  const label = footprintStatusLabel(index);
  if (label === "Molto più alti" || label === "Molto più bassi") return styles.statusFar;
  if (label === "Più alti" || label === "Più bassi") return styles.statusAway;
  if (label === "In linea") return styles.statusNear;
  return styles.statusMissing;
}

function measureAmount(measure: ReportedMeasure): number {
  return measure.coverage === "complete" ? measure.amountCents : measure.knownAmountCents;
}

function measureCoverageNote(measure: ReportedMeasure): string | null {
  return measure.coverage === "partial" ? "subtotale noto; alcune celle sono soppresse" : null;
}

function signedEuro(cents: number): string {
  if (cents === 0) return "In linea con la spesa standard";
  return `${compactEuro(Math.abs(cents) / 100)} ${cents > 0 ? "in più" : "in meno"}`;
}

function openCivitasLevelGuide(level: number | null, kind: "spending" | "services"): string {
  if (level === null) {
    return kind === "spending"
      ? "Livello di spesa non pubblicato dalla fonte per questo Comune."
      : "Livello dei servizi non pubblicato dalla fonte per questo Comune.";
  }
  const band = level <= 5 ? "nella metà bassa" : "nella metà alta";
  if (kind === "spending") {
    return `Scala OpenCivitas da 0 a 10: ${level} è ${band}. Non è un voto e non dimostra da solo spreco o virtù.`;
  }
  return `Scala OpenCivitas da 0 a 10: ${level} è ${band}. Misura un indicatore pubblicato, non la qualità percepita dei servizi.`;
}

function servicesComparison(basisPoints: number): string {
  if (basisPoints === 0) return "In linea con Comuni simili";
  return `${percent(Math.abs(basisPoints) / 100)} ${basisPoints > 0 ? "in più" : "in meno"}`;
}

const DOMAIN_LINKS = [
  { href: "#dossier-pagamenti", label: "Pagamenti" },
  { href: "#dossier-opencivitas", label: "OpenCivitas" },
  { href: "#dossier-irpef", label: "IRPEF" },
  { href: "#dossier-anac", label: "Appalti" },
  { href: "#dossier-scuole", label: "Scuole" },
  { href: "#dossier-pnrr", label: "PNRR" },
] as const;

/** CSS conic-gradient segments for the spending mix ring. */
function spendingMixStyle(shares: readonly number[]): CSSProperties {
  if (shares.length === 0 || shares.every((share) => share <= 0)) {
    return { background: "var(--chart-data-track)" };
  }
  const palette = [
    "var(--chart-data-primary)",
    "var(--color-accent-800)",
    "var(--color-neutral-700)",
    "var(--color-neutral-500)",
    "var(--color-neutral-400)",
    "var(--color-neutral-300)",
  ];
  let cursor = 0;
  const stops: string[] = [];
  for (const [index, share] of shares.entries()) {
    const next = cursor + Math.max(0, Math.min(100, share));
    stops.push(`${palette[index % palette.length]} ${cursor}% ${next}%`);
    cursor = next;
  }
  if (cursor < 100) stops.push(`var(--chart-data-track) ${cursor}% 100%`);
  return { background: `conic-gradient(from -90deg, ${stops.join(", ")})` };
}

export function ComuniDossier({ footprint }: { footprint: ComuniFootprint }) {
  const peer = footprint.peer;
  const openCivitas = footprint.openCivitas.status === "available" ? footprint.openCivitas.data : null;
  const irpef = footprint.irpef.status === "available" ? footprint.irpef.data : null;
  const schools = footprint.schoolServices.status === "available" ? footprint.schoolServices.data : null;
  const pnrrChildcare = footprint.pnrrChildcare.data;
  const pnrr = footprint.pnrr;
  const anac = footprint.anac;
  const incomeBands = footprint.irpefIncomeBands;
  const incomeBandMax = Math.max(1, ...(incomeBands ?? []).map((band) => band.frequency ?? 0));
  const trendMax = Math.max(1, ...footprint.trend.map((row) => row.totalCents ?? 0));
  const openCivitasMax = openCivitas
    ? Math.max(openCivitas.record.historicalSpendingCents, openCivitas.record.standardSpendingCents, 1)
    : 1;
  const openCivitasPerCapitaMax = openCivitas
    ? Math.max(
      openCivitas.record.historicalPerCapitaCents,
      openCivitas.record.standardPerCapitaCents,
      1,
    )
    : 1;
  const spendingShares = footprint.spendingRows.map((row) =>
    footprint.totalCents && footprint.totalCents > 0
      ? (row.amountCents / footprint.totalCents) * 100
      : 0,
  );
  const hasPeerMedian = Boolean(
    peer && footprint.indicators.some((item) => item.id !== "opencivitas-vs-standard" && item.index !== null),
  );
  const placeParts = [footprint.displayName];
  if (footprint.province && footprint.province.toLocaleLowerCase("it-IT") !== footprint.displayName.toLocaleLowerCase("it-IT")) {
    placeParts.push(footprint.province);
  }
  if (footprint.region?.trim()) placeParts.push(footprint.region.trim());
  const place = placeParts.join(" · ");
  const istatCode = openCivitas?.record.istatCode
    ?? (irpef?.record.territory.level === "municipality" ? irpef.record.territory.code : null);
  const cadastralCode = irpef?.record.territory.level === "municipality"
    ? irpef.record.territory.cadastralCode
    : null;

  return (
    <div className={styles.dossierShell}>
      <header className={styles.pageHead}>
        <div className={styles.pageHeadText}>
          <p className={styles.kicker}>Comuni · confronto SIOPE</p>
          <h1 id="comuni-dossier-title" className={styles.pageTitle}>{footprint.displayName}</h1>
          <p className={styles.pageMeta}>
            {place}
            {footprint.population === null ? "" : ` · ${integer(footprint.population)} abitanti`}
            {" · "}
            {periodLabel(footprint)}
            {footprint.completeness === "partial" ? " (parziale)" : ""}
          </p>
          <ul className={styles.idCodes} aria-label="Identificativi ufficiali">
            <li>
              <span>IPA</span>
              <strong>{footprint.codiceIpa}</strong>
            </li>
            <li>
              <span>CF ente</span>
              <strong>{footprint.taxCode}</strong>
            </li>
            {istatCode ? (
              <li>
                <span>ISTAT</span>
                <strong>{istatCode}</strong>
              </li>
            ) : null}
            {cadastralCode ? (
              <li>
                <span>Catastale</span>
                <strong>{cadastralCode}</strong>
              </li>
            ) : null}
          </ul>
        </div>
        <div className={styles.headActions}>
          <a className={styles.textLink} href={`${PUBLIC_SITE_URL}${footprint.entityHref}`}>
            Scheda ente
          </a>
          <ChangeComuneButton />
        </div>
      </header>

      <nav className={styles.domainNav} aria-label="Sezioni del dossier">
        {DOMAIN_LINKS.map((link) => (
          <a key={link.href} href={link.href}>{link.label}</a>
        ))}
      </nav>

      <section className={styles.radarHero} aria-labelledby="comuni-dossier-title">
        <p className={styles.radarHeroKicker}>
          Impronta vs mediana dei pari (= 100)
          {peer ? ` · ${peer.peers} enti confrontabili` : ""}
        </p>
        <ComuniRadar
          indicators={footprint.indicators}
          municipalityLabel={footprint.displayName}
          hasPeerMedian={hasPeerMedian}
        />
        <p className={styles.readingGuide}>
          Non è un voto né un rischio: solo distanza dal gruppo
          {peer ? ` (${peer.criteria.join(", ")})` : ""}.
          Due numeri su ogni punta: <strong>questo Comune</strong>
          {" · "}
          <strong>{hasPeerMedian ? "mediana" : "riferimento"}</strong>.
        </p>
      </section>

      <dl className={styles.heroMetrics} aria-label="Sintesi dei flussi">
        <div>
          <dt>Pagato</dt>
          <dd>{footprint.totalCents === null ? "n.d." : compactEuro(footprint.totalCents / 100)}</dd>
          <small>{periodLabel(footprint)}</small>
        </div>
        <div>
          <dt>Incassato</dt>
          <dd>
            {footprint.receiptsTotalCents === null
              ? "n.d."
              : compactEuro(footprint.receiptsTotalCents / 100)}
          </dd>
          <small>
            {footprint.receiptsPerCapitaCents === null
              ? "Incassi SIOPE"
              : `${integer(Math.round(footprint.receiptsPerCapitaCents / 100))} € / ab.`}
          </small>
        </div>
        <div>
          <dt>Per abitante</dt>
          <dd>
            {footprint.perCapitaCents === null
              ? "n.d."
              : `${integer(Math.round(footprint.perCapitaCents / 100))} €`}
          </dd>
          <small>Pagamenti di cassa</small>
        </div>
        <div>
          <dt>Per km²</dt>
          <dd>
            {footprint.perSquareKmCents === null
              ? "n.d."
              : compactEuro(footprint.perSquareKmCents / 100)}
          </dd>
          <small>Superficie ISTAT</small>
        </div>
        {openCivitas ? (
          <div>
            <dt>Vs standard</dt>
            <dd>{signedEuro(openCivitas.record.differenceCents)}</dd>
            <small>OpenCivitas {openCivitas.referenceYear}</small>
          </div>
        ) : null}
        {schools ? (
          <div>
            <dt>Sedi scolastiche</dt>
            <dd>{integer(schools.schoolSites)}</dd>
            <small>MIM · a.s. {schools.schoolYear}</small>
          </div>
        ) : null}
        <div>
          <dt>PNRR sul territorio</dt>
          <dd>
            {pnrr.localizedRegistrations === null
              ? "n.d."
              : integer(pnrr.localizedRegistrations)}
          </dd>
          <small>Registrazioni ReGiS localizzate</small>
        </div>
        {anac.status === "available" ? (
          <div>
            <dt>Appalti ANAC</dt>
            <dd>{integer(anac.awardCount)}</dd>
            <small>{anac.awardValueLabel}</small>
          </div>
        ) : null}
      </dl>

      <section className={styles.axisGlossary} aria-labelledby="assi-title">
        <div className={styles.axisGlossaryHead}>
          <h2 id="assi-title" className={styles.sectionLabel}>
            Cosa misurano gli assi
          </h2>
          <p className={styles.axisGlossaryHint}>
            Indice &gt; 100 = sopra la mediana; &lt; 100 = sotto.
            I numeri 1-{footprint.indicators.length} coincidono con il grafico.
          </p>
        </div>
        <ol className={styles.indicatorList}>
          {footprint.indicators.map((item, index) => (
            <li key={item.id} className={styles.indicatorRow} id={`asse-${index + 1}`}>
              <div className={styles.indicatorHead}>
                <span className={styles.indicatorIndex} aria-hidden="true">{index + 1}</span>
                <div className={styles.indicatorTitle}>
                  <strong>{item.label}</strong>
                  {item.index !== null ? (
                    <span className={styles.indexValue}>indice {item.index}</span>
                  ) : null}
                </div>
                <span className={`${styles.statusTag} ${statusClass(item.index)}`}>
                  {footprintStatusLabel(item.index)}
                </span>
              </div>
              <p className={styles.indicatorValues}>
                <span className={styles.valueThis}>{item.valueLabel}</span>
                {item.medianLabel ? (
                  <>
                    <span className={styles.valueSep} aria-hidden="true"> · </span>
                    <span className={styles.valuePeer}>
                      {item.id === "opencivitas-vs-standard" ? "standard " : "mediana "}
                      {item.medianLabel}
                    </span>
                  </>
                ) : null}
              </p>
              <p className={styles.indicatorMeaning}>{item.meaning}</p>
              {item.note ? <p className={styles.indicatorNote}>{item.note}</p> : null}
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.deepDossier} aria-labelledby="dossier-deep-title">
        <h2 id="dossier-deep-title" className={styles.sectionTitle}>Dettaglio per fonte</h2>

        <div className={styles.dossierGrid} id="dossier-pagamenti">
          <section className={styles.panel} aria-labelledby="voci-title">
            <h3 id="voci-title">Voci di pagamento</h3>
            <div className={styles.mixLayout}>
              <div
                className={styles.mixRing}
                style={spendingMixStyle(spendingShares)}
                aria-hidden="true"
              >
                <span className={styles.mixRingHole}>
                  {footprint.totalCents === null ? "n.d." : compactEuro(footprint.totalCents / 100)}
                </span>
              </div>
              <ul className={styles.spendingList}>
                {footprint.spendingRows.map((row, index) => {
                  const share = spendingShares[index] ?? 0;
                  return (
                    <li key={row.key}>
                      <div className={styles.spendingRow}>
                        <strong>
                          <span className={styles.mixSwatch} data-tone={index % 6} aria-hidden="true" />
                          {row.label}
                        </strong>
                        <span>
                          {compactEuro(row.amountCents / 100)}
                          {share > 0 ? ` · ${percent(share)}` : ""}
                        </span>
                      </div>
                      <div
                        className={styles.spendingBar}
                        style={{ "--share": `${Math.min(100, share)}%` } as CSSProperties}
                        aria-hidden="true"
                      />
                      <p>{row.explanation}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="trend-title">
            <h3 id="trend-title">Andamento recente</h3>
            <ul
              className={styles.trendColumns}
              aria-label="Pagamenti comunali per anno"
            >
              {footprint.trend.map((row) => {
                const height = row.totalCents === null ? 0 : (row.totalCents / trendMax) * 100;
                return (
                  <li key={row.year}>
                    <strong>{row.year}</strong>
                    <b>{row.totalCents === null ? "n.d." : compactEuro(row.totalCents / 100)}</b>
                    <span className={styles.trendPlot} aria-hidden="true">
                      <span
                        className={
                          row.totalCents === null || row.totalCents === 0
                            ? styles.trendColEmpty
                            : row.completeness === "partial"
                              ? styles.trendColPartial
                              : styles.trendColComplete
                        }
                        style={{ "--bar-height": `${height}%` } as CSSProperties}
                      />
                    </span>
                    <small>
                      {row.completeness === "partial" ? "Parziale" : "Completo"}
                      {row.perCapitaCents === null
                        ? ""
                        : ` · ${integer(Math.round(row.perCapitaCents / 100))} €/ab.`}
                    </small>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <section className={styles.panel} id="dossier-opencivitas" aria-labelledby="opencivitas-title">
          <div className={styles.panelHead}>
            <h3 id="opencivitas-title">OpenCivitas · spesa e servizi</h3>
            {openCivitas ? <span className={styles.panelTag}>{openCivitas.referenceYear}</span> : null}
          </div>
          {openCivitas ? (
            <>
              <p className={styles.panelLead}>
                Confronto tra spesa storica e fabbisogno standard. Una differenza in più o in meno
                non dimostra spreco: va letta con servizi e contesto locale.
              </p>
              <ul
                className={styles.benchmarkChart}
                aria-label={`Spesa storica e standard ${openCivitas.referenceYear}`}
              >
                {[
                  {
                    amountCents: openCivitas.record.historicalSpendingCents,
                    key: "historical",
                    label: "Spesa registrata",
                    tone: "historical" as const,
                  },
                  {
                    amountCents: openCivitas.record.standardSpendingCents,
                    key: "standard",
                    label: "Valore di riferimento",
                    tone: "standard" as const,
                  },
                ].map((row) => (
                  <li key={row.key}>
                    <strong>{row.label}</strong>
                    <span className={styles.benchmarkTrack} aria-hidden="true">
                      <span
                        className={row.tone === "historical" ? styles.benchmarkHistorical : styles.benchmarkStandard}
                        style={{ "--share": `${(row.amountCents / openCivitasMax) * 100}%` } as CSSProperties}
                      />
                    </span>
                    <b>{compactEuro(row.amountCents / 100)}</b>
                  </li>
                ))}
              </ul>
              <ul
                className={styles.benchmarkChart}
                aria-label={`Spesa per abitante storica e standard ${openCivitas.referenceYear}`}
              >
                {[
                  {
                    amountCents: openCivitas.record.historicalPerCapitaCents,
                    key: "historical-pc",
                    label: "Per abitante · registrata",
                    tone: "historical" as const,
                  },
                  {
                    amountCents: openCivitas.record.standardPerCapitaCents,
                    key: "standard-pc",
                    label: "Per abitante · riferimento",
                    tone: "standard" as const,
                  },
                ].map((row) => (
                  <li key={row.key}>
                    <strong>{row.label}</strong>
                    <span className={styles.benchmarkTrack} aria-hidden="true">
                      <span
                        className={row.tone === "historical" ? styles.benchmarkHistorical : styles.benchmarkStandard}
                        style={{ "--share": `${(row.amountCents / openCivitasPerCapitaMax) * 100}%` } as CSSProperties}
                      />
                    </span>
                    <b>{`${integer(Math.round(row.amountCents / 100))} €`}</b>
                  </li>
                ))}
              </ul>
              <dl className={styles.factGrid}>
                <div>
                  <dt>Differenza vs standard</dt>
                  <dd>{signedEuro(openCivitas.record.differenceCents)}</dd>
                  <small>
                    {openCivitas.record.differencePerCapitaCents === 0
                      ? "Nessuno scostamento per abitante"
                      : `${integer(Math.round(Math.abs(openCivitas.record.differencePerCapitaCents) / 100))} € ${openCivitas.record.differencePerCapitaCents > 0 ? "in più" : "in meno"} / ab.`}
                  </small>
                </div>
                <div>
                  <dt>Servizi vs simili</dt>
                  <dd>
                    {openCivitas.record.serviceDifferenceBasisPoints === null
                      ? "Non valutabile"
                      : servicesComparison(openCivitas.record.serviceDifferenceBasisPoints)}
                  </dd>
                  <small>{openCivitas.methodology.serviceMeaning}</small>
                </div>
              </dl>
              <div className={styles.levelRow} aria-label="Livelli OpenCivitas">
                {[
                  {
                    key: "spending",
                    label: "Livello spesa",
                    level: openCivitas.record.spendingLevel,
                    guide: openCivitasLevelGuide(openCivitas.record.spendingLevel, "spending"),
                  },
                  {
                    key: "services",
                    label: "Livello servizi",
                    level: openCivitas.record.serviceLevel,
                    guide: openCivitasLevelGuide(openCivitas.record.serviceLevel, "services"),
                  },
                ].map((item) => (
                  <div key={item.key} className={styles.levelCard}>
                    <div className={styles.levelHead}>
                      <strong>{item.label}</strong>
                      <span>{item.level === null ? "n.d." : `${item.level} / 10`}</span>
                    </div>
                    <div className={styles.levelTrack} aria-hidden="true">
                      <span
                        style={{
                          "--share": `${item.level === null ? 0 : (item.level / 10) * 100}%`,
                        } as CSSProperties}
                      />
                    </div>
                    <p>{item.guide}</p>
                  </div>
                ))}
              </div>
              <p className={styles.sourceInline}>
                Fonte:{" "}
                <a href={openCivitas.source.datasetUrl} target="_blank" rel="noopener noreferrer">
                  OpenCivitas ↗
                </a>
                . {openCivitas.methodology.rankingWarning}
              </p>
            </>
          ) : (
            <p className={styles.emptyNote}>
              {footprint.openCivitas.status === "available" ? null : footprint.openCivitas.message}
            </p>
          )}
        </section>

        <div className={styles.dossierGrid}>
          <section className={styles.panel} id="dossier-irpef" aria-labelledby="irpef-title">
            <div className={styles.panelHead}>
              <h3 id="irpef-title">IRPEF comunale</h3>
              {irpef ? <span className={styles.panelTag}>Anno {irpef.period.taxYear}</span> : null}
            </div>
            {irpef ? (
              <>
                <p className={styles.panelLead}>
                  Dichiarazioni IRPEF collegabili a questo Comune nel rilascio MEF.
                  Non è reddito medio individuale né capacità fiscale effettiva.
                </p>
                <dl className={styles.factGrid}>
                  <div>
                    <dt>Contribuenti</dt>
                    <dd>{integer(irpef.record.taxpayers)}</dd>
                  </div>
                  <div>
                    <dt>Reddito complessivo</dt>
                    <dd>{compactEuro(measureAmount(irpef.record.measures.comprehensiveIncome) / 100)}</dd>
                    {measureCoverageNote(irpef.record.measures.comprehensiveIncome) ? (
                      <small>{measureCoverageNote(irpef.record.measures.comprehensiveIncome)}</small>
                    ) : null}
                  </div>
                  <div>
                    <dt>Reddito imponibile</dt>
                    <dd>{compactEuro(measureAmount(irpef.record.measures.taxableIncome) / 100)}</dd>
                    {measureCoverageNote(irpef.record.measures.taxableIncome) ? (
                      <small>{measureCoverageNote(irpef.record.measures.taxableIncome)}</small>
                    ) : null}
                  </div>
                  <div>
                    <dt>Imposta netta</dt>
                    <dd>{compactEuro(measureAmount(irpef.record.measures.netTaxDeclared) / 100)}</dd>
                    {measureCoverageNote(irpef.record.measures.netTaxDeclared) ? (
                      <small>{measureCoverageNote(irpef.record.measures.netTaxDeclared)}</small>
                    ) : null}
                  </div>
                  <div>
                    <dt>Addizionale regionale</dt>
                    <dd>{compactEuro(measureAmount(irpef.record.measures.regionalSurtaxDue) / 100)}</dd>
                  </div>
                  <div>
                    <dt>Addizionale comunale</dt>
                    <dd>{compactEuro(measureAmount(irpef.record.measures.municipalSurtaxDue) / 100)}</dd>
                  </div>
                </dl>
                {incomeBands && incomeBands.some((band) => band.frequency !== null) ? (
                  <>
                    <h4 className={styles.panelSubhead}>Contribuenti per fascia di reddito complessivo</h4>
                    <ul
                      className={styles.bandChart}
                      aria-label="Distribuzione dei contribuenti per fascia di reddito IRPEF"
                    >
                      {incomeBands.map((band) => {
                        const share = band.frequency === null
                          ? 0
                          : (band.frequency / incomeBandMax) * 100;
                        return (
                          <li key={band.key}>
                            <strong>{band.label}</strong>
                            <span className={styles.bandTrack} aria-hidden="true">
                              <span style={{ "--share": `${share}%` } as CSSProperties} />
                            </span>
                            <b>
                              {band.frequency === null ? "n.d." : integer(band.frequency)}
                              {band.coverage === "partial" ? "*" : ""}
                            </b>
                          </li>
                        );
                      })}
                    </ul>
                    {incomeBands.some((band) => band.coverage === "partial") ? (
                      <p className={styles.sourceInline}>
                        * Subtotale noto: alcune celle della fascia sono soppresse dalla fonte.
                      </p>
                    ) : null}
                  </>
                ) : null}
                <p className={styles.sourceInline}>
                  Fonte:{" "}
                  <a href={irpef.source.landingUrl} target="_blank" rel="noopener noreferrer">
                    Dipartimento delle Finanze ↗
                  </a>
                  .
                </p>
              </>
            ) : (
              <p className={styles.emptyNote}>
                {footprint.irpef.status === "available" ? null : footprint.irpef.message}
              </p>
            )}
          </section>

          <section className={styles.panel} id="dossier-scuole" aria-labelledby="scuole-title">
            <div className={styles.panelHead}>
              <h3 id="scuole-title">Scuole statali</h3>
              <span className={styles.panelTag}>a.s. {schoolServicesSource.schoolYear}</span>
            </div>
            {schools ? (
              <>
                <p className={styles.panelLead}>
                  Sedi censite nell’anagrafe MIM al {longDate(schoolServicesSource.dataAsOf)}.
                  Conta la presenza nel file, non qualità didattica né posti disponibili.
                </p>
                <p className={styles.extraValue}>{integer(schools.schoolSites)}</p>
                <p>
                  Codici scuola indicati come sedi
                  {schools.otherRegistryCodes > 0
                    ? ` · altri ${integer(schools.otherRegistryCodes)} codici anagrafe`
                    : ""}.
                </p>
                <p className={styles.sourceInline}>
                  Fonte:{" "}
                  <a href={schoolServicesSource.landingUrl} target="_blank" rel="noopener noreferrer">
                    MIM · anagrafe scuole statali ↗
                  </a>
                  . Fuori perimetro: paritarie, nidi e altre strutture.
                </p>
              </>
            ) : (
              <p className={styles.emptyNote}>
                {footprint.schoolServices.status === "available"
                  ? null
                  : footprint.schoolServices.message}
              </p>
            )}
          </section>
        </div>

        <section className={styles.panel} id="dossier-anac" aria-labelledby="anac-title">
          <div className={styles.panelHead}>
            <h3 id="anac-title">Appalti ANAC</h3>
            {anac.status === "available" ? (
              <span className={styles.panelTag}>al {longDate(anac.observedAt)}</span>
            ) : null}
          </div>
          {anac.status === "available" ? (
            <>
              <p className={styles.panelLead}>
                Profilo di aggiudicazioni pubblicato per questo ente IPA.
                Non è una classifica di rischio né una misura di efficienza.
              </p>
              <dl className={styles.factGrid}>
                <div>
                  <dt>Procedure</dt>
                  <dd>{integer(anac.procedureCount)}</dd>
                </div>
                <div>
                  <dt>Aggiudicazioni</dt>
                  <dd>{integer(anac.awardCount)}</dd>
                </div>
                <div>
                  <dt>Valore aggiudicato</dt>
                  <dd>{anac.awardValueLabel}</dd>
                </div>
                <div>
                  <dt>Operatori distinti</dt>
                  <dd>{integer(anac.awardeeCount)}</dd>
                </div>
              </dl>
              {anac.topOperators.length > 0 ? (
                <ul className={styles.projectList} aria-label="Operatori più frequenti">
                  {anac.topOperators.map((operator) => (
                    <li key={operator.ref}>
                      <a href={`${PUBLIC_SITE_URL}/appalti/operatori/${encodeURIComponent(operator.ref)}`}>
                        {operator.name}
                      </a>
                      <span>
                        {integer(operator.awardCount)}{" "}
                        {operator.awardCount === 1 ? "aggiudicazione" : "aggiudicazioni"}
                        {operator.attributedValueLabel === "n.d."
                          ? ""
                          : ` · ${operator.attributedValueLabel}`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className={styles.sourceInline}>
                <a href={`${PUBLIC_SITE_URL}${anac.appaltiHref}`}>Apri il dettaglio appalti dell’ente ↗</a>
              </p>
            </>
          ) : (
            <p className={styles.emptyNote}>{anac.message}</p>
          )}
        </section>

        <section className={styles.panel} id="dossier-pnrr" aria-labelledby="pnrr-title">
          <div className={styles.panelHead}>
            <h3 id="pnrr-title">PNRR · catalogo ReGiS</h3>
            <span className={styles.panelTag}>al {longDate(pnrr.referenceDate)}</span>
          </div>
          <p className={styles.panelLead}>
            {pnrr.methodologyNote} Il finanziamento pubblicato non è necessariamente denaro già pagato.
          </p>
          <dl className={styles.factGrid}>
            <div>
              <dt>Registrazioni localizzate</dt>
              <dd>
                {pnrr.localizedRegistrations === null
                  ? "n.d."
                  : integer(pnrr.localizedRegistrations)}
              </dd>
              <small>Per codice ISTAT del Comune</small>
            </div>
            <div>
              <dt>Come soggetto attuatore</dt>
              <dd>{integer(pnrr.implementerRegistrations ?? 0)}</dd>
              <small>Per CF ente</small>
            </div>
            <div>
              <dt>Asili (verticale)</dt>
              <dd>{integer(pnrrChildcare.totalProjects)}</dd>
              <small>
                {pnrrChildcare.knownTotalFundingCents > 0
                  ? compactEuro(pnrrChildcare.knownTotalFundingCents / 100)
                  : pnrrChildcare.submeasure.code}
              </small>
            </div>
          </dl>
          {(pnrr.localizedRegistrations ?? 0) > 0 || (pnrr.implementerRegistrations ?? 0) > 0 ? (
            <p className={styles.sourceInline}>
              <a href={`${PUBLIC_SITE_URL}${pnrr.projectsHref}`}>
                Apri l&apos;elenco progetti PNRR filtrato ↗
              </a>
            </p>
          ) : (
            <p className={styles.emptyNote}>
              Nessuna registrazione PNRR localizzata su questo codice ISTAT nel catalogo pubblicato.
            </p>
          )}
          {pnrrChildcare.projects.length > 0 ? (
            <>
              <h4 className={styles.panelSubhead}>Asili e prima infanzia (slice tipizzato)</h4>
              <ul className={styles.projectList}>
                {pnrrChildcare.projects.map((project) => (
                  <li key={project.cup}>
                    <a href={`${PUBLIC_SITE_URL}/progetti/${encodeURIComponent(project.cup)}`}>
                      {project.title}
                    </a>
                    <span>
                      CUP {project.cup}
                      {project.phase ? ` · ${project.phase}` : ""}
                      {project.progress ? ` · ${project.progress}` : ""}
                      {project.totalFundingCents === null
                        ? ""
                        : ` · ${compactEuro(project.totalFundingCents / 100)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className={styles.sourceInline}>
            Fonti: Italia Domani / ReGiS
            {pnrrChildcare.source.landingUrl ? (
              <>
                {" · "}
                <a href={pnrrChildcare.source.landingUrl} target="_blank" rel="noopener noreferrer">
                  verticale asili ↗
                </a>
              </>
            ) : null}
            .
          </p>
        </section>

        <details className={styles.sourcesDetails}>
          <summary>Fonti e limiti</summary>
          <div>
            <p>{footprint.methodology.measure}. {footprint.methodology.warning}</p>
            <ul>
              {footprint.sources.map((source) => (
                <li key={`${source.year}-${source.url}`}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    SIOPE {source.year}
                  </a>
                  {" · osservato il "}
                  {longDate(source.observedAt)}
                </li>
              ))}
            </ul>
            <p>
              Indice 100 = mediana dei pari, oppure spesa standard OpenCivitas. Autonomia, FCDE e
              rigidità di bilancio non sono calcolate qui: richiedono fonti BDAP di competenza.
              Cruscotto Italia (AGID) è un riferimento di densità informativa, non una fonte di dati
              di questa pagina.
            </p>
          </div>
        </details>
      </section>
    </div>
  );
}
