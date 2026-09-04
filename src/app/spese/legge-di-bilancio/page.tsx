import type { Metadata } from "next";
import Link from "next/link";
import { longDate } from "@/lib/format";
import {
  DEFAULT_BUDGET_LAW_WINDOW_YEARS,
  getBudgetLawMissionSeries,
  type BudgetLawMissionSeries,
} from "@/lib/bdap-legge-bilancio";
import { SimulatoreClient } from "./SimulatoreClient";
import { decodePiano, orderedMissionList } from "./piano-codec";
import styles from "./simulatore.module.css";

export const dynamic = "force-dynamic";

const BASE_DESCRIPTION =
  "Variazione anno su anno dello stanziamento pubblicato per missione nelle ultime Leggi di Bilancio, con uno scenario ipotetico costruito dall'utente.";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ piano?: string | string[] }>;
}): Promise<Metadata> {
  const { piano } = await searchParams;
  const touched = typeof piano === "string" ? piano.split(",").filter(Boolean).length : 0;

  if (touched > 0) {
    return {
      title: "La mia proposta di Legge di Bilancio",
      description: `E se la prossima Legge di Bilancio la scrivessi tu? Una proposta di riallocazione su ${touched} ${
        touched === 1 ? "missione" : "missioni"
      }: aprila, modificala e fai la tua.`,
    };
  }

  return { title: "E se la Legge di Bilancio la scrivessi tu?", description: BASE_DESCRIPTION };
}

export default async function LeggeDiBilancioPage({
  searchParams,
}: {
  searchParams: Promise<{ piano?: string | string[] }>;
}) {
  const { piano } = await searchParams;

  let series: BudgetLawMissionSeries | null = null;

  try {
    series = await getBudgetLawMissionSeries({
      windowYears: DEFAULT_BUDGET_LAW_WINDOW_YEARS,
      signal: AbortSignal.timeout(8_000),
      fallbackOnAbort: true,
    });
  } catch {}

  return (
    <main className={`shell page ${styles.page}`}>
      <nav className={styles.breadcrumb} aria-label="Percorso">
        <Link href="/">Home</Link>
        <span>→</span>
        <Link href="/spese">Soldi</Link>
        <span>→</span>
        <span>Legge di Bilancio</span>
      </nav>

      <header className="page-intro">
        <h1>E se la Legge di Bilancio la scrivessi tu?</h1>
        <p>
          Lo stanziamento di competenza pubblicato dalla Legge di Bilancio per ciascuna missione,
          anno su anno (fonte RGS/OpenBDAP): scegli una voce, spostala e costruisci il tuo scenario.
        </p>
      </header>

      <section className={styles.howto} aria-label="Come si usa il simulatore">
        <p className={styles.howtoLead}>Costruisci il tuo scenario di riallocazione</p>
        <ol className={styles.howtoSteps}>
          <li>
            <span>1</span> Tocca − / + su un riquadro del treemap per aumentarlo o tagliarlo
          </li>
          <li>
            <span>2</span> La barra in basso segue il saldo netto della tua manovra
          </li>
          <li>
            <span>3</span> Quando sei soddisfatto, condividi la tua proposta
          </li>
        </ol>
      </section>

      {series?.dataMode === "snapshot" ? (
        <div className="notice warning-notice" role="status">
          <strong>OpenBDAP non ha risposto durante questa visita</strong>
          <p>
            Mostriamo l&apos;ultimo snapshot verificato, acquisito il {longDate(series.observedAt)}.
            Sono dati ufficiali RGS, non una serie dimostrativa; la data resta visibile anche nella
            provenienza qui sotto.
          </p>
        </div>
      ) : null}

      {series ? (
        <SimulatoreClient
          years={series.years}
          missions={series.missions}
          allocations={series.allocations}
          initialScenario={decodePiano(piano, orderedMissionList(series.missions))}
        />
      ) : (
        <div className={styles.errorState} role="alert">
          <strong>Dati OpenBDAP non raggiungibili in questo momento.</strong>
          <p>
            Non mostriamo una serie dimostrativa al posto del dato mancante. Riprova più tardi.
          </p>
        </div>
      )}

      {series ? (
        <div className="notice warning-notice">
          <strong>Nessun valore simulato è un dato reale</strong>
          <p>
            Lo scenario che costruisci con lo slider è un&apos;ipotesi tua, non una proiezione
            ufficiale né un annuncio di governo: nel treemap, nel grafico e nella tabella è sempre
            disegnato con una trama a righe e marcato &laquo;ipotesi&raquo;, mai come lo stanziamento
            osservato, e un solo bottone rimette tutto sul dato pubblicato. Il dato osservato è solo
            lo stanziamento <em>enacted</em> pubblicato dalla Legge di Bilancio (competenza, primo
            anno): non è né una misura della manovra (un fondo, un bonus, un&apos;aliquota nominati
            nel testo di legge) né un pagamento realmente effettuato.
          </p>
        </div>
      ) : null}

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
              <dd>
                <a href={series.dataset.licenseUrl} target="_blank" rel="noreferrer">
                  {series.dataset.license} ↗
                </a>
              </dd>
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

      {series ? (
        <div className="notice">
          <strong>Come leggere il treemap</strong>
          <p>
            Ogni riquadro è una missione: più è grande, più pesa sullo stanziamento pubblicato
            (somma su tutte le amministrazioni). Il numero sotto il nome è la variazione dello
            stanziamento pubblicato rispetto all&apos;anno prima. Quando sposti lo slider, le voci
            che tocchi restano segnate con una trama a righe e il treemap si ridisegna sulla nuova
            ripartizione; &laquo;Ricomincia&raquo; azzera lo scenario.
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
