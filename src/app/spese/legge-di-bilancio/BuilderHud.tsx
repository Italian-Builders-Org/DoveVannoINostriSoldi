"use client";

import type { Plan } from "./reallocation";
import { netToneColor, shortLabel, toneColor } from "./reallocation";
import styles from "./simulatore.module.css";

/** Ritocco fine dell'HUD: 1 punto per click, come lo step dello slider. */
const HUD_STEP_PCT = 1;

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
  hidden = false,
}: {
  selectedMission: string;
  selectedPct: number;
  onStep: (deltaPct: number) => void;
  plan: Plan;
  onShare: () => void;
  /** Nascosta quando il grafico + slider sono a schermo: lì lo stepper è ridondante. */
  hidden?: boolean;
}) {
  const hasScenario = plan.entries.length > 0;

  return (
    <div
      className={`${styles.hud} ${hidden ? styles.hudHidden : ""}`}
      role="region"
      aria-label="Stato della tua manovra"
      aria-hidden={hidden}
      inert={hidden}
    >
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
          onClick={() => onStep(-HUD_STEP_PCT)}
          aria-label={`Riduci ${shortLabel(selectedMission)} di ${HUD_STEP_PCT} punto`}
        >
          −
        </button>
        <span className={styles.hudStepValue}>{signedPercent(selectedPct)}</span>
        <button
          type="button"
          className={styles.hudStep}
          onClick={() => onStep(HUD_STEP_PCT)}
          aria-label={`Aumenta ${shortLabel(selectedMission)} di ${HUD_STEP_PCT} punto`}
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
            <b style={{ color: netToneColor(plan.net) }}>{signedCompactEuro(plan.net)}</b>
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
        Condividi la finanziaria
      </button>
    </div>
  );
}
