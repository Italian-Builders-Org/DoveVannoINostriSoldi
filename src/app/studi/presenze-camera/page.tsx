import type { Metadata } from "next";
import Link from "next/link";
import { cameraPresenzeStudy as study } from "@/lib/studies";
import { PUBLIC_SITE_URL } from "@/lib/site";
import styles from "../studies.module.css";
import { PresenceGroupChart, PresenceHistogram } from "./presenze-charts";

const pct = (n: number) =>
  `${n.toLocaleString("it-IT", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
const count = (n: number) => n.toLocaleString("it-IT");
const pdfHref = `${study.assetPath}/presenze-camera.pdf`;
const date = new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeZone: "UTC" });

export const metadata: Metadata = {
  title: `${study.title} · Studi`,
  description: study.description,
  alternates: { canonical: `${PUBLIC_SITE_URL}${study.path}` },
  openGraph: {
    type: "article",
    title: study.title,
    description: study.description,
    url: `${PUBLIC_SITE_URL}${study.path}`,
    modifiedTime: study.revisedAt,
  },
};

export default function CameraPresenzeStudyPage() {
  const h = study.headline;
  const populatedBins = study.bins.filter((bin) => bin.count > 0);
  const topBand = populatedBins.filter((bin) => bin.from >= 85).reduce((sum, bin) => sum + bin.count, 0);

  return (
    <main className={`shell page ${styles.page}`}>
      <Link href="/studi">← Tutti gli studi</Link>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>{study.series} · Versione {study.version}</p>
        <h1>{study.title}</h1>
        <p>{study.subtitle}</p>
        <p className={styles.meta}>
          DoveVannoINostriSoldi · Pubblicato il{" "}
          <time dateTime={study.publishedOn}>{date.format(new Date(`${study.publishedOn}T00:00:00Z`))}</time>
          <br />
          Fonte: {study.source.owner} · rilevazione{" "}
          <time dateTime={study.period.observedDate}>{date.format(new Date(`${study.period.observedDate}T00:00:00Z`))}</time>
        </p>
        <div className={styles.actions}>
          <a href={pdfHref} className="btn btn-primary" download>
            Scarica il paper PDF
          </a>
          <Link href="/politici?vista=presenze">Vista interattiva</Link>
          <a href="#materiali">Fonti e materiali</a>
        </div>
      </header>

      <aside className={styles.note}>
        <strong>Cosa misura.</strong> Partecipazione alle votazioni elettroniche in Aula
        (voto espresso o missione). Non misura presenza fisica continua né il lavoro in
        commissione. Il Senato non pubblica una tabella equivalente.
      </aside>

      <dl className={styles.stats}>
        <div>
          <dt>Deputati in distribuzione</dt>
          <dd>{count(h.matchedDeputies)}</dd>
        </div>
        <div>
          <dt>Mediana</dt>
          <dd>{pct(h.median)}</dd>
        </div>
        <div>
          <dt>Banda 10°-90°</dt>
          <dd>
            {pct(h.p10)}-{pct(h.p90)}
          </dd>
        </div>
      </dl>

      <section className={styles.section}>
        <h2>Domanda</h2>
        <p>
          Come si distribuiscono le percentuali ufficiali di partecipazione al voto alla
          Camera nella {study.period.legislature}, fino a {study.period.monthLabel.toLowerCase()}?
        </p>
        <p className={styles.meta}>{study.period.label}.</p>
      </section>

      <section className={styles.section}>
        <h2>Fasce di presenza</h2>
        <p>
          Media {pct(h.mean)}, mediana {pct(h.median)}. {count(topBand)} deputati
          ({Math.round((topBand / h.matchedDeputies) * 100)}%) stanno dalla fascia 85% in su.
          Sotto il 10° percentile ({pct(h.p10)}) ci sono {count(h.tailBelowP10)} deputati.
        </p>
        <PresenceHistogram bins={study.bins} total={h.matchedDeputies} />
        <p className={styles.meta}>
          Fasce del 5%. Solo deputati con match anagrafico. Fonte:{" "}
          <a href={study.source.pageUrl}>{study.source.title}</a>.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Gruppi parlamentari</h2>
        <p>
          Mediana per gruppo, ordinata dal più alto. Solo gruppi con almeno 3 deputati
          abbinati. La tabella sotto il grafico riporta anche media e intervallo P25-P75.
        </p>
        <PresenceGroupChart groups={study.groups} />
      </section>

      <section className={styles.section}>
        <h2>Limiti</h2>
        <ul>
          {study.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </section>

      <section className={styles.section} id="materiali">
        <h2>Materiali</h2>
        <ul>
          <li>
            <a href={pdfHref} download>
              Paper PDF · v{study.version}
            </a>
          </li>
          <li>
            <a href={study.reproducibilityUrl}>Dati, codice e versioni</a>
          </li>
          <li>
            <Link href="/politici?vista=presenze">Atlante · vista Presenze</Link>
          </li>
          <li>
            <Link href="/metodologia">Come leggiamo i dati</Link>
          </li>
        </ul>
        <p className={styles.meta}>
          Versione {study.version} del {study.revisedAt}. Studio DVNS; non sottoposto a peer
          review esterna. I valori della pagina sono congelati alla revisione e non
          ricalcolati dallo snapshot live.
        </p>
        <details>
          <summary>Impronta SHA-256 del PDF</summary>
          <p className={styles.hash}>
            PDF v{study.version}: <code>{study.assets["presenze-camera.pdf"].sha256}</code>
          </p>
        </details>
      </section>
    </main>
  );
}
