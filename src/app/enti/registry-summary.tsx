import { Icon } from "@/components/icons";
import { RegistryTypeChart } from "@/components/charts/registry-type-chart";
import { integer } from "@/lib/format";
import type { IpaTypeStat } from "@/lib/ipa-stats";
import styles from "./enti.module.css";

function checkedAtLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(date);
}

// One sentence for whatever the live IPA calls did not return. Each keeps
// "non è disponibile ora": scripts/browser/recharts-interactions.mjs waits for
// that phrase when the registry is down instead of failing on a missing chart.
function missingMessage(hasTotal: boolean, hasDistribution: boolean): string | null {
  if (!hasTotal && !hasDistribution) return "Il riepilogo del registro non è disponibile ora. Riprova più tardi.";
  if (!hasTotal) return "Il totale del registro non è disponibile ora.";
  if (!hasDistribution) return "La distribuzione per tipologia non è disponibile ora.";
  return null;
}

/**
 * "Il registro IPA in numeri": the live total, when it was checked, and the
 * largest entity types. A missing value is never printed in the figure's
 * place: the figure and its date sentence are left out and one muted status
 * line says what is missing. Zero is a figure and is shown as such.
 */
export function RegistrySummary({
  total,
  observedAt,
  distribution,
}: Readonly<{
  total: number | null;
  observedAt: string | null;
  distribution: readonly IpaTypeStat[];
}>) {
  const hasTotal = total !== null;
  const checkedAt = hasTotal ? checkedAtLabel(observedAt) : null;
  const missing = missingMessage(hasTotal, distribution.length > 0);

  return (
    <>
      {hasTotal ? (
        <>
          <strong className={styles.bigNumber}>{integer(total)}</strong>
          <p className={styles.note}>
            Enti presenti nel registro.{checkedAt ? ` Controllato il ${checkedAt}.` : ""}
          </p>
        </>
      ) : null}
      {missing ? (
        <p role="status" className={styles.statusRow}>
          <Icon name="info" size={18} className={styles.statusIcon} />
          <span>{missing}</span>
        </p>
      ) : null}
      {distribution.length > 0 ? <RegistryTypeChart data={[...distribution]} /> : null}
    </>
  );
}
