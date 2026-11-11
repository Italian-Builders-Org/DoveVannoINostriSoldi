import type { ReactNode } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, Building04Icon, Building03Icon, School01Icon } from "@hugeicons/core-free-icons";
import { ITALY_REGIONS_VIEWBOX, italyRegionGeometry } from "@/data/generated/italy-regions";
import type { HomeItalyFunnel } from "@/lib/home-italy-funnel";
import { partialMonth, type SiopeMunicipalSnapshot } from "@/lib/siope-snapshot";
import { compactEuro, exactEuro, integer, longDate, percent } from "@/lib/format";
import { PUBLIC_COMUNI_URL, PUBLIC_POLITICI_URL } from "@/lib/site";
import styles from "./home-pathways.module.css";

function Arrow() {
  return <HugeiconsIcon icon={ArrowRight01Icon} data-link-arrow="true" size={18} aria-hidden="true" />;
}

export function HomePathways({ funnel, siope, children }: Readonly<{
  funnel: HomeItalyFunnel;
  siope: SiopeMunicipalSnapshot;
  children: ReactNode;
}>) {
  return (
    <div id="analisi" className={styles.pathways}>
      <section id="spesa-pubblica" className={styles.feature} aria-labelledby="spesa-pubblica-title">
        <div className={styles.copy}>
          <h2 id="spesa-pubblica-title">Spesa pubblica</h2>
          <p>La spesa delle amministrazioni pubbliche per sanità, istruzione, pensioni e altri servizi. Bilancio dello Stato e pagamenti comunali hanno viste dedicate.</p>
          <Link prefetch={false} href="/spese" className={styles.primaryLink}>Esplora la spesa <Arrow /></Link>
          <div className={styles.related}>
            <Link prefetch={false} href="/spese/legge-di-bilancio">Bilancio dello Stato</Link>
            <Link prefetch={false} href="/busta-paga">La tua busta paga</Link>
          </div>
        </div>
        <div className={styles.preview} aria-label={`Anteprima spesa pubblica ${funnel.pa.year}`}>
          <div className={styles.previewHeader}><span>SPESA PUBBLICA ITALIANA</span><span>{funnel.pa.year}</span></div>
          <strong className={styles.bigNumber}>{compactEuro(funnel.pa.totalEuro)}</strong>
          <p className={styles.metricNote}>Tutte le amministrazioni pubbliche · {percent(funnel.pa.gdpSharePercent)} del PIL</p>
          <ul className={styles.bars}>
            {funnel.pa.slices.slice(0, 4).map((slice) => (
              <li key={slice.id}>
                <div><span>{slice.label}</span><strong>{percent(slice.sharePercent)}</strong></div>
                <span className={styles.track} aria-hidden="true"><span style={{ width: `${slice.sharePercent}%` }} /></span>
              </li>
            ))}
          </ul>
          <p className={styles.source}>Le quattro voci maggiori, in % del totale. Competenza SEC 2010.<br />
            <a href={funnel.pa.source.href} target="_blank" rel="noreferrer">{funnel.pa.source.label}</a> · pubblicato {funnel.pa.source.observedAt}
          </p>
        </div>
      </section>

      <section id="comuni-territori" className={styles.feature} aria-labelledby="comuni-territori-title">
        <div className={styles.copy}>
          <h2 id="comuni-territori-title">Comuni e territori</h2>
          <p>Pagamenti e redditi dei Comuni italiani. La mappa permette di confrontare territori simili, con importi totali e valori per abitante.</p>
          <Link prefetch={false} href={PUBLIC_COMUNI_URL} className={styles.primaryLink}>Apri la mappa dei Comuni <Arrow /></Link>
          <div className={styles.related}>
            <Link prefetch={false} href={`/territori?anno=${siope.year}`}>Confronta i territori</Link>
            <Link prefetch={false} href="/territori/irpef">Redditi e IRPEF</Link>
          </div>
        </div>
        <div className={`${styles.preview} ${styles.territoryPreview}`}>
          <div className={styles.previewHeader}><span>PAGAMENTI DEI COMUNI</span><span>{siope.year}</span></div>
          <div className={styles.territoryBody}>
            {/* Locator illustration only: uniform fill carries no quantitative meaning. */}
            <svg viewBox={ITALY_REGIONS_VIEWBOX} className={styles.italy} aria-hidden="true">
              {italyRegionGeometry.map((region) => <path key={region.code} d={region.path} />)}
            </svg>
            <div className={styles.territoryFacts}>
              <span className={styles.smallLabel}>COMUNI CON MOVIMENTI</span>
              <strong>{integer(siope.coverage.withMovements)}</strong>
              <span className={styles.smallLabel}>PAGAMENTI PER ABITANTE</span>
              <strong>{siope.nationalPerCapita === null ? "Non disponibile" : exactEuro(siope.nationalPerCapita)}</strong>
              <p>Da gennaio a {siope.latestMonthLabel.toLocaleLowerCase("it-IT")} {siope.year}. {partialMonth(siope) !== null ? "Periodo parziale." : ""}</p>
            </div>
          </div>
          <p className={styles.source}>Cassa dei Comuni, distinta dalla spesa PA.<br /><a href={siope.source.siopeMovementsUrl} target="_blank" rel="noreferrer">SIOPE · RGS / Banca d’Italia</a> · verificato {longDate(siope.source.observedAt)}</p>
        </div>
      </section>

      <section id="politica-istituzioni" className={styles.feature} aria-labelledby="politica-istituzioni-title">
        <div className={styles.copy}>
          <h2 id="politica-istituzioni-title">Politica e istituzioni</h2>
          <p>Composizione delle istituzioni, incarichi e attività parlamentari. La mappa mostra le relazioni tra persone e organi della Repubblica.</p>
          <Link prefetch={false} href={PUBLIC_POLITICI_URL} className={styles.primaryLink}>Apri la mappa della politica <Arrow /></Link>
          <div className={styles.related}>
            <Link prefetch={false} href="/governi">Governi a confronto</Link>
            <Link prefetch={false} href="/parlamento">Parlamento</Link>
          </div>
        </div>
        <div className={`${styles.preview} ${styles.institutions}`}>
          <div className={styles.previewHeader}><span>ISTITUZIONI</span><HugeiconsIcon icon={Building04Icon} size={24} aria-hidden="true" /></div>
          <p className={styles.institutionsTitle}>Gli organi della Repubblica</p>
          <div className={styles.institutionLinks}>
            <Link prefetch={false} href={PUBLIC_POLITICI_URL}>Presidenza della Repubblica <Arrow /></Link>
            <Link prefetch={false} href="/governi">Governo <Arrow /></Link>
            <Link prefetch={false} href="/parlamento">Camera e Senato <Arrow /></Link>
          </div>
          <p className={styles.source}>Persone, incarichi e atti dalle fonti istituzionali. Date e perimetri nelle singole schede.</p>
        </div>
      </section>

      <section id="economia-societa" className={styles.feature} aria-labelledby="economia-societa-title">
        <div className={styles.copy}>
          <h2 id="economia-societa-title">Economia e società</h2>
          <p>Imprese attive, occupazione, scuole e università. Gli atlanti raccolgono gli indicatori disponibili per confrontare le regioni e seguire i cambiamenti nel tempo.</p>
          <Link prefetch={false} href="/imprese" className={styles.primaryLink}>Apri l’atlante delle imprese <Arrow /></Link>
          <div className={styles.related}>
            <Link prefetch={false} href="/istruzione">Istruzione</Link>
            <Link prefetch={false} href="/poverta">Povertà e condizioni di vita</Link>
          </div>
        </div>
        <div className={styles.atlasPreview}>
          <Link prefetch={false} href="/imprese" className={styles.atlas}>
            <HugeiconsIcon icon={Building03Icon} size={34} strokeWidth={1.2} aria-hidden="true" />
            <span className={styles.smallLabel}>ECONOMIA</span>
            <strong>Imprese</strong><span>Attività, addetti e territori.</span><span className={styles.atlasAction}>Apri l’atlante <Arrow /></span>
          </Link>
          <Link prefetch={false} href="/istruzione" className={styles.atlas}>
            <HugeiconsIcon icon={School01Icon} size={34} strokeWidth={1.2} aria-hidden="true" />
            <span className={styles.smallLabel}>ISTRUZIONE</span>
            <strong>Istruzione</strong><span>Scuola, università e ricerca.</span><span className={styles.atlasAction}>Apri l’atlante <Arrow /></span>
          </Link>
          <p className={styles.atlasNote}>Fonti, anni di riferimento e copertura territoriale sono indicati in ciascun atlante.</p>
        </div>
      </section>

      <section id="controlli-analisi" className={`${styles.feature} ${styles.analysisFeature}`} aria-labelledby="controlli-analisi-title">
        <div className={styles.copy}>
          <h2 id="controlli-analisi-title">Controlli e analisi</h2>
          <p>Appalti, affidamenti e risultati dei controlli, insieme a studi sulla spesa pubblica. I valori anomali richiedono verifiche e non dimostrano, da soli, sprechi o illeciti.</p>
          <Link prefetch={false} href="/controlli" className={styles.primaryLink}>Apri i controlli <Arrow /></Link>
          <div className={styles.related}>
            <Link prefetch={false} href="/studi">Paper di ricerca</Link>
            <Link prefetch={false} href="/report">Articoli e approfondimenti</Link>
          </div>
        </div>
        {children}
      </section>
    </div>
  );
}
