import type { Metadata } from "next";
import Link from "next/link";
import { integer } from "@/lib/format";
import {
  ENTE_DATASET_ID,
  formatStaffCount,
  formatStaffDelta,
  getOccupazioneIndex,
  TIPOLOGIA_DATASET_ID,
} from "@/lib/rgs-conto-annuale-occupazione";
import { InstitutionSearch } from "./institution-search";
import { StaffSeriesChart } from "./staff-series-chart";
import styles from "./conto-annuale.module.css";

export const metadata: Metadata = {
  title: "Personale PA per istituzione · Conto Annuale 2010-2024",
  description:
    "Quanti dipendenti ha il tuo Comune o ente pubblico e come sono cambiati dal 2010 al 2024: personale al 31 dicembre e lavoro flessibile, fonte OpenBDAP RGS.",
};

export default async function ContoAnnualeOccupazioneHubPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const index = getOccupazioneIndex();
  const params = await searchParams;
  const initialQuery = Array.isArray(params.q) ? params.q[0] ?? "" : params.q ?? "";
  const latestNational = index.nationalSeries.at(-1)!;
  const baselineNational = index.nationalSeries[0]!;
  const nationalDelta = latestNational.permanent - baselineNational.permanent;
  const searchInstitutions = index.institutions.map((institution) => ({
    code: institution.code,
    name: institution.name,
    type: institution.type,
    permanentLatest: institution.permanentLatest,
  }));

  return (
    <main className={`shell page ${styles.page}`}>
      <header className={styles.hero}>
        <div>
          <h1>Personale delle istituzioni pubbliche</h1>
          <p>
            Conto Annuale RGS · OpenBDAP, serie <code>PCA_OCC_DIP_ENTE_001</code>.
            {" "}Per ogni istituzione vedi il personale al 31 dicembre (tempo pieno e part time, in persone)
            e il lavoro flessibile (unità annue) dal {index.baselineYear} al {index.latestYear}.
          </p>
        </div>
        <div className={styles.heroLinks}>
          <Link href="/incarichi/personale-organi">Contesto personale e organi →</Link>
          <Link href={`/dati/${ENTE_DATASET_ID}`}>Dataset per istituzione →</Link>
          <Link href={`/dati/${TIPOLOGIA_DATASET_ID}`}>Dataset per tipo →</Link>
        </div>
      </header>

      <section className="stat-strip" aria-label="Panorama nazionale 2024">
        <div>
          <span className="stat-label">Personale al 31 dicembre · {index.latestYear}</span>
          <span className="stat-value">{formatStaffCount(latestNational.permanent)}</span>
          <span className="stat-note">Somma per tipo di istituzione</span>
        </div>
        <div>
          <span className="stat-label">Variazione dal {index.baselineYear}</span>
          <span className="stat-value">{formatStaffDelta(nationalDelta)}</span>
          <span className="stat-note">Stesso perimetro, non include enti nati o cessati</span>
        </div>
        <div>
          <span className="stat-label">Lavoro flessibile · {index.latestYear}</span>
          <span className="stat-value">{formatStaffCount(latestNational.flexible)}</span>
          <span className="stat-note">Unità annue, non sommabile al personale</span>
        </div>
        <div>
          <span className="stat-label">Istituzioni con dato {index.latestYear}</span>
          <span className="stat-value">{integer(index.searchableCount)}</span>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="cerca-istituzione">
        <h2 id="cerca-istituzione">Cerca la tua istituzione</h2>
        <p>
          Comuni, Ministeri, scuole, ASL e altre amministrazioni: cerca per nome o codice istituzione
          e apri la serie 2010-2024 con grafico e tabella verificabile.
        </p>
        <InstitutionSearch institutions={searchInstitutions} initialQuery={initialQuery} />
      </section>

      <section className={styles.panel} aria-labelledby="serie-nazionale">
        <h2 id="serie-nazionale">Italia · personale per tipo di istituzione</h2>
        <p>Totale nazionale ricostruito sommando i tipi ufficiali (non è la somma delle singole istituzioni mostrate qui sotto).</p>
        <StaffSeriesChart
          id="nazionale"
          label="Italia"
          points={index.nationalSeries.map((point) => ({
            year: point.year,
            name: "Italia",
            permanent: point.permanent,
            flexible: point.flexible,
            sourceUrl: "",
          }))}
        />
      </section>

      <section className={styles.panel} aria-labelledby="variazioni-evidenza">
        <h2 id="variazioni-evidenza">Le variazioni più ampie dal {index.baselineYear} al {index.latestYear}</h2>
        <p>Solo istituzioni presenti in entrambi gli anni con personale positivo nel {index.baselineYear}. Una riga che compare o scompare non è una variazione di organico.</p>
        <div className={styles.statGrid}>
          <div>
            <h3>Crescita del personale</h3>
            <div className={styles.rankList}>
              {index.growth.map((item) => (
                <div key={item.code} className={styles.rankItem}>
                  <Link href={`/personale-pa/conto-annuale/${item.code}`}>{item.name}</Link>
                  <div className={styles.rankValues}>
                    <span>{formatStaffDelta(item.delta)} persone</span>
                    <span>{formatStaffCount(item.baseline)} → {formatStaffCount(item.latest)}</span>
                    <span>{item.type}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3>Riduzione del personale</h3>
            <div className={styles.rankList}>
              {index.shrink.map((item) => (
                <div key={item.code} className={styles.rankItem}>
                  <Link href={`/personale-pa/conto-annuale/${item.code}`}>{item.name}</Link>
                  <div className={styles.rankValues}>
                    <span>{formatStaffDelta(item.delta)} persone</span>
                    <span>{formatStaffCount(item.baseline)} → {formatStaffCount(item.latest)}</span>
                    <span>{item.type}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="tipi-2024">
        <h2 id="tipi-2024">Personale per tipo di istituzione · {index.latestYear}</h2>
        <div className={styles.tableScroll} role="region" aria-label={`Personale per tipo ${index.latestYear}`} tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Tipo di istituzione</th>
                <th scope="col" className="num">Istituzioni</th>
                <th scope="col" className="num">Personale</th>
                <th scope="col" className="num">Lavoro flessibile</th>
              </tr>
            </thead>
            <tbody>
              {index.typeTotalsLatest.map((row) => (
                <tr key={row.type}>
                  <td>{row.type}</td>
                  <td className="num">{integer(row.institutions)}</td>
                  <td className="num">{formatStaffCount(row.permanent)}</td>
                  <td className="num">{formatStaffCount(row.flexible)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <details className={styles.method} id="occupazione-metodo">
        <summary>Fonte, perimetro e limiti</summary>
        <h2>Cosa misura la serie</h2>
        <p>
          Personale al 31 dicembre: tempo pieno e part time, contato in persone (non equivalenti a tempo pieno).
          Lavoro flessibile: tempo determinato, formazione lavoro, interinale e lavoro socialmente utile, in unità annue.
          Non si somma al personale.
        </p>
        <h2>Cosa non misura</h2>
        <ul>
          {index.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
        <p>
          Enti che nascono, cessano o cambiano denominazione e tipo possono far apparire salti che non sono assunzioni o licenziamenti.
          Zero e dato mancante restano distinti: una riga assente indica che l&apos;istituzione non compare in quell&apos;anno.
        </p>
        <p>
          <a href="https://creativecommons.org/licenses/by/3.0/">Licenza CC BY 3.0</a>
          {" · "}
          <a href="https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/action/package_search?q=PCA_OCC_DIP_ENTE_001">
            OpenBDAP · PCA_OCC_DIP_ENTE_001
          </a>
        </p>
        <p>
          Fonte: MEF, Ragioneria Generale dello Stato, OpenBDAP. Selezione e presentazione a cura di DoveVannoINostriSoldi.
        </p>
      </details>
    </main>
  );
}
