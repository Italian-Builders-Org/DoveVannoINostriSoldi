import type { Metadata } from "next";
import Link from "next/link";
import { longDate } from "@/lib/format";
import {
  DEFAULT_BUDGET_LAW_WINDOW_YEARS,
  getBudgetLawMissionSeries,
  type BudgetLawMissionSeries,
} from "@/lib/bdap-legge-bilancio";
import { SimulatoreClient } from "./SimulatoreClient";
import styles from "./simulatore.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Simulatore Legge di Bilancio",
  description:
    "Variazione anno su anno dello stanziamento pubblicato per missione nelle ultime Leggi di Bilancio, con uno scenario ipotetico costruito dall'utente.",
};

export default async function SimulatoreLeggeBilancioPage() {
  let series: BudgetLawMissionSeries | null = null;
  let errorMessage: string | null = null;

  try {
    series = await getBudgetLawMissionSeries({
      windowYears: DEFAULT_BUDGET_LAW_WINDOW_YEARS,
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Errore sconosciuto";
  }

  return (
    <main className="shell page">
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span>→</span>
        <Link href="/stato">Spese dello Stato</Link>
        <span>→</span>
        <span>Simulatore Legge di Bilancio</span>
      </nav>

      <header className="page-intro">
        <h1>Simulatore Legge di Bilancio</h1>
        <p>
          Lo stanziamento di competenza pubblicato dalla Legge di Bilancio per ciascuna missione,
          anno su anno, così come lo pubblica RGS/OpenBDAP. Puoi costruire uno scenario ipotetico
          a partire da quel dato reale.
        </p>
      </header>

      <div className="notice warning-notice">
        <strong>Nessun valore simulato è un dato reale</strong>
        <p>
          Lo scenario che costruisci con lo slider qui sotto è un&apos;ipotesi tua, non una
          proiezione ufficiale né un annuncio di governo: nel grafico e nella tabella è sempre
          disegnato con una trama a righe e marcato &laquo;ipotesi&raquo;, mai come lo stanziamento
          osservato. Il dato osservato è solo lo stanziamento <em>enacted</em> pubblicato dalla
          Legge di Bilancio (competenza, primo anno): non è né una misura della manovra (un fondo,
          un bonus, un&apos;aliquota nominati nel testo di legge) né un pagamento realmente
          effettuato.
        </p>
      </div>

      {series ? (
        <SimulatoreClient
          years={series.years}
          missions={series.missions}
          allocations={series.allocations}
        />
      ) : (
        <div className={styles.errorState} role="alert">
          <strong>Dati OpenBDAP non raggiungibili in questo momento.</strong>
          <p>Non mostriamo una serie dimostrativa al posto del dato mancante. Dettaglio: {errorMessage ?? "non disponibile"}.</p>
        </div>
      )}

      {series ? (
        <div className={styles.provenance}>
          <h2>Fonte e provenienza</h2>
          <dl>
            <div>
              <dt>Fonte</dt>
              <dd>Ragioneria Generale dello Stato (RGS) · OpenBDAP</dd>
            </div>
            <div>
              <dt>Dataset</dt>
              <dd>{series.dataset.title}</dd>
            </div>
            <div>
              <dt>Licenza</dt>
              <dd>{series.dataset.license ?? "non dichiarata dal catalogo"}</dd>
            </div>
            <div>
              <dt>Catalogo aggiornato il</dt>
              <dd>{longDate(series.dataset.metadataModified)}</dd>
            </div>
            <div>
              <dt>Acquisito il</dt>
              <dd>{longDate(series.observedAt)}</dd>
            </div>
            <div>
              <dt>Copertura mostrata</dt>
              <dd>
                {series.years[0]}-{series.years.at(-1)} (la tassonomia delle missioni è stabile solo
                dal {series.minStableMissionYear}: gli anni precedenti non sono confrontabili e restano fuori)
              </dd>
            </div>
          </dl>
          <p className={styles.provenanceLinks}>
            <a href={series.dataset.csvUrl} target="_blank" rel="noreferrer">
              Scarica il CSV RGS ↗
            </a>
            {" · "}
            <a href={series.dataset.apiUrl} target="_blank" rel="noreferrer">
              Apri il pacchetto sul catalogo OpenBDAP ↗
            </a>
          </p>
        </div>
      ) : null}

      <div className="notice">
        <strong>Cosa questo simulatore non dimostra</strong>
        <p>
          Non individua una misura specifica della manovra (un fondo, un bonus, un&apos;aliquota
          nominati nel testo di legge): quella lettura riga per riga richiede fonti come UPB o
          Corte dei Conti e non è quello che facciamo qui. Il valore osservato è lo stanziamento
          enacted, non un pagamento: per la spesa effettivamente pagata vedi{" "}
          <Link href="/stato">Spese dello Stato</Link> e{" "}
          <Link href="/stato/legislature">Spesa per legislatura</Link>. La missione &laquo;Debito
          pubblico&raquo; include il rimborso lordo del debito, che ne domina l&apos;importo
          indipendentemente dalle scelte di policy dell&apos;anno.
        </p>
      </div>
    </main>
  );
}
