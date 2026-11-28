import type { IpaTypeStat } from "@/lib/ipa-stats";
import styles from "./registry-type-chart.module.css";

const integerFormatter = new Intl.NumberFormat("it-IT", { useGrouping: "always" });

// IPA publishes some type names in upper case or with an apostrophe for the
// accent. Only the spelling changes: the full name is always shown, wrapped,
// because the distinguishing part of a long type is often at its end
// ("... in Conto Economico Consolidato").
function displayLabel(label: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/^Pubbliche Amministrazioni$/i, "Pubbliche amministrazioni"],
    [/^Gestori di Pubblici Servizi$/i, "Gestori di pubblici servizi"],
    [/^Stazioni Appaltanti$/i, "Stazioni appaltanti"],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(label)) return replacement;
  }
  return label.replace(/^Societa'/i, "Società");
}

/**
 * Ranked list of IPA entity types: name on its own line, exact count beside
 * it, bar underneath. A list instead of an axis chart so long type names wrap
 * instead of being truncated, and the values are readable without hover.
 */
export function RegistryTypeChart({ data }: { data: IpaTypeStat[] }) {
  if (data.length === 0) {
    return (
      <div className={styles.empty}>
        Distribuzione non disponibile dalla fonte IPA in questo momento.
      </div>
    );
  }

  const max = Math.max(...data.map((record) => record.value), 0);

  return (
    <figure className={styles.figure}>
      <ol className={styles.list} aria-label="Enti del registro IPA per tipologia">
        {data.map((record) => {
          const width = max > 0 ? Math.max(0, Math.min(100, (record.value / max) * 100)) : 0;
          return (
            <li key={record.label}>
              <span className={styles.label}>{displayLabel(record.label)}</span>
              <strong className={styles.value}>{integerFormatter.format(record.value)}</strong>
              <i className={styles.track} aria-hidden="true">
                <b style={{ width: `${width}%` }} />
              </i>
            </li>
          );
        })}
      </ol>
      <figcaption className={styles.caption}>
        Le tipologie più presenti nel registro IPA; barre in proporzione alla più numerosa.
      </figcaption>
    </figure>
  );
}
