import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { LEGISLATURES, getLegislatureSpendingCycles, fullYearsWithinLegislature } = await import(
  "../src/lib/state-spending-legislature.ts"
);
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");

// Annual consuntivi for the requested years only, so a test never returns a total for a
// year the code under test did not ask for.
const totalsFor = (years) => new Map(years.map((year) => [year, {
  year,
  totalPaid: year * 1_000_000,
  source: {
    dimension: "mission",
    productCode: "PBS_SPE_RND_MIS_ANN",
    packageId: `package-${year}`,
    name: `package-${year}`,
    title: `Consuntivo ${year}`,
    notes: "",
    referenceYear: year,
    metadataModified: `${year}-12-31T00:00:00Z`,
    csvUrl: `https://bdap-opendata.rgs.mef.gov.it/${year}.csv`,
    apiUrl: `https://bdap-opendata.rgs.mef.gov.it/${year}`,
    releaseKind: "consuntivo",
    referenceMonth: null,
  },
}]));

test("legislature page uses the shared persistent OpenBDAP cache", () => {
  const page = readFileSync("src/app/stato/legislature/page.tsx", "utf8");
  assert.match(page, /getCachedLegislatureSpendingCycles\(\)/);
  assert.match(page, /export const maxDuration = 60/);
});

test("legislature dates are chronological and complete legislatures have a known end", () => {
  for (let index = 1; index < LEGISLATURES.length; index += 1) {
    const previous = LEGISLATURES[index - 1];
    const current = LEGISLATURES[index];
    assert.ok(
      new Date(previous.electionDate).getTime() < new Date(current.electionDate).getTime(),
      `${previous.number} -> ${current.number} deve essere in ordine cronologico`,
    );
  }
  const ongoing = LEGISLATURES.filter((legislature) => legislature.endDate === null);
  assert.equal(ongoing.length, 1, "una sola legislatura può essere in corso");
  assert.equal(ongoing[0].number, LEGISLATURES.at(-1).number);
});

test("fullYearsWithinLegislature excludes the partial seating year and the election year that ends it", () => {
  const legislature = { number: "TEST", electionDate: "2013-02-24", startDate: "2013-03-15", endDate: "2018-03-22", source: { label: "", url: "" } };
  assert.deepEqual(fullYearsWithinLegislature(legislature, 2018, 2025), [2014, 2015, 2016, 2017]);
});

test("fullYearsWithinLegislature keeps a closed term's exact window even past the observed years", () => {
  // A missing release inside a closed term must surface as an error, not shrink the term.
  const legislature = { number: "TEST", electionDate: "2013-02-24", startDate: "2013-03-15", endDate: "2018-03-22", source: { label: "", url: "" } };
  assert.deepEqual(fullYearsWithinLegislature(legislature, 2018, 2015), [2014, 2015, 2016, 2017]);
});

test("fullYearsWithinLegislature exposes the published years of a legislature still in progress", () => {
  const legislature = { number: "TEST", electionDate: "2022-09-25", startDate: "2022-10-13", endDate: null, source: { label: "", url: "" } };
  assert.deepEqual(fullYearsWithinLegislature(legislature, null, 2025), [2023, 2024, 2025]);
});

test("fullYearsWithinLegislature stops at the latest observed year while a legislature is in progress", () => {
  // OpenBDAP publishes each annual consuntivo during the following year.
  const legislature = { number: "TEST", electionDate: "2022-09-25", startDate: "2022-10-13", endDate: null, source: { label: "", url: "" } };
  assert.deepEqual(fullYearsWithinLegislature(legislature, null, 2023), [2023]);
});

test("fullYearsWithinLegislature returns no years for a legislature still in progress without a published consuntivo", () => {
  const legislature = { number: "TEST", electionDate: "2022-09-25", startDate: "2022-10-13", endDate: null, source: { label: "", url: "" } };
  assert.deepEqual(fullYearsWithinLegislature(legislature, null, null), []);
});

test("fullYearsWithinLegislature returns no years for a term too short to have a full calendar year", () => {
  // Seated in 2020, its own successor elected the following year: no year is fully its own.
  const legislature = { number: "TEST", electionDate: "2020-01-01", startDate: "2020-06-01", endDate: "2021-01-01", source: { label: "", url: "" } };
  assert.deepEqual(fullYearsWithinLegislature(legislature, 2021, 2025), []);
});

test("fullYearsWithinLegislature returns exactly one year for a two-calendar-year term", () => {
  const legislature = { number: "TEST", electionDate: "2020-01-01", startDate: "2020-06-01", endDate: "2022-01-01", source: { label: "", url: "" } };
  assert.deepEqual(fullYearsWithinLegislature(legislature, 2022, 2025), [2021]);
});

test("legislature cycles load all annual totals in one bounded batch", async () => {
  const requestedYears = [];
  const cycles = await getLegislatureSpendingCycles({
    loadConsuntivi: async () => [...totalsFor([2014, 2015, 2016, 2017, 2019, 2020, 2021, 2023, 2024, 2025]).values()].map((item) => item.source),
    loadTotals: async (years, options) => {
      requestedYears.push(years);
      assert.equal(options.concurrency, 3);
      assert.equal(options.signal.aborted, false);
      return totalsFor(years);
    },
  });
  assert.deepEqual(
    requestedYears,
    [[2014, 2015, 2016, 2017, 2019, 2020, 2021, 2023, 2024, 2025]],
    "una sola lettura batch per tutti gli anni candidati",
  );
  assert.deepEqual(cycles[0].years.map((entry) => entry.year), [2014, 2015, 2016, 2017]);
  assert.equal(cycles[1].preElectionYear.year, 2021);
  assert.equal(cycles[1].preElectionYear.source.releaseKind, "consuntivo");
  assert.equal(cycles[1].preElectionYear.source.packageId, "package-2021");
  assert.deepEqual(cycles[2].years.map((entry) => entry.year), [2023, 2024, 2025]);
});

test("a legislature still in progress exposes its published years without a pre-election comparison", async () => {
  const cycles = await getLegislatureSpendingCycles({
    // The annual consuntivo of the newest year is published during the following year, so the
    // last observed year is not simply the year before the current date.
    loadConsuntivi: async () => [...totalsFor([2014, 2015, 2016, 2017, 2019, 2020, 2021, 2023, 2024]).values()].map((item) => item.source),
    loadTotals: async (years) => totalsFor(years),
  });
  const nineteenth = cycles.find((cycle) => cycle.legislature.number === "XIX");
  assert.deepEqual(nineteenth.years.map((entry) => entry.year), [2023, 2024]);
  assert.ok(nineteenth.years.every((entry) => entry.isPreElectionYear === false));
  assert.ok(nineteenth.years.every((entry) => entry.source.releaseKind === "consuntivo"));
  assert.equal(nineteenth.preElectionYear, null);
  assert.equal(nineteenth.otherYearsAverage, null);
  assert.equal(nineteenth.differenceFromAverage, null);
});

test("a legislature still in progress stays empty until its first annual consuntivo is published", async () => {
  const requestedYears = [];
  const cycles = await getLegislatureSpendingCycles({
    loadConsuntivi: async () => [...totalsFor([]).values()].map((item) => item.source),
    loadTotals: async (years) => {
      requestedYears.push(years);
      return totalsFor(years);
    },
  });
  const nineteenth = cycles.find((cycle) => cycle.legislature.number === "XIX");
  assert.deepEqual(nineteenth.years, []);
  assert.equal(nineteenth.preElectionYear, null);
  // Closed legislatures keep asking for their exact window, so a catalog that suddenly
  // publishes nothing still fails loudly instead of silently emptying every term.
  assert.deepEqual(requestedYears, [[2014, 2015, 2016, 2017, 2019, 2020, 2021]]);
});

test("a closed legislature still reports a missing annual total as an error", async () => {
  await assert.rejects(
    getLegislatureSpendingCycles({
      loadConsuntivi: async () => [...totalsFor([2014, 2015, 2016, 2017, 2019, 2020, 2021, 2025]).values()].map((item) => item.source),
      loadTotals: async (years) => {
        const totals = totalsFor(years);
        totals.delete(2016);
        return totals;
      },
    }),
    /Totale OpenBDAP mancante per il 2016/,
  );
});

test("legislature cycles enforce one global deadline even if a loader ignores abort", async () => {
  let loaderSignal;
  await assert.rejects(
    getLegislatureSpendingCycles({
      deadlineMs: 20,
      loadConsuntivi: async () => [...totalsFor([2014, 2015, 2016, 2017, 2019, 2020, 2021, 2025]).values()].map((item) => item.source),
      loadTotals: async (_years, options) => {
        loaderSignal = options.signal;
        return new Promise(() => {});
      },
    }),
    /timeout|aborted/i,
  );
  assert.equal(loaderSignal?.aborted, true);
});

test("openbdap_spesa_legislature MCP dataset rejects any filter offline", async () => {
  await assert.rejects(
    queryPublicDataset({ dataset: "openbdap_spesa_legislature", year: 2024 }),
    /Filtri non supportati/,
  );
});

test('current legislature keeps a missing intermediate release as an explicit error', async (t) => {
  let networkCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { networkCalls++; throw Error('Unexpected download'); });
  await assert.rejects(getLegislatureSpendingCycles({
    loadConsuntivi: async () => [...totalsFor([2014,2015,2016,2017,2019,2020,2021,2023,2025]).values()].map(item => item.source),
  }), /2024/);
  assert.equal(networkCalls, 0, 'detect the catalog gap before downloading any annual data');
});

test('default legislature reader performs one catalog discovery for years and totals', async (t) => {
  const years = [2014,2015,2016,2017,2019,2020,2021,2023,2024,2025];
  let discoveries = 0;
  const downloads = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/package_search')) {
      discoveries++;
      const code = url.searchParams.get('q');
      assert.equal(code, 'PBS_SPE_RND_MISS_001');
      return Response.json({success:true,result:{results:years.map(year => ({
        id:`12345678-1234-4abc-8def-${String(year).padStart(12,'0')}`,
        name:`consuntivo-${year}`,
        title:`${year} - Pagamenti Bilancio dello Stato per Missione Consuntivo`,
        notes:`pagamenti Bilancio dello Stato per l'esercizio finanziario di riferimento - [${code}]`,
        metadata_modified:'2026-09-12T00:00:00.000000',
      }))}});
    }
    const year = Number(url.pathname.match(/(\d{12})\.csv$/)?.[1]);
    assert.ok(years.includes(year), url.pathname);
    downloads.push(year);
    return new Response([
      'Esercizio finanziario;Codice Missione;Missione;OP Erario;OP Tesoreria;OP Esterno;OA Tesoreria;OA Spesa Funz Deleg;RSF Stipendi;RSF Altro;Note Imputazione;Totale pagato',
      [year,'001','Missione',year*100,0,0,0,0,0,0,0,year*100].join(';'),
    ].join('\n'), {headers:{'content-type':'text/csv'}});
  });
  const cycles = await getLegislatureSpendingCycles();
  assert.equal(discoveries, 1);
  assert.deepEqual(downloads.sort((a,b)=>a-b), years);
  assert.deepEqual(cycles.at(-1).years.map(row=>row.year), [2023,2024,2025]);
  assert.equal(cycles.at(-1).preElectionYear, null);
});

test('reused catalog still rejects duplicate annual releases before downloads', async (t) => {
  const {getStateSpendingTotalsForYears} = await import('../src/lib/bdap-payments.ts');
  const source = totalsFor([2025]).get(2025).source;
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Unexpected download');});
  await assert.rejects(getStateSpendingTotalsForYears([2025],{datasets:[source,{...source,packageId:'duplicate'}]}), /più consuntivi/);
  assert.equal(calls,0);
});
