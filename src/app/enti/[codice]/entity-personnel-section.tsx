import Link from "next/link";
import { formatStaffCount, formatStaffDelta } from "@/lib/rgs-conto-annuale-occupazione-format";
import {
  getOccupazioneInstitutionSummary,
  resolveInstitutionCodeFromDenominazione,
} from "@/lib/rgs-conto-annuale-occupazione-resolve";
import styles from "./scheda.module.css";

export function EntityPersonnelSection({
  denominazione,
}: {
  denominazione: string;
}) {
  const code = resolveInstitutionCodeFromDenominazione(denominazione);
  if (!code) return null;
  const summary = getOccupazioneInstitutionSummary(code);
  if (!summary) return null;

  return (
    <section className={`panel ${styles.economicSection}`} aria-labelledby="personale-conto-annuale">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.sectionKicker}>RGS · Conto Annuale</span>
          <h2 className={styles.sectionTitle} id="personale-conto-annuale">Personale PA 2010-2024</h2>
        </div>
      </div>
      <p>
        Personale al 31 dicembre pubblicato da RGS/OpenBDAP (2010-2024), distinto da incassi SIOPE e da costo del lavoro.
      </p>
      <dl className={styles.identityStrip}>
        <div>
          <dt>Personale · 2024</dt>
          <dd>{formatStaffCount(summary.permanentLatest)} persone</dd>
        </div>
        {summary.permanentBaseline !== null ? (
          <div>
            <dt>Variazione dal 2010</dt>
            <dd>{formatStaffDelta(summary.permanentLatest - summary.permanentBaseline)} persone</dd>
          </div>
        ) : null}
        <div>
          <dt>Lavoro flessibile · 2024</dt>
          <dd>{formatStaffCount(summary.flexibleLatest)} unità annue</dd>
        </div>
      </dl>
      <p>
        <Link href={`/personale-pa/conto-annuale/${summary.code}`}>Serie completa 2010-2024 →</Link>
      </p>
    </section>
  );
}
