import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { integer, longDate } from "@/lib/format";
import {
  ENTE_DATASET_ID,
  formatStaffCount,
  formatStaffDelta,
  getOccupazioneInstitutionSummary,
  loadInstitutionStaffView,
} from "@/lib/rgs-conto-annuale-occupazione";
import { StaffSeriesChart } from "../staff-series-chart";
import styles from "../conto-annuale.module.css";

type PageProps = {
  params: Promise<{ codice: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { codice } = await params;
  const summary = getOccupazioneInstitutionSummary(codice);
  if (!summary) return { title: "Istituzione non trovata" };
  return {
    title: `${summary.name} · personale PA 2010-2024`,
    description: `Personale al 31 dicembre e lavoro flessibile per ${summary.name} (${summary.type}), Conto Annuale RGS dal 2010 al 2024.`,
  };
}

export default async function ContoAnnualeInstitutionPage({ params }: PageProps) {
  const { codice } = await params;
  const view = await loadInstitutionStaffView(codice);
  if (!view) notFound();

  const { summary } = view;
  const nameChanged = view.nameVariants.length > 1;

  return (
    <main className={`shell page ${styles.page}`}>
      <header className={styles.hero}>
        <div>
          <p><Link href="/personale-pa/conto-annuale">← Personale PA per istituzione</Link></p>
          <h1>{view.latestName}</h1>
          <p>
            {view.type}
            {view.bdap ? ` · codice ente BDAP ${view.bdap}` : " · codice ente BDAP non pubblicato"}
            {" · "}codice istituzione {view.code}
          </p>
          {nameChanged ? (
            <p className={styles.resultMeta}>
              Denominazioni pubblicate negli anni: {view.nameVariants.join(" · ")}.
              Un cambio di etichetta non indica da solo un&apos;operazione sul personale.
            </p>
          ) : null}
        </div>
      </header>

      <section className="stat-strip" aria-label="Sintesi della serie">
        <div>
          <span className="stat-label">Personale · {view.points.at(-1)!.year}</span>
          <span className="stat-value" data-testid="staff-latest">{formatStaffCount(summary.latestPermanent)}</span>
        </div>
        <div>
          <span className="stat-label">Variazione dal 2010</span>
          <span className="stat-value" data-testid="staff-delta-baseline">
            {summary.deltaBaseline === null ? "Non disponibile" : formatStaffDelta(summary.deltaBaseline)}
          </span>
          <span className="stat-note">
            {summary.baselinePermanent === null ? "Assente nel 2010" : `${formatStaffCount(summary.baselinePermanent!)} nel 2010`}
          </span>
        </div>
        <div>
          <span className="stat-label">Rispetto al picco ({summary.peakYear})</span>
          <span className="stat-value">{formatStaffDelta(summary.deltaPeak ?? 0)}</span>
          <span className="stat-note">{formatStaffCount(summary.peakPermanent)} persone</span>
        </div>
        <div>
          <span className="stat-label">Lavoro flessibile · {view.points.at(-1)!.year}</span>
          <span className="stat-value">{formatStaffCount(summary.latestFlexible)}</span>
          <span className="stat-note">Unità annue</span>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="grafico-serie">
        <h2 id="grafico-serie">Serie 2010-2024</h2>
        <StaffSeriesChart id={`ist-${view.code}`} label={view.latestName} points={view.points} />
      </section>

      <section className={styles.panel} aria-labelledby="tabella-serie">
        <h2 id="tabella-serie">Valori annuali verificati</h2>
        <div className={styles.tableScroll} role="region" aria-label="Tabella personale per anno" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Anno</th>
                <th scope="col">Denominazione pubblicata</th>
                <th scope="col" className="num">Personale</th>
                <th scope="col" className="num">Lavoro flessibile</th>
                <th scope="col">Fonte</th>
              </tr>
            </thead>
            <tbody>
              {view.points.map((point) => (
                <tr key={point.year}>
                  <td>{point.year}</td>
                  <td>{point.name}</td>
                  <td className="num">{formatStaffCount(point.permanent)}</td>
                  <td className="num">{formatStaffCount(point.flexible)}</td>
                  <td>
                    {point.sourceUrl ? (
                      <a href={point.sourceUrl}>File {point.year}</a>
                    ) : (
                      <span className={styles.missingValue}>Non disponibile</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="provenienza">
        <h2 id="provenienza">Provenienza</h2>
        <p>
          Dataset integrato <Link href={`/dati/${ENTE_DATASET_ID}`}>{ENTE_DATASET_ID}</Link>
          {" · "}{integer(view.points.length)} anni caricati dal corpus ({integer(view.dataset.publicRows)} righe totali nel dataset).
        </p>
        <p>
          Verifica del corpus:{" "}
          <time dateTime={view.dataset.sourceMetadata.checkedAt}>
            {longDate(view.dataset.sourceMetadata.checkedAt)}
          </time>
          {" · "}licenza {view.dataset.licenseStatus.replace("verified-open-", "").toUpperCase()}
        </p>
      </section>
    </main>
  );
}
