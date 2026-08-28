"use client";

import type { Plan } from "./reallocation";
import { shortLabel, toneColor } from "./reallocation";
import styles from "./simulatore.module.css";

const compactEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function signedCompactEuro(value: number): string {
  return `${value >= 0 ? "+" : "−"}${compactEuro.format(Math.abs(value))}`;
}

function signedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

/**
 * Barra fissa in basso: mentre costruisci la manovra hai sempre sotto mano la
 * voce selezionata, il ritocco rapido e il saldo corrente, senza scrollare.
 */
export function BuilderHud({
  selectedMission,
  selectedPct,
  onStep,
  plan,
  onShare,
}: {
  selectedMission: string;
  selectedPct: number;
  onStep: (deltaPct: number) => void;
  plan: Plan;
  onShare: () => void;
}) {
  const hasScenario = plan.entries.length > 0;

  return (
    <div className={styles.hud} role="region" aria-label="Stato della tua manovra">
      <div className={styles.hudMission}>
        <span className={styles.hudMissionName}>{shortLabel(selectedMission)}</span>
        {selectedPct !== 0 ? (
          <b style={{ color: toneColor(selectedPct) }}>{signedPercent(selectedPct)}</b>
        ) : null}
      </div>

      <div className={styles.hudStepper}>
        <button
          type="button"
          className={styles.hudStep}
          onClick={() => onStep(-5)}
          aria-label={`Riduci ${shortLabel(selectedMission)} di 5 punti`}
        >
          −
        </button>
        <span className={styles.hudStepValue}>{signedPercent(selectedPct)}</span>
        <button
          type="button"
          className={styles.hudStep}
          onClick={() => onStep(5)}
          aria-label={`Aumenta ${shortLabel(selectedMission)} di 5 punti`}
        >
          +
        </button>
      </div>

      <div className={styles.hudStatus}>
        {hasScenario ? (
          <>
            <span className={styles.hudStatusLabel}>
              Saldo · {plan.entries.length} {plan.entries.length === 1 ? "voce" : "voci"}
            </span>
            <b style={{ color: toneColor(plan.net) }}>{signedCompactEuro(plan.net)}</b>
          </>
        ) : (
          <span className={styles.hudStatusHint}>Tocca − / + su un riquadro per iniziare</span>
        )}
      </div>

      <button
        type="button"
        className={`btn btn-primary ${styles.hudShare}`}
        onClick={onShare}
        disabled={!hasScenario}
      >
        Condividi
      </button>
    </div>
  );
}
