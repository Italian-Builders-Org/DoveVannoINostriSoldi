"use client";

import { useMemo, useState } from "react";
import type { ParliamentChamber, ParliamentStatement } from "@/lib/data/parliament-contract";
import styles from "./parlamento.module.css";

const amount = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  useGrouping: "always",
});

const componentAmount = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  useGrouping: "always",
});

const valueLabels: Record<string, string> = {
  totalCommitments: "Impegni totali",
  effectiveCommitments: "Impegni per la spesa effettiva",
  effectivePayments: "Pagamenti per la spesa effettiva",
  finalAdministrationSurplus: "Avanzo finale di amministrazione",
  annualStateContribution: "Contributo / dotazione dello Stato",
  plannedExpenditure: "Spesa effettiva prevista",
  functioningExpenditure: "Spesa di funzionamento prevista",
  plannedRevenue: "Entrate previste",
  plannedOutlaysIncludingClearing: "Uscite previste con partite di giro",
};

function millionEuro(value: number): string {
  return `${amount.format(value)} mln €`;
}

function componentMillionEuro(value: number): string {
  return `${componentAmount.format(value)} mln €`;
}

function statementValue(statement: ParliamentStatement, key: string): number | null {
  return statement.values?.[key] ?? null;
}

function sortStatements(statements: ParliamentStatement[]): ParliamentStatement[] {
  return statements.slice().sort((left, right) => {
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    return right.year - left.year;
  });
}

function isEndowment(statement: ParliamentStatement): boolean {
  return statement.title.toLocaleLowerCase("it-IT").includes("serie della dotazione");
}

function StatementCard({ statement }: { statement: ParliamentStatement }) {
  const isAccount = statement.kind === "account";
  const mainValue = isAccount
    ? statementValue(statement, "effectivePayments") ??
      statementValue(statement, "effectiveCommitments")
    : statementValue(statement, "plannedExpenditure") ??
      statementValue(statement, "annualStateContribution");
  const items = isAccount ? statement.categories : statement.highlights;
  const maximum = Math.max(
    1,
    ...(items?.map((item) => ("paid" in item ? item.paid : item.value)) ?? []),
  );
  const endowmentSeries = isEndowment(statement);

  return (
    <article className="panel">
      <div className={styles.statementHeader}>
        <div>
          <span>
            {isAccount ? "Spese registrate" : endowmentSeries ? "Serie ufficiale" : "Spese previste"}
          </span>
          <h3>{statement.title}</h3>
        </div>
        <strong>{mainValue === null ? "Dato non disponibile" : millionEuro(mainValue)}</strong>
      </div>

      <p className={styles.meaning}>{statement.meaning}</p>

      {statement.values ? (
        <dl className={styles.values}>
          {Object.entries(statement.values).map(([key, value]) => (
            <div key={key}>
              <dt>{valueLabels[key] ?? key}</dt>
              <dd>{millionEuro(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {items && items.length > 0 ? (
        <div className={styles.breakdown}>
          <h4>
            {isAccount
              ? "Per cosa sono stati pagati"
              : endowmentSeries
                ? "Dotazione per anno"
                : "Alcune voci previste"}
          </h4>
          <ul>
            {items.map((item) => {
              const value = "paid" in item ? item.paid : item.value;
              return (
                <li key={item.id}>
                  <div>
                    <span>{item.label}</span>
                    <strong>{millionEuro(value)}</strong>
                  </div>
                  {!endowmentSeries ? (
                    <i style={{ width: `${Math.max(2, (value / maximum) * 100)}%` }} />
                  ) : null}
                  {"components" in item && item.components ? (
                    <dl className={styles.categoryComponents}>
                      {item.components.map((component) => (
                        <div key={component.id}>
                          <dt>{component.label}</dt>
                          <dd>{componentMillionEuro(component.paid)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {"caveat" in item && item.caveat ? (
                    <p className={styles.categoryCaveat}>{item.caveat}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <a className={styles.documentLink} href={statement.documentUrl} target="_blank" rel="noreferrer">
        Leggi il documento ufficiale ↗
      </a>
    </article>
  );
}

function ChamberSection({ chamber }: { chamber: ParliamentChamber }) {
  return (
    <section className={styles.chamber}>
      <header className={styles.chamberHeader}>
        <div>
          <span>Dati ufficiali</span>
          <h2>{chamber.name}</h2>
        </div>
        <a href={chamber.landingUrl} target="_blank" rel="noreferrer">
          Apri la pagina ufficiale ↗
        </a>
      </header>
      <div className={styles.statementGrid}>
        {sortStatements(chamber.statements).map((statement) => (
          <StatementCard
            key={`${statement.kind}-${statement.year}-${statement.title}`}
            statement={statement}
          />
        ))}
      </div>
    </section>
  );
}

function statementYears(chambers: ParliamentChamber[]): number[] {
  const years = new Set<number>();
  for (const chamber of chambers) {
    for (const statement of chamber.statements) {
      if (isEndowment(statement)) continue;
      years.add(statement.year);
    }
  }
  return [...years].sort((left, right) => right - left);
}

function filterChamber(chamber: ParliamentChamber, year: number | "all"): ParliamentChamber {
  if (year === "all") return chamber;
  return {
    ...chamber,
    statements: chamber.statements.filter(
      (statement) => !isEndowment(statement) && statement.year === year,
    ),
  };
}

export function ParliamentYearFilter({ chambers }: { chambers: ParliamentChamber[] }) {
  const years = useMemo(() => statementYears(chambers), [chambers]);
  const [year, setYear] = useState<number | "all">(years[0] ?? "all");

  const filteredChambers = useMemo(
    () =>
      chambers
        .map((chamber) => filterChamber(chamber, year))
        .filter((chamber) => chamber.statements.length > 0),
    [chambers, year],
  );

  return (
    <div className={styles.yearFilter}>
      <div className={styles.yearFilterControls}>
        <label htmlFor="parlamento-anno">
          Anno da consultare
          <select
            id="parlamento-anno"
            value={year === "all" ? "all" : String(year)}
            onChange={(event) => {
              const value = event.target.value;
              setYear(value === "all" ? "all" : Number(value));
            }}
          >
            <option value="all">Tutti gli anni</option>
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <p>
          {year === "all"
            ? "Mostra tutti i documenti strutturati disponibili."
            : `Dettaglio per il ${year}: totali e, dove estratti, ripartizione per categoria.`}
        </p>
      </div>
      {year !== "all" && filteredChambers.length === 0 ? (
        <p className={styles.plainText}>Nessun documento strutturato per l&apos;anno selezionato.</p>
      ) : null}
      {filteredChambers.map((chamber) => (
        <ChamberSection key={`${chamber.id}-${year}`} chamber={chamber} />
      ))}
    </div>
  );
}
