import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { runLiveOpenBdap } from "./helpers/live-openbdap.mjs";

const { SSN_NATIONAL_HISTORY_YEARS, getSsnNationalHistory, nationalValuesFromRows } = await import(
  "../src/lib/ssn-national-history.ts"
);
const { ssnCceSnapshot } = await import("../src/lib/ssn-cce-snapshot.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");

test("SSN national history years are a verified, chronological 2012-2024 range", () => {
  assert.deepEqual(
    [...SSN_NATIONAL_HISTORY_YEARS],
    Array.from({ length: 13 }, (_, index) => 2012 + index),
  );
});

test(
  "SSN national history reconciles with the locked 2024 snapshot and is expressed in cents",
  // 13 sequential live OpenBDAP CSV fetches (one discovery call plus one per year); can take
  // a couple of minutes under retry per the openbdap source policy.
  { timeout: 300_000 },
  async (context) => {
    await runLiveOpenBdap(context, async () => {
      const history = await getSsnNationalHistory();
      assert.equal(history.years.length, 13);
      assert.deepEqual(history.years.map((entry) => entry.year), [...SSN_NATIONAL_HISTORY_YEARS]);

      const year2024 = history.years.find((entry) => entry.year === 2024);
      assert.ok(year2024);
      // Must match the independently locked, hash-verified 2024 snapshot exactly: same source,
      // same metrics, same unit (cents) — not a second, potentially drifting computation.
      assert.deepEqual(year2024.values, ssnCceSnapshot.national.values);

      // Values must be integers (cents), not floats with rounding artifacts from a naive
      // euro * 100 conversion.
      for (const entry of history.years) {
        for (const value of Object.values(entry.values)) {
          assert.ok(Number.isSafeInteger(value), `${entry.year}: ${value} non è un intero sicuro`);
          assert.ok(value > 0, `${entry.year}: valore non positivo`);
        }
      }

      // The known 2020-2021 rise in externally contracted healthcare work services should be
      // visible in the raw series (it is not asserted as caused by anything, only that the
      // adapter surfaces the real published numbers instead of a flattened trend).
      const byYear = new Map(history.years.map((entry) => [entry.year, entry.values]));
      assert.ok(byYear.get(2020).healthcareWorkServices > byYear.get(2019).healthcareWorkServices);
    });
  },
);

function row(code, importo) {
  const descriptions = {
    BZ9999: "Totale costi della produzione (B)",
    BA2080: "Totale Costo del personale",
    BA1350:
      "B.2.A.15) Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro sanitarie e sociosanitarie",
    BA1750:
      "B.2.B.2) Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro non sanitarie",
    BA0390: "B.2) Acquisti di servizi",
  };
  return {
    "Anno di Riferimento": "2024",
    "Codice Voce Contabile": code,
    "Descrizione Voce Contabile": descriptions[code],
    "Data Aggiornamento": "01/01/2026",
    "Importo Totale": importo,
  };
}

const VALID_ROWS = [
  row("BZ9999", "100.00"),
  row("BA2080", "40.50"),
  row("BA1350", "1.23"),
  row("BA1750", "0.10"),
  row("BA0390", "50.00"),
];

test("nationalValuesFromRows parses the 5 required voice codes into exact cents", () => {
  const values = nationalValuesFromRows(VALID_ROWS, 2024);
  assert.deepEqual(values, {
    productionCosts: 10000,
    personnelCost: 4050,
    healthcareWorkServices: 123,
    nonHealthcareWorkServices: 10,
    purchasedServices: 5000,
  });
});

test("nationalValuesFromRows ignores voice codes it does not need", () => {
  const values = nationalValuesFromRows([...VALID_ROWS, row("AA0010", "999.99")], 2024);
  assert.equal(Object.keys(values).length, 5);
});

test("nationalValuesFromRows fails closed when a row's declared year does not match the requested year", () => {
  // Simulates a mislabeled or swapped package: the CSV's own year field disagrees with the
  // year this package was discovered under.
  assert.throws(() => nationalValuesFromRows(VALID_ROWS, 2023), /incoerente con il rilascio 2023/);
});

test("nationalValuesFromRows fails closed on a duplicate voice code instead of silently keeping one", () => {
  assert.throws(
    () => nationalValuesFromRows([...VALID_ROWS, row("BZ9999", "1.00")], 2024),
    /BZ9999 duplicata/,
  );
});

test("nationalValuesFromRows fails closed when a required voice code is missing", () => {
  const missingPersonnel = VALID_ROWS.filter((entry) => entry["Codice Voce Contabile"] !== "BA2080");
  assert.throws(() => nationalValuesFromRows(missingPersonnel, 2024), /BA2080 assente/);
});

test("nationalValuesFromRows rejects an amount with more than 2 decimal digits instead of truncating it", () => {
  const rows = VALID_ROWS.map((entry) =>
    entry["Codice Voce Contabile"] === "BZ9999" ? row("BZ9999", "100.005") : entry,
  );
  assert.throws(() => nationalValuesFromRows(rows, 2024), /precisione inattesa/);
});

test("nationalValuesFromRows fails closed when the CSV header shape drifts", () => {
  const drifted = VALID_ROWS.map((entry) => ({ ...entry, "Colonna inattesa": "x" }));
  assert.throws(() => nationalValuesFromRows(drifted, 2024), /schema|header/i);
});

test("nationalValuesFromRows fails closed when a code maps to a different official description", () => {
  const drifted = VALID_ROWS.map((entry) =>
    entry["Codice Voce Contabile"] === "BA1350"
      ? { ...entry, "Descrizione Voce Contabile": "gettonisti" }
      : entry,
  );
  assert.throws(() => nationalValuesFromRows(drifted, 2024), /descrizione.*BA1350/i);
});

test("nationalValuesFromRows fails closed on malformed or inconsistent source dates", () => {
  const malformed = VALID_ROWS.map((entry) => ({ ...entry, "Data Aggiornamento": "2026-01-01" }));
  assert.throws(() => nationalValuesFromRows(malformed, 2024), /Data Aggiornamento.*valida/i);

  const inconsistent = VALID_ROWS.map((entry, index) =>
    index === 0 ? { ...entry, "Data Aggiornamento": "02/01/2026" } : entry,
  );
  assert.throws(() => nationalValuesFromRows(inconsistent, 2024), /Data Aggiornamento.*incoerente/i);
});

test("nationalValuesFromRows allows a different valid date on an unrelated voice", () => {
  const unrelated = {
    ...row("AA0010", "999.99"),
    "Data Aggiornamento": "02/01/2026",
  };
  assert.doesNotThrow(() => nationalValuesFromRows([...VALID_ROWS, unrelated], 2024));
});

const HISTORY_DESCRIPTIONS = {
  BZ9999: "Totale costi della produzione (B)",
  BA2080: "Totale Costo del personale",
  BA1350:
    "B.2.A.15) Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro sanitarie e sociosanitarie",
  BA1750:
    "B.2.B.2) Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro non sanitarie",
  BA0390: "B.2) Acquisti di servizi",
};

function packageResult(year) {
  return {
    id: `00000000-0000-4000-8000-${String(year).padStart(12, "0")}`,
    name: `spd_ssn_cce_naz_voccn_01_${year}`,
    title: `${year} - Modello di rilevazione del Conto Economico degli enti del SSN a livello Nazionale`,
    metadata_created: `${year + 1}-02-01T00:00:00.000000`,
    metadata_modified: `${year + 1}-03-01T00:00:00.000000`,
    license_id: "cc-by",
    license_title: "Creative Commons Attribution",
    license_url: "http://www.opendefinition.org/licenses/cc-by",
  };
}

function csvForYear(year, { trailingDelimiter = false } = {}) {
  const header = [
    "Anno di Riferimento",
    "Codice Voce Contabile",
    "Descrizione Voce Contabile",
    "Data Aggiornamento",
    "Importo Totale",
  ];
  const rows = Object.entries(HISTORY_DESCRIPTIONS).map(([code, description], index) =>
    [String(year), code, description, "01/01/2026", String(100 + index) + ".00"].join(";"),
  );
  const suffix = trailingDelimiter ? ";" : "";
  return [header.join(";") + suffix, ...rows.map((row) => row + suffix)].join("\n");
}

function delayed(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function stubHistoryFetch({ delayMs = 0, jsonYear = null, trailingDelimiter = false, missingLicenseIdYear = null } = {}) {
  const packages = [...SSN_NATIONAL_HISTORY_YEARS].map(packageResult);
  if (missingLicenseIdYear !== null) {
    const packageToMutate = packages.find((candidate) => candidate.name.endsWith(`_${missingLicenseIdYear}`));
    assert.ok(packageToMutate, `package year ${missingLicenseIdYear}`);
    delete packageToMutate.license_id;
  }
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const fetchStub = async (input, init = {}) => {
    const url = new URL(input.toString());
    calls.push(url.toString());
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      await delayed(delayMs, init.signal);
      if (url.pathname.endsWith("/package_search")) {
        return new Response(JSON.stringify({ success: true, result: { results: packages } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const packageId = url.pathname.split("/").at(-1)?.replace(/\.csv$/, "");
      const pkg = packages.find((candidate) => candidate.id === packageId);
      assert.ok(pkg, `package ${packageId}`);
      const year = Number(pkg.name.slice(-4));
      if (year === jsonYear) {
        return new Response(JSON.stringify({ error: "Attachment not found" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(csvForYear(year, { trailingDelimiter }), {
        status: 200,
        headers: { "content-type": "text/csv" },
      });
    } finally {
      active -= 1;
    }
  };
  return { fetchStub, calls, get maxActive() { return maxActive; } };
}

test("SSN national history fetches years with bounded concurrency and preserves order", async () => {
  const originalFetch = globalThis.fetch;
  const stub = stubHistoryFetch({ delayMs: 20 });
  globalThis.fetch = stub.fetchStub;
  try {
    const started = performance.now();
    const history = await getSsnNationalHistory({ deadlineMs: 2_000 });
    const elapsed = performance.now() - started;
    assert.deepEqual(history.years.map((entry) => entry.year), [...SSN_NATIONAL_HISTORY_YEARS]);
    assert.ok(stub.maxActive > 1, `expected concurrent year fetches, got ${stub.maxActive}`);
    assert.ok(stub.maxActive <= 4, `bounded concurrency exceeded: ${stub.maxActive}`);
    assert.ok(elapsed < 220, `history still looks sequential: ${elapsed}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SSN national history applies one global deadline and propagates abort to in-flight fetches", async () => {
  const originalFetch = globalThis.fetch;
  const stub = stubHistoryFetch({ delayMs: 100 });
  globalThis.fetch = stub.fetchStub;
  try {
    await assert.rejects(
      getSsnNationalHistory({ deadlineMs: 25 }),
      (error) => error?.name === "TimeoutError" || error?.name === "AbortError" || error?.message === "The operation was aborted",
    );
    assert.ok(stub.calls.length < 6, `deadline did not stop the cold path: ${stub.calls.length} calls`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SSN national history returns compact per-year source provenance", async () => {
  const originalFetch = globalThis.fetch;
  const stub = stubHistoryFetch();
  globalThis.fetch = stub.fetchStub;
  try {
    const history = await getSsnNationalHistory({ deadlineMs: 2_000 });
    for (const entry of history.years) {
      assert.equal(entry.provenance.packageId, packageResult(entry.year).id);
      assert.match(entry.provenance.packageUrl, /package_show\?id=/);
      assert.match(entry.provenance.csvUrl, /datastore\/dump\/.*\.csv\?download=1$/);
      assert.match(entry.provenance.sourceDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(entry.provenance.dataUpdatedAt, "2026-01-01");
      assert.match(entry.provenance.observedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(entry.provenance.license, "Creative Commons Attribution");
      assert.equal(entry.provenance.licenseUrl, "http://www.opendefinition.org/licenses/cc-by");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SSN national history rejects a 200 JSON error returned by the CSV dump", async () => {
  const originalFetch = globalThis.fetch;
  const stub = stubHistoryFetch({ jsonYear: 2018 });
  globalThis.fetch = stub.fetchStub;
  try {
    await assert.rejects(
      getSsnNationalHistory({ deadlineMs: 2_000 }),
      /errore JSON invece del CSV.*2018/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SSN national history fails closed when package license_id is missing", async () => {
  const originalFetch = globalThis.fetch;
  const stub = stubHistoryFetch({ missingLicenseIdYear: 2018 });
  globalThis.fetch = stub.fetchStub;
  try {
    await assert.rejects(
      getSsnNationalHistory({ deadlineMs: 2_000 }),
      /license_id OpenBDAP inatteso.*package/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SSN national history accepts OpenBDAP CSVs with one empty trailing delimiter column", async () => {
  const originalFetch = globalThis.fetch;
  const stub = stubHistoryFetch({ trailingDelimiter: true });
  globalThis.fetch = stub.fetchStub;
  try {
    const history = await getSsnNationalHistory({ deadlineMs: 2_000 });
    assert.equal(history.years.length, SSN_NATIONAL_HISTORY_YEARS.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openbdap_ssn_storico_nazionale MCP dataset rejects filters and stays within the response budget", async (context) => {
  await assert.rejects(
    queryPublicDataset({ dataset: "openbdap_ssn_storico_nazionale", year: 2024 }),
    /Filtri non supportati/,
  );
  await runLiveOpenBdap(context, async () => {
    const result = await queryPublicDataset({ dataset: "openbdap_ssn_storico_nazionale" });
    assert.equal(result.years.length, 13);
    assert.ok(JSON.stringify(result).length < 750 * 1024);
  });
});
