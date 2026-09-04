import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { getStateSpendingSnapshot, normalizeBdapPackage } = await import("../src/lib/bdap-payments.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");

const packageId = "12345678-1234-4abc-8def-1234567890ab";

function fixture({ title, code, scope, id = packageId }) {
  return {
    id,
    name: "openbdap-fixture",
    title,
    notes: `Dati di Spesa relativi ai ${scope}. - [${code}]`,
    metadata_modified: "2026-07-20T00:00:00.000000",
  };
}

test("OpenBDAP annual release is an explicit consuntivo with no month", () => {
  const dataset = normalizeBdapPackage(
    fixture({
      title: "2025 - Pagamenti Bilancio dello Stato per Missione Consuntivo",
      code: "PBS_SPE_RND_MISS_001",
      scope: "pagamenti Bilancio dello Stato per l'esercizio finanziario di riferimento",
    }),
    "mission",
    "consuntivo",
  );

  assert.equal(dataset?.releaseKind, "consuntivo");
  assert.equal(dataset?.referenceYear, 2025);
  assert.equal(dataset?.referenceMonth, null);
  assert.equal(dataset?.productCode, "PBS_SPE_RND_MISS_001");
  assert.equal(dataset?.csvUrl, `https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/datastore/dump/${packageId}.csv?download=1`);
});

test("OpenBDAP monthly release keeps its reference month", () => {
  const dataset = normalizeBdapPackage(
    fixture({
      title: "2025/12 - Pagamenti Bilancio dello Stato per Missione",
      code: "PBS_SPE_M12_MISS_001",
      scope: "pagamenti Bilancio dello Stato per l'esercizio finanziario e mese contabile di riferimento",
    }),
    "mission",
    "monthly",
  );

  assert.equal(dataset?.releaseKind, "monthly");
  assert.equal(dataset?.referenceYear, 2025);
  assert.equal(dataset?.referenceMonth, 12);
  assert.equal(dataset?.productCode, "PBS_SPE_M12_MISS_001");
  assert.equal(dataset?.csvUrl, `https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/datastore/dump/${packageId}.csv?download=1`);
});

test("OpenBDAP release validation rejects code, title, and perimeter drift", () => {
  const annual = fixture({
    title: "2025 - Pagamenti Bilancio dello Stato per Missione Consuntivo",
    code: "PBS_SPE_RND_MISS_001",
    scope: "pagamenti Bilancio dello Stato per l'esercizio finanziario di riferimento",
  });

  assert.equal(
    normalizeBdapPackage(annual, "mission", "monthly"),
    null,
    "an annual title cannot enter the monthly series",
  );
  assert.equal(
    normalizeBdapPackage(
      { ...annual, notes: annual.notes.replace("PBS_SPE_RND_MISS_001", "PBS_SPE_M12_MISS_001") },
      "mission",
      "consuntivo",
    ),
    null,
    "a monthly product code cannot satisfy the annual contract",
  );
  assert.equal(
    normalizeBdapPackage(
      { ...annual, notes: annual.notes.replace("esercizio finanziario", "mese contabile") },
      "mission",
      "consuntivo",
    ),
    null,
    "the annual perimeter must mention the financial year",
  );
  assert.equal(
    normalizeBdapPackage(
      { ...annual, title: "2025 - Pagamenti Bilancio dello Stato per Missione Amministrazione Consuntivo" },
      "mission",
      "consuntivo",
    ),
    null,
    "a different dimension cannot enter the mission series",
  );
});

test("annual OpenBDAP queries prefer consuntivo and monthly queries stay monthly", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const packages = new Map();
  let monthlyRowLabel = "DICEMBRE";
  const dimensions = [
    ["MISS", "mission", "Pagamenti Bilancio dello Stato per Missione"],
    ["MISAM", "missionAdministration", "Pagamenti Bilancio dello Stato per Missione Amministrazione"],
    ["AMCE2", "administrationEconomic", "Pagamenti Bilancio dello Stato per Amministrazione Classificazione Economica II livello"],
  ];

  function packageFor(code) {
    const annual = code.includes("_RND_");
    const suffix = code.match(/_(?:RND|M\d{2})_([^_]+)_001$/)?.[1];
    const dimension = dimensions.find(([candidate]) => candidate === suffix);
    assert.ok(dimension, code);
    const title = annual
      ? `2025 - ${dimension[2]} Consuntivo`
      : `2025/12 - ${dimension[2]}`;
    const scope = annual
      ? "pagamenti Bilancio dello Stato per l'esercizio finanziario di riferimento"
      : "pagamenti Bilancio dello Stato per l'esercizio finanziario e mese contabile di riferimento";
    const ids = annual
      ? [
          "12345678-1234-4abc-8def-1234567890ab",
          "32345678-1234-4abc-8def-1234567890ab",
          "42345678-1234-4abc-8def-1234567890ab",
        ]
      : [
          "22345678-1234-4abc-8def-1234567890ab",
          "52345678-1234-4abc-8def-1234567890ab",
          "62345678-1234-4abc-8def-1234567890ab",
        ];
    const id = ids[dimensions.indexOf(dimension)];
    packages.set(id, {
      dimension: dimension[1],
      releaseKind: annual ? "consuntivo" : "monthly",
    });
    return fixture({ title, code, scope, id });
  }

  const rowsFor = (dimension, releaseKind) => {
    const annual = releaseKind === "consuntivo";
    if (dimension === "mission") {
      return [
        annual
          ? "Esercizio finanziario;Codice Missione;Missione;OP Erario;OP Tesoreria;OP Esterno;OA Tesoreria;OA Spesa Funz Deleg;RSF Stipendi;RSF Altro;Note Imputazione;Totale pagato"
          : "Esercizio finanziario;Mese contabile;Codice Missione;Missione;OP Erario;OP Tesoreria;OP Esterno;OA Tesoreria;OA Spesa Funz Deleg;RSF Stipendi;RSF Altro;Note Imputazione;Totale Pagato",
        annual
          ? ["2025", "001", "Missione", "100", "0", "0", "0", "0", "0", "0", "0", "100"].join(";")
          : ["2025", monthlyRowLabel, "001", "Missione", "100", "0", "0", "0", "0", "0", "0", "0", "100"].join(";"),
      ].join("\n");
    }
    if (dimension === "missionAdministration") {
      return [
        annual
          ? "Esercizio finanziario;Codice STP;Amministrazione;Codice Missione;Missione;OP Erario;OP Tesoreria;OP Esterno;OA Tesoreria;OA Spesa Funz Deleg;RSF Stipendi;RSF Altro;Note Imputazione;Totale pagato"
          : "Esercizio finanziario;Mese contabile;Codice Missione;Missione;Codice STP;Amministrazione;OP Erario;OP Tesoreria;OP Esterno;OA Tesoreria;OA Spesa Funz Deleg;RSF Stipendi;RSF Altro;Note Imputazione;Totale Pagato",
        annual
          ? ["2025", "02", "MINISTERO TEST", "001", "Missione", "100", "0", "0", "0", "0", "0", "0", "0", "100"].join(";")
          : ["2025", monthlyRowLabel, "001", "Missione", "02", "MINISTERO TEST", "100", "0", "0", "0", "0", "0", "0", "0", "100"].join(";"),
      ].join("\n");
    }
    return [
      annual
        ? "Esercizio finanziario;Codice STP;Amministrazione;Codice Categoria;Categoria;Codice CE2;CE2;OP Erario;OP Tesoreria;OP Esterno;OA Tesoreria;OA Spesa Funz Deleg;RSF Stipendi;RSF Altro;Note Imputazione;Totale pagato"
        : "Esercizio finanziario;Mese contabile;Codice STP;Amministrazione;Codice Categoria;Categoria;Codice CE2;CE2;OP Erario;OP Tesoreria;OP Esterno;OA Tesoreria;OA Spesa Funz Deleg;RSF Stipendi;RSF Altro;Note Imputazione;Totale Pagato",
      annual
        ? ["2025", "02", "MINISTERO TEST", "01", "REDDITI DA LAVORO DIPENDENTE", "0101", "PERSONALE", "100", "0", "0", "0", "0", "0", "0", "0", "100"].join(";")
        : ["2025", monthlyRowLabel, "02", "MINISTERO TEST", "01", "REDDITI DA LAVORO DIPENDENTE", "0101", "PERSONALE", "100", "0", "0", "0", "0", "0", "0", "0", "100"].join(";"),
    ].join("\n");
  };

  globalThis.fetch = async (input) => {
    const url = new URL(input.toString());
    if (url.pathname.endsWith("/package_search")) {
      const code = url.searchParams.get("q");
      calls.push(code);
      const pkg = packageFor(code);
      return new Response(JSON.stringify({ success: true, result: { results: [pkg] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const id = url.pathname.split("/").at(-1)?.replace(/\.csv$/, "");
    const packageInfo = packages.get(id);
    assert.ok(packageInfo, id);
    return new Response(rowsFor(packageInfo.dimension, packageInfo.releaseKind), {
      status: 200,
      headers: { "content-type": "text/csv" },
    });
  };

  try {
    const annual = await getStateSpendingSnapshot({ year: 2025 });
    assert.equal(annual.period.releaseKind, "consuntivo");
    assert.equal(annual.period.month, null);
    assert.ok(annual.sources.mission);
    assert.equal(annual.sources.mission.releaseKind, "consuntivo");
    assert.equal(annual.sources.missionAdministration?.releaseKind, "consuntivo");
    assert.equal(annual.sources.administrationEconomic?.releaseKind, "consuntivo");
    assert.ok(calls.every((code) => code.startsWith("PBS_SPE_RND_")));

    calls.length = 0;
    const annualMcp = await queryPublicDataset({
      dataset: "openbdap_spesa_stato",
      year: 2025,
    });
    assert.equal(annualMcp.period.releaseKind, "consuntivo");
    assert.equal(annualMcp.period.month, null);
    assert.ok(calls.every((code) => code.startsWith("PBS_SPE_RND_")));

    calls.length = 0;
    const monthly = await getStateSpendingSnapshot({ year: 2025, month: 12 });
    assert.equal(monthly.period.releaseKind, "monthly");
    assert.equal(monthly.period.month, 12);
    assert.ok(monthly.sources.mission);
    assert.equal(monthly.sources.mission.releaseKind, "monthly");
    assert.equal(monthly.sources.missionAdministration?.releaseKind, "monthly");
    assert.equal(monthly.sources.administrationEconomic?.releaseKind, "monthly");
    assert.ok(calls.every((code) => code.startsWith("PBS_SPE_M12_")));

    monthlyRowLabel = "NOVEMBRE";
    await assert.rejects(
      () => getStateSpendingSnapshot({ year: 2025, month: 12 }),
      /mese della riga NOVEMBRE non coincide con il rilascio DICEMBRE/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenBDAP payments classify the known conversion outage and preserve the download query", async () => {
  const originalFetch = globalThis.fetch;
  const dumpUrls = [];
  const dimensions = new Map([
    ["PBS_SPE_RND_MISS_001", ["Pagamenti Bilancio dello Stato per Missione Consuntivo", "PBS_SPE_RND_MISS_001"]],
    ["PBS_SPE_RND_MISAM_001", ["Pagamenti Bilancio dello Stato per Missione Amministrazione Consuntivo", "PBS_SPE_RND_MISAM_001"]],
    ["PBS_SPE_RND_AMCE2_001", ["Pagamenti Bilancio dello Stato per Amministrazione Classificazione Economica II livello Consuntivo", "PBS_SPE_RND_AMCE2_001"]],
  ]);

  globalThis.fetch = async (input) => {
    const url = new URL(input.toString());
    if (url.pathname.endsWith("/package_search")) {
      const code = url.searchParams.get("q");
      const dimension = dimensions.get(code);
      assert.ok(dimension, code);
      const id = `12345678-1234-4abc-8def-${String([...dimensions.keys()].indexOf(code) + 1).padStart(12, "0")}`;
      return new Response(JSON.stringify({
        success: true,
        result: {
          results: [fixture({
            id,
            title: `2025 - ${dimension[0]}`,
            code: dimension[1],
            scope: "pagamenti Bilancio dello Stato per l'esercizio finanziario di riferimento",
          })],
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    dumpUrls.push(url);
    return new Response(JSON.stringify({
      success: false,
      error: { message: "Cannot convert data to csv" },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await assert.rejects(
      getStateSpendingSnapshot({ year: 2025 }),
      (error) => error?.name === "OpenBdapUnavailableError",
    );
    assert.ok(dumpUrls.length > 0);
    assert.ok(dumpUrls.every((url) => url.searchParams.get("download") === "1"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
