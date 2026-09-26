"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { ParliamentChamber } from "@/lib/data/parliament-contract";
import styles from "./parlamento.module.css";

type Props = {
  chambers: ParliamentChamber[];
  children: (args: {
    year: number | "all";
    filteredChambers: ParliamentChamber[];
    years: number[];
  }) => ReactNode;
};

function statementYears(chambers: ParliamentChamber[]): number[] {
  const years = new Set<number>();
  for (const chamber of chambers) {
    for (const statement of chamber.statements) {
      if (statement.title.toLocaleLowerCase("it-IT").includes("serie della dotazione")) {
        continue;
      }
      years.add(statement.year);
    }
  }
  return [...years].sort((left, right) => right - left);
}

function filterChamber(chamber: ParliamentChamber, year: number | "all"): ParliamentChamber {
  if (year === "all") return chamber;
  const statements = chamber.statements.filter((statement) => {
    if (statement.title.toLocaleLowerCase("it-IT").includes("serie della dotazione")) {
      return false;
    }
    return statement.year === year;
  });
  return { ...chamber, statements };
}

export function ParliamentYearFilter({ chambers, children }: Props) {
  const years = useMemo(() => statementYears(chambers), [chambers]);
  const defaultYear = years[0] ?? "all";
  const [year, setYear] = useState<number | "all">(defaultYear);

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
      {children({ year, filteredChambers, years })}
    </div>
  );
}
