import type { Metadata } from "next";
import Link from "next/link";
import {
  AiChat02Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { HomePathways } from "@/components/home-pathways";
import { getHomeAnomalySignals, type AuditSignal } from "@/lib/audit-data";
import { eurostatCofogData } from "@/lib/eurostat-cofog-snapshot";
import {
  integer,
  percent,
} from "@/lib/format";
import { buildHomeItalyFunnel } from "@/lib/home-italy-funnel";
import {
  availableSiopeYears,
  getSiopeMunicipalSnapshot,
} from "@/lib/siope-snapshot";
import { SiteDirectory } from "@/components/site-directory";
import { HOME_ASSISTANT_EXAMPLES, HOME_QUESTION_MAX, assistantHref } from "@/lib/assistant-home";
import { MOBILITA_MAP_PATH } from "@/lib/site";
import Image from "next/image";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: {
    absolute: "DoveVannoINostriSoldi",
  },
  description:
    "Spesa pubblica, imprese e territori: dati ufficiali italiani con fonti e perimetri espliciti.",
};

/** Static previews captured from the live maps: no map code or data is loaded on the home page. */
const HOME_MAPS = [
  {
    href: MOBILITA_MAP_PATH,
    title: "Mappa della mobilità",
    text: "Dove tram, metro e bus rallentano, dagli orari ufficiali.",
    image: "/home/mappa-mobilita.webp",
    width: 1200,
    height: 652,
    tile: "large",
  },
  {
    href: "/politici",
    title: "Mappa della politica",
    text: "Camera, Senato e Governo: gruppi, incarichi, presenze e voti.",
    image: "/home/mappa-politica.webp",
    width: 900,
    height: 528,
    tile: "small",
  },
  {
    href: "/comuni",
    title: "Mappa dei Comuni",
    text: "Il tuo Comune confrontato con quelli simili.",
    image: "/home/mappa-comuni.webp",
    width: 900,
    height: 726,
    tile: "small",
  },
] as const;

const HOME_ANOMALY_PRESENTATION = {
  "procurement-direct-awards-2025": {
    title: "Affidamenti diretti",
    kind: "Dato osservato",
    period: "2025 · procedure da 40.000 € in su",
  },
  "gdf-public-spending-fraud": {
    title: "Frodi accertate nei controlli",
    kind: "Esito dei controlli",
    period: "dal 1 gen 2025 al 31 mag 2026",
  },
  "pnrr-beyond-2026": {
    title: "Risorse PNRR oltre il 2026",
    kind: "Previsione",
    period: "febbraio 2026",
  },
} as const;

function anomalyValue(signal: AuditSignal): string {
  let formatted: string;
  if (signal.unit === "percent") {
    formatted = percent(signal.value);
  } else if (signal.unit === "billion-euro") {
    formatted = `${signal.value.toLocaleString("it-IT", {
      maximumFractionDigits: 1,
    })} mld €`;
  } else if (signal.unit === "million-euro") {
    formatted = `${signal.value.toLocaleString("it-IT", {
      maximumFractionDigits: 1,
    })} mln €`;
  } else {
    formatted = integer(signal.value);
  }

  if (signal.valueQualifier === "over") return `oltre ${formatted}`;
  if (signal.valueQualifier === "about") return `circa ${formatted}`;
  return formatted;
}

function selectedSiopeYear(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] ?? "" : value ?? "", 10);
  return availableSiopeYears.includes(parsed) ? parsed : availableSiopeYears[0];
}

function selectedPaYear(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] ?? "" : value ?? "", 10);
  const { from, to } = eurostatCofogData.period;
  return Number.isSafeInteger(parsed) && parsed >= from && parsed <= to ? parsed : to;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ anno?: string | string[]; comuni?: string | string[] }>;
}) {
  const params = await searchParams;
  const paYear = selectedPaYear(params.anno);
  const year = selectedSiopeYear(params.comuni ?? params.anno);
  const funnel = buildHomeItalyFunnel(paYear);
  const siope = getSiopeMunicipalSnapshot(year);
  const anomalySignals = getHomeAnomalySignals();

  return (
    <main className={`shell ${styles.hub}`} data-home-editorial="true">
      <header className={styles.intro}>
        <h1 className={styles.pageTitle}>Dove vanno <span>i nostri soldi?</span></h1>
        <div className={styles.introBottom}>
          <p className={styles.lead}>Spesa pubblica, territori e istituzioni. Esplora i dati italiani, con fonti e periodi di riferimento.</p>
          <a href="#esplora" className={styles.exploreJump}><span>Esplora i dati ↓</span></a>
        </div>
        <div className={styles.ask}>
          <form className={styles.askBar} action="/assistente" method="get" role="search" aria-label="Chiedi ai dati con l'assistente">
            <label htmlFor="home-assistant-question" className={styles.askLabel}>
              <HugeiconsIcon icon={AiChat02Icon} size={18} aria-hidden="true" />Chiedi ai dati
            </label>
            <input id="home-assistant-question" name="q" type="text" required maxLength={HOME_QUESTION_MAX} autoComplete="off"
              placeholder="Quanto spende il mio Comune?" />
            <button type="submit" aria-label="Invia la domanda all'assistente">
              <HugeiconsIcon icon={ArrowRight01Icon} size={20} aria-hidden="true" />
            </button>
          </form>
          <div className={styles.askMeta}>
            <ul className={styles.askExamples} aria-label="Domande di esempio">
              {HOME_ASSISTANT_EXAMPLES.map((example) => (
                <li key={example}><Link prefetch={false} href={assistantHref(example)}>{example}</Link></li>
              ))}
            </ul>
            <p>Assistente AI · risposte con le fonti del sito · 10 domande gratuite al giorno</p>
          </div>
        </div>
      </header>
      <Link prefetch={false} href="/dvns-index" className={styles.indexLaunch} data-dvns-index-launch>
        <span className={styles.indexBadge}>Nuovo</span>
        <span className={styles.indexMark}>DVNS <span>Index</span></span>
        <span className={styles.indexText}>Il tuo Comune spende meglio o peggio degli altri? La classifica di oltre 6.000 Comuni e la mappa delle Regioni, con il perché di ogni punteggio.</span>
        <span className={styles.indexCta}>Scopri la classifica<HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" /></span>
      </Link>
      <HomePathways funnel={funnel} siope={siope}>
      <section className={`panel ${styles.anomaliesPanel}`} aria-labelledby="anomalies-title">
        <div className={styles.anomaliesHeader}>
          <div className={styles.headingWithTooltip}>
            <h3 id="anomalies-title" className="panel-title">
              Controlli sulla spesa
            </h3>

          </div>
          <Link prefetch={false} className={styles.anomaliesLink} href="/controlli">
            Tutti i controlli
            <HugeiconsIcon icon={ArrowRight01Icon} data-link-arrow="true" size={16} aria-hidden="true" />
          </Link>
        </div>
        <div className={styles.anomalyGallery}>
          {anomalySignals.map((signal) => {
            const presentation =
              HOME_ANOMALY_PRESENTATION[signal.id as keyof typeof HOME_ANOMALY_PRESENTATION];
            if (!presentation) return null;

            return (
              <article
                className={styles.anomalyItem}
                data-signal={signal.id}
                key={signal.id}
              >
                <div className={styles.anomalyItemHead}>
                  <span className={styles.anomalyArea}>{presentation.kind} · {signal.area}</span>
                </div>
                <h3>{presentation.title}</h3>
                <strong className={styles.anomalyValue}>{anomalyValue(signal)}</strong>
                <p className={styles.anomalyMeta}>
                  <span>{presentation.period}</span>
                  <a
                    href={signal.source.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Fonte ${signal.source.institution}: ${signal.source.title}`}
                  >
                    {signal.source.institution} ↗
                  </a>
                </p>
              </article>
            );
          })}
        </div>
        <p className={styles.anomalyCaveat}>I tre valori descrivono fenomeni diversi e non sono sommabili. Un affidamento diretto non indica, da solo, un’irregolarità.</p>
        {anomalySignals.length < 3 ? (
          <p className={styles.anomalyFallback}>
            Mostriamo solo i segnali con fonte verificata.{" "}
            <Link prefetch={false} href="/controlli">Esplora gli altri controlli</Link>.
          </p>
        ) : null}
      </section>

      </HomePathways>

      <section className={styles.mapsFeature} aria-labelledby="home-maps-title">
        <div className={styles.mapsCopy}>
          <h2 id="home-maps-title">Le mappe</h2>
          <p>I dati sul territorio e nelle istituzioni, da esplorare a colpo d&apos;occhio: il tuo Comune accanto a quelli simili, il Parlamento seggio per seggio, i mezzi pubblici tratta per tratta.</p>
          <ul className={styles.mapsList}>
            {HOME_MAPS.map((map) => (
              <li key={map.href}>
                <Link prefetch={false} href={map.href}>
                  <span><strong>{map.title}</strong>{map.text}</span>
                  <HugeiconsIcon icon={ArrowRight01Icon} size={18} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <ul className={styles.mapsMosaic} aria-label="Anteprime delle mappe">
          {HOME_MAPS.map((map) => (
            <li key={map.href} data-home-map={map.href} data-tile={map.tile}>
              <Link prefetch={false} href={map.href} tabIndex={-1} aria-hidden="true">
                <Image src={map.image} alt="" width={map.width} height={map.height} sizes={map.tile === "large" ? "(max-width: 900px) 100vw, 640px" : "(max-width: 900px) 50vw, 320px"} />
                <span className={styles.mapsTag}>{map.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section id="esplora" className={styles.exploration} aria-labelledby="exploration-title">
        <div className={styles.explorationHeading}>
          <h2 id="exploration-title">Esplora i dati</h2>
          <p>Tutte le pagine, organizzate per argomento.</p>
        </div>
        <SiteDirectory showMaps />
      </section>
    </main>
  );
}
