import { SpendingHistoryChart } from "@/components/charts/spending-history-chart";
import {
  getStateSpendingHistory,
  type StateSpendingHistory,
} from "@/lib/bdap-history";
import styles from "./state-spending-history-section.module.css";

const observedAtFormatter = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Rome",
});

function compactEuro(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mld €`;
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mln €`;
  }
  return `${value.toLocaleString("it-IT", { maximumFractionDigits: 0 })} €`;
}

async function loadHistory(): Promise<StateSpendingHistory | null> {
  try {
    return await getStateSpendingHistory();
  } catch {
    return null;
  }
}

function HistoryUnavailable() {
  return (
    <section className={styles.section}>
      <div className={styles.error}>
        <strong>Lo storico non è disponibile in questo momento.</strong>
        <p>
          OpenBDAP non ha restituito dati mensili utilizzabili. Gli altri numeri della pagina
          provengono comunque dai file ufficiali indicati sopra.
        </p>
      </div>
    </section>
  );
}

export function StateSpendingHistoryFallback() {
  return (
    <section className={styles.section} aria-busy="true">
      <div className={styles.header}>
        <div>
          <span>SPESA MESE PER MESE</span>
          <h2>Caricamento dei dati mensili RGS...</h2>
        </div>
      </div>
      <div className={styles.loadingGrid} aria-hidden="true">
        <div />
        <div />
      </div>
    </section>
  );
}

export async function StateSpendingHistorySection() {
  const history = await loadHistory();
  if (!history || history.points.length === 0) return <HistoryUnavailable />;

  const latest = history.points.at(-1);
  const monthlyPoints = history.points.filter(
    (point): point is typeof point & { monthlyPaid: number } => point.monthlyPaid !== null,
  );
  const maxMonth = monthlyPoints.reduce(
    (maximum, point) => point.monthlyPaid > maximum.monthlyPaid ? point : maximum,
    monthlyPoints[0],
  );
  const averageMonthly = latest ? latest.cumulativePaid / latest.month : 0;
  const hasMissingMonths = history.coverage.missingMonths.length > 0;

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <span>SPESA MESE PER MESE · RGS / OPENBDAP</span>
          <h2>Come cambiano i pagamenti durante l&apos;anno</h2>
        </div>
        <p>
          RGS pubblica il totale dal 1° gennaio al mese indicato. Per ottenere il valore del
          singolo mese sottraiamo due totali consecutivi.
        </p>
      </div>

      <div className={styles.metrics}>
        <div>
          <span>Ultimo mese disponibile</span>
          <strong>{latest?.monthlyPaid === null || !latest ? "Non calcolabile" : compactEuro(latest.monthlyPaid)}</strong>
          <small>{latest ? `${latest.monthName} ${latest.year}` : "Dato non disponibile"}</small>
        </div>
        <div>
          <span>Media mensile da gennaio</span>
          <strong>{compactEuro(averageMonthly)}</strong>
          <small>Totale da gennaio diviso {latest?.month ?? history.points.length} mesi</small>
        </div>
        <div>
          <span>Mese con più pagamenti</span>
          <strong>{maxMonth ? compactEuro(maxMonth.monthlyPaid) : "Non calcolabile"}</strong>
          <small>{maxMonth?.monthName ?? "Servono due mesi consecutivi"}</small>
        </div>
      </div>

      <SpendingHistoryChart data={history.points} />

      {hasMissingMonths && (
        <p className={styles.coverageNote}>
          Storico parziale: OpenBDAP non ha restituito {history.coverage.missingMonths.join(", ").toLocaleLowerCase("it-IT")}.
          I mesi mancanti non sono stati stimati.
        </p>
      )}

      <div className={styles.methodology}>
        <div>
          <span>Metodo</span>
          <strong>Totale del mese meno totale del mese precedente</strong>
        </div>
        <div>
          <span>Semantica ufficiale</span>
          <a href={history.methodology.officialSemanticsUrl} target="_blank" rel="noreferrer">
            RGS: pagamenti dal 1° gennaio al mese indicato ↗
          </a>
        </div>
        <div>
          <span>Controllato</span>
          <strong>{observedAtFormatter.format(new Date(history.observedAt))}</strong>
        </div>
      </div>
    </section>
  );
}
