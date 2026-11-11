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

const PATHWAYS = [
  { id: "spesa-pubblica", title: "Spesa pubblica", question: "Come vengono usati?" },
  { id: "comuni-territori", title: "Comuni e territori", question: "Cosa succede vicino a te?" },
  { id: "politica-istituzioni", title: "Politica e istituzioni", question: "Chi prende le decisioni?" },
  { id: "economia-societa", title: "Economia e società", question: "Come cambia il Paese?" },
  { id: "controlli-analisi", title: "Controlli e analisi", question: "Cosa va approfondito?" },
] as const;

function Arrow() {
  return <HugeiconsIcon icon={ArrowRight01Icon} size={18} aria-hidden="true" />;
}

export function HomePathwayIndex() {
  return (
    <nav className={styles.index} aria-label="Cinque percorsi di lettura">
      {PATHWAYS.map((pathway, index) => (
        <a key={pathway.id} href={`#${pathway.id}`}>
          <span className={styles.indexNumber}>0{index + 1}<Arrow /></span>
          <strong>{pathway.title}</strong>
          <span>{pathway.question}</span>
        </a>
      ))}
    </nav>
  );
}

export function HomePathways({ funnel, siope, children }: Readonly<{
  funnel: HomeItalyFunnel;
  siope: SiopeMunicipalSnapshot;
  children: ReactNode;
}>) {
  return (
    <div id="analisi" className={styles.pathways}>
      <div className={styles.sectionHeading}>
        <p>LEGGERE IL PAESE ATTRAVERSO I DATI</p>
        <span>Cinque percorsi, un punto di partenza.</span>
      </div>

      <section id="spesa-pubblica" className={styles.feature} aria-labelledby="spesa-pubblica-title">
        <div className={styles.copy}>
          <p className={styles.eyebrow}>01 / SPESA PUBBLICA</p>
          <h2 id="spesa-pubblica-title">Dai grandi numeri<br />alle scelte concrete.</h2>
          <p>Sanità, scuola, pensioni, servizi. Capisci come si compone la spesa pubblica e segui ogni voce fino alla fonte.</p>
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
          <p className={styles.eyebrow}>02 / COMUNI E TERRITORI</p>
          <h2 id="comuni-territori-title">Il Paese, visto<br />da dove vivi.</h2>
          <p>Parti dal tuo Comune. Esplora i pagamenti, confronta territori simili e leggi i numeri in rapporto agli abitanti e ai servizi.</p>
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
          <p className={styles.eyebrow}>03 / POLITICA E ISTITUZIONI</p>
          <h2 id="politica-istituzioni-title">Le persone.<br />Le istituzioni.<br />Le decisioni.</h2>
          <p>Una mappa per orientarti nella Repubblica: ruoli, incarichi e collegamenti. Dal quadro d’insieme alle attività parlamentari.</p>
          <Link prefetch={false} href={PUBLIC_POLITICI_URL} className={styles.primaryLink}>Esplora la mappa della politica <Arrow /></Link>
          <div className={styles.related}>
            <Link prefetch={false} href="/governi">Governi a confronto</Link>
            <Link prefetch={false} href="/parlamento">Parlamento</Link>
          </div>
        </div>
        <div className={`${styles.preview} ${styles.institutions}`}>
          <div className={styles.previewHeader}><span>ORIENTARSI NELLA REPUBBLICA</span><HugeiconsIcon icon={Building04Icon} size={24} aria-hidden="true" /></div>
          <p className={styles.institutionsTitle}>Chi rappresenta.<br />Chi governa.<br />Chi decide.</p>
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
          <p className={styles.eyebrow}>04 / ECONOMIA E SOCIETÀ</p>
          <h2 id="economia-societa-title">Oltre la spesa,<br />la vita del Paese.</h2>
          <p>Imprese, lavoro e istruzione: leggi le differenze tra i territori e scopri il contesto in cui vengono impiegate le risorse pubbliche.</p>
          <Link prefetch={false} href="/imprese" className={styles.primaryLink}>Scopri l’atlante delle imprese <Arrow /></Link>
          <div className={styles.related}>
            <Link prefetch={false} href="/istruzione">Istruzione</Link>
            <Link prefetch={false} href="/poverta">Povertà e condizioni di vita</Link>
          </div>
        </div>
        <div className={styles.atlasPreview}>
          <Link prefetch={false} href="/imprese" className={styles.atlas}>
            <HugeiconsIcon icon={Building03Icon} size={34} strokeWidth={1.2} aria-hidden="true" />
            <span className={styles.smallLabel}>ATLANTE / ECONOMIA</span>
            <strong>Imprese</strong><span>Attività, addetti e territori.</span><span className={styles.atlasAction}>Apri l’atlante <Arrow /></span>
          </Link>
          <Link prefetch={false} href="/istruzione" className={styles.atlas}>
            <HugeiconsIcon icon={School01Icon} size={34} strokeWidth={1.2} aria-hidden="true" />
            <span className={styles.smallLabel}>ATLANTE / ISTRUZIONE</span>
            <strong>Istruzione</strong><span>Scuola, università e ricerca.</span><span className={styles.atlasAction}>Apri l’atlante <Arrow /></span>
          </Link>
          <p className={styles.atlasNote}>Scegli un tema, poi un territorio. Ogni atlante esplicita fonti, periodi e limiti dei confronti.</p>
        </div>
      </section>

      <section id="controlli-analisi" className={`${styles.feature} ${styles.analysisFeature}`} aria-labelledby="controlli-analisi-title">
        <div className={styles.copy}>
          <p className={styles.eyebrow}>05 / CONTROLLI E ANALISI</p>
          <h2 id="controlli-analisi-title">Le domande giuste,<br />prima delle conclusioni.</h2>
          <p>Segnali da approfondire, analisi e paper di ricerca. Parti da un’evidenza e verifica che cosa i dati permettono davvero di dire.</p>
          <Link prefetch={false} href="/controlli" className={styles.primaryLink}>Esamina i controlli <Arrow /></Link>
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
