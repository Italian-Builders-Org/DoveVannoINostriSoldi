import {
  getPublishedStateConsuntivoYears,
  getStateSpendingTotalsForYears,
  STATE_SPENDING_HISTORY_MAX_CONCURRENCY,
  type StateAnnualSpendingTotal,
} from "@/lib/bdap-payments";

/**
 * Official general-election (Camera dei Deputati) dates and the legislatures they open/close.
 * Sources: Camera dei Deputati (camera.it) and Ministero dell'Interno (interno.gov.it).
 * Only legislatures whose years fall inside the OpenBDAP annual consuntivo coverage
 * (2014-2025, verified live) are listed; earlier/later legislatures are out of scope
 * until that coverage window changes.
 */
export type Legislature = {
  /** Roman-numeral legislature number. */
  number: string;
  /** ISO date the legislature was elected (election day, Camera dei Deputati). */
  electionDate: string;
  /** ISO date the legislature's first joint session opened. */
  startDate: string;
  /** ISO date the legislature ended (next election day), or null if still in progress. */
  endDate: string | null;
  source: { label: string; url: string };
};

export const LEGISLATURES: readonly Legislature[] = [
  {
    number: "XVII",
    electionDate: "2013-02-24",
    startDate: "2013-03-15",
    endDate: "2018-03-22",
    source: { label: "Camera dei Deputati, XVII legislatura", url: "https://www.camera.it/leg17/1" },
  },
  {
    number: "XVIII",
    electionDate: "2018-03-04",
    startDate: "2018-03-23",
    endDate: "2022-10-12",
    source: { label: "Camera dei Deputati, XVIII legislatura", url: "https://www.camera.it/leg18/1398" },
  },
  {
    number: "XIX",
    electionDate: "2022-09-25",
    startDate: "2022-10-13",
    endDate: null,
    source: { label: "Camera dei Deputati, XIX legislatura", url: "https://www.camera.it/leg19/1" },
  },
];

/**
 * Calendar years fully covered by a legislature's own budget cycle: excludes the partial
 * first year (the legislature is seated mid-year) and the year of the election that ends
 * it (`nextElectionYear`), since that year's budget only partly reflects this legislature.
 *
 * `latestObservedYear` is the most recent year whose annual consuntivo is published in the
 * OpenBDAP catalog. It bounds only a legislature still in progress (`nextElectionYear`
 * null): that legislature has no known end and no pre-election year, so it exposes the
 * complete years already observed instead of an empty list. A legislature that has ended
 * keeps its exact expected window, so a missing release there stays a visible error rather
 * than silently shrinking the term. Exported so this boundary arithmetic is unit-tested
 * against synthetic legislatures, including edge cases (a single-year term, or a catalog
 * that has not published any year yet) the three real ones never happen to exercise.
 */
export function fullYearsWithinLegislature(
  legislature: Legislature,
  nextElectionYear: number | null,
  latestObservedYear: number | null,
): number[] {
  const startYear = Number(legislature.startDate.slice(0, 4));
  const firstFullYear = startYear + 1;
  const lastFullYear = nextElectionYear !== null ? nextElectionYear - 1 : latestObservedYear;
  if (lastFullYear === null || lastFullYear < firstFullYear) return [];
  const years: number[] = [];
  for (let year = firstFullYear; year <= lastFullYear; year += 1) years.push(year);
  return years;
}

/**
 * Years in which the State enacted extraordinary, documented spending measures unrelated
 * to any election calendar. This states what was enacted, not how much of that year's total
 * it explains: the comparison below cannot isolate its share from other factors.
 */
const EXTRAORDINARY_CONTEXT: Readonly<Record<number, string>> = {
  2020: "Coincide con il periodo delle misure emergenziali COVID-19; il loro contributo a questo totale non è isolato né quantificato.",
  2021: "Coincide con il periodo delle misure emergenziali COVID-19; il loro contributo a questo totale non è isolato né quantificato.",
};

export type LegislatureYearSpending = {
  year: number;
  totalPaid: number;
  isPreElectionYear: boolean;
  extraordinaryContext: string | null;
  source: {
    packageId: string;
    packageUrl: string;
    csvUrl: string;
    metadataModified: string | null;
    releaseKind: "consuntivo";
  };
};

export type LegislatureSpendingCycle = {
  legislature: Legislature;
  /**
   * Calendar years with a complete OpenBDAP consuntivo release, excluding the partial first
   * and the election year. A legislature still in progress lists the years observed so far.
   */
  years: LegislatureYearSpending[];
  /** Arithmetic mean of every year in `years` except the pre-election year itself. */
  otherYearsAverage: number | null;
  /** The legislature's last complete year, or null while its election has not happened yet. */
  preElectionYear: LegislatureYearSpending | null;
  /** `preElectionYear.totalPaid - otherYearsAverage`, purely descriptive; not a significance test. */
  differenceFromAverage: number | null;
};

const MIN_CONSUNTIVO_YEAR = 2014;
export const LEGISLATURE_SPENDING_DEADLINE_MS = 50_000;

type TotalsLoader = (
  years: readonly number[],
  options: { signal?: AbortSignal; concurrency?: number },
) => Promise<Map<number, StateAnnualSpendingTotal>>;

type PublishedYearsLoader = (options: { signal?: AbortSignal }) => Promise<number[]>;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Operazione OpenBDAP annullata");
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortReason(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * Builds a purely descriptive per-legislature comparison of the pre-election year's
 * total state spending (OpenBDAP RGS consuntivo, missione) against the average of the
 * legislature's other complete years. Does not compute or claim statistical significance,
 * does not attribute the difference to electoral motive, and flags known confounding
 * years (COVID-19 emergency spending) explicitly instead of silently averaging over them.
 * A legislature still in progress is reported with the complete years OpenBDAP has already
 * published and no pre-election year, instead of being shown as if it had no spending at all.
 */
export async function getLegislatureSpendingCycles(
  options: {
    signal?: AbortSignal;
    deadlineMs?: number;
    /** Deterministic test seam; production reads the live OpenBDAP catalog. */
    loadPublishedYears?: PublishedYearsLoader;
    /** Deterministic test seam; production uses the OpenBDAP batch reader. */
    loadTotals?: TotalsLoader;
  } = {},
): Promise<LegislatureSpendingCycle[]> {
  const requestedDeadline = options.deadlineMs ?? LEGISLATURE_SPENDING_DEADLINE_MS;
  if (!Number.isFinite(requestedDeadline) || requestedDeadline <= 0) {
    throw new Error("Budget temporale OpenBDAP non valido");
  }
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(
    () => deadlineController.abort(new DOMException("Budget temporale OpenBDAP esaurito", "TimeoutError")),
    Math.trunc(requestedDeadline),
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadlineController.signal])
    : deadlineController.signal;

  try {
    const publishedYears = await withAbort(
      Promise.resolve().then(() =>
        (options.loadPublishedYears ?? getPublishedStateConsuntivoYears)({ signal }),
      ),
      signal,
    );
    const latestObservedYear = publishedYears.length > 0 ? Math.max(...publishedYears) : null;
    const plans = LEGISLATURES.map((legislature, index) => {
      const next = LEGISLATURES[index + 1];
      const nextElectionYear = next ? Number(next.electionDate.slice(0, 4)) : null;
      return {
        legislature,
        nextElectionYear,
        candidateYears: fullYearsWithinLegislature(
          legislature,
          nextElectionYear,
          latestObservedYear,
        ).filter((year) => year >= MIN_CONSUNTIVO_YEAR),
      };
    });
    const allYears = plans.flatMap((plan) => plan.candidateYears);
    const totals = await withAbort(
      Promise.resolve().then(() =>
        (options.loadTotals ?? getStateSpendingTotalsForYears)(allYears, {
          signal,
          concurrency: STATE_SPENDING_HISTORY_MAX_CONCURRENCY,
        }),
      ),
      signal,
    );

    return plans.map(({ legislature, nextElectionYear, candidateYears }) => {
      // Only a truly empty range skips the fetch entirely (nothing to show): that means a
      // legislature whose full years all predate the OpenBDAP annual coverage, or one still
      // in progress before the first complete year is published. A legislature with exactly
      // one full year still gets fetched and shown as real data further below; it simply ends
      // up with no otherYearsAverage/differenceFromAverage to compare against (computed further
      // down, not hardcoded here) rather than being hidden as if OpenBDAP had nothing for it.
      if (candidateYears.length === 0) {
        return {
          legislature,
          years: [],
          otherYearsAverage: null,
          preElectionYear: null,
          differenceFromAverage: null,
        };
      }

      // A legislature still in progress has no election closing it yet, so its last
      // complete year is simply the most recent one published: nothing is tagged as
      // pre-election and no average is compared against it.
      const preElectionYearNumber = nextElectionYear === null ? null : Math.max(...candidateYears);
      const years = candidateYears.map((year): LegislatureYearSpending => {
        const annual = totals.get(year);
        if (!annual) throw new Error(`Totale OpenBDAP mancante per il ${year}`);
        return {
          year,
          totalPaid: annual.totalPaid,
          isPreElectionYear: year === preElectionYearNumber,
          extraordinaryContext: EXTRAORDINARY_CONTEXT[year] ?? null,
          source: {
            packageId: annual.source.packageId,
            packageUrl: annual.source.apiUrl,
            csvUrl: annual.source.csvUrl,
            metadataModified: annual.source.metadataModified,
            releaseKind: annual.source.releaseKind,
          },
        };
      });

      const preElectionYear = years.find((entry) => entry.isPreElectionYear) ?? null;
      const otherYears = preElectionYear
        ? years.filter((entry) => !entry.isPreElectionYear)
        : [];
      const otherYearsAverage =
        otherYears.length > 0
          ? otherYears.reduce((total, entry) => total + entry.totalPaid, 0) / otherYears.length
          : null;
      const differenceFromAverage =
        preElectionYear && otherYearsAverage !== null
          ? preElectionYear.totalPaid - otherYearsAverage
          : null;

      return { legislature, years, otherYearsAverage, preElectionYear, differenceFromAverage };
    });
  } finally {
    clearTimeout(deadlineTimer);
  }
}
