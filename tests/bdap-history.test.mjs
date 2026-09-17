import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { deriveStateSpendingHistoryPoints } from "../src/lib/data/bdap-history-points.ts";

const { getStateSpendingHistory } = await import("../src/lib/bdap-history.ts");

function row(month, cumulativePaid) {
  return {
    dataset: {
      referenceMonth: month,
      releaseKind: "monthly",
      productCode: `M${month}`,
      packageId: `package-${month}`,
      csvUrl: `https://example.test/${month}.csv`,
      metadataModified: null,
    },
    cumulativePaid,
  };
}

test("OpenBDAP history keeps available months and never bridges a missing month", () => {
  const points = deriveStateSpendingHistoryPoints(2026, [
    row(4, 45),
    row(1, 10),
    row(2, 25),
  ]);

  assert.deepEqual(points.map((point) => point.month), [1, 2, 4]);
  assert.deepEqual(points.map((point) => point.monthlyPaid), [10, 15, null]);
  assert.deepEqual(points.map((point) => point.source.releaseKind), ["monthly", "monthly", "monthly"]);
  assert.equal(points[2].cumulativePaid, 45);
});

test("OpenBDAP history rejects an annual release instead of mixing series", () => {
  assert.throws(
    () => deriveStateSpendingHistoryPoints(2025, [{
      dataset: {
        referenceMonth: null,
        releaseKind: "consuntivo",
        productCode: "PBS_SPE_RND_MISS_001",
        packageId: "package-annual",
        csvUrl: "https://example.test/annual.csv",
        metadataModified: null,
      },
      cumulativePaid: 10,
    }]),
    /soltanto rilasci mensili/,
  );
});

test("OpenBDAP history aborts every in-flight fetch at its global deadline", async () => {
  const originalFetch = globalThis.fetch;
  const upstreamSignals = [];
  globalThis.fetch = async (_input, init = {}) => {
    assert.ok(init.signal instanceof AbortSignal);
    upstreamSignals.push(init.signal);
    return await new Promise((_resolve, reject) => {
      // Like a real socket, keep Node alive while AbortSignal.timeout's
      // unreferenced timer is pending (notably on the CI Node 22 runtime).
      const pendingIo = setTimeout(() => reject(new Error("deadline did not cancel upstream")), 2_000);
      init.signal.addEventListener("abort", () => {
        clearTimeout(pendingIo);
        reject(init.signal.reason);
      }, { once: true });
    });
  };

  try {
    await assert.rejects(
      getStateSpendingHistory({ deadlineMs: 25, concurrency: 3 }),
      (error) => error?.name === "TimeoutError",
    );
    assert.equal(upstreamSignals.length, 1);
    assert.equal(upstreamSignals.every((signal) => signal.aborted), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenBDAP history bounds both catalog and CSV fan-out", async () => {
  const originalFetch = globalThis.fetch;
  const monthNames = [
    "GENNAIO", "FEBBRAIO", "MARZO", "APRILE", "MAGGIO", "GIUGNO",
    "LUGLIO", "AGOSTO", "SETTEMBRE", "OTTOBRE", "NOVEMBRE", "DICEMBRE",
  ];
  let active = 0;
  let maxActive = 0;

  globalThis.fetch = async (input, init = {}) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(init.signal.reason);
        }, { once: true });
      });

      const url = new URL(input.toString());
      if (url.pathname.endsWith("/package_search")) {
        const code = url.searchParams.get("q");
        const month = Number.parseInt(code?.match(/_M(\d{2})_/)?.[1] ?? "0", 10);
        assert.ok(month >= 1 && month <= 9, code);
        const packageId = `12345678-1234-4abc-8def-${String(month).padStart(12, "0")}`;
        return new Response(JSON.stringify({
          success: true,
          result: {
            results: [{
              id: packageId,
              name: `openbdap-month-${month}`,
              title: `2026/${String(month).padStart(2, "0")} - Pagamenti Bilancio dello Stato per Missione`,
              notes: `Dati per l'esercizio finanziario e mese contabile di riferimento. - [${code}]`,
              metadata_modified: "2026-09-01T00:00:00.000000",
            }],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      const month = Number.parseInt(url.pathname.match(/(\d{12})\.csv$/)?.[1] ?? "0", 10);
      assert.ok(month >= 1 && month <= 9, url.pathname);
      const csv = [
        "Esercizio finanziario;Mese contabile;Codice Missione;Missione;OP Erario;OP Tesoreria;OP Esterno;OA Tesoreria;OA Spesa Funz Deleg;RSF Stipendi;RSF Altro;Note Imputazione;Totale Pagato",
        ["2026", monthNames[month - 1], "001", "Missione", String(month * 100), "0", "0", "0", "0", "0", "0", "0", String(month * 100)].join(";"),
      ].join("\n");
      return new Response(csv, { status: 200, headers: { "content-type": "text/csv" } });
    } finally {
      active -= 1;
    }
  };

  try {
    const history = await getStateSpendingHistory({
      now: new Date("2026-09-01T00:00:00.000Z"),
      deadlineMs: 2_000,
      concurrency: 3,
    });
    assert.equal(history.latestMonth, 9);
    assert.equal(history.points.length, 9);
    assert.ok(maxActive <= 3, `observed ${maxActive} concurrent upstreams`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
