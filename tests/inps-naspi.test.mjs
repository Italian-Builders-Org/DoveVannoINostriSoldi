import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { inpsNaspiData, inpsNaspiMetadata, queryInpsNaspi } = await import("../src/lib/inps-naspi-snapshot.ts");
const { validateInpsNaspiBundle } = await import("../src/lib/data/inps-naspi-contract.ts");

test("lo snapshot dichiara copertura piena e nove tabelle", () => {
  const { expectedObservations, observedObservations } = inpsNaspiData.coverage;
  assert.equal(observedObservations, expectedObservations);
  assert.equal(inpsNaspiData.observations.length, expectedObservations);
  assert.equal(inpsNaspiData.tables.length, 9);
  assert.deepEqual(
    [...new Set(inpsNaspiData.tables.map((t) => t.measure))].sort(),
    ["beneficiari", "trattamenti"],
  );
});

test("una cella soppressa non diventa mai zero", () => {
  const suppressed = inpsNaspiData.observations.filter((row) => row.suppressed);
  assert.equal(suppressed.length, inpsNaspiData.coverage.suppressed);
  assert.ok(suppressed.length > 0, "la fonte dichiara soppressioni: devono restare marcate");
  assert.ok(suppressed.every((row) => row.count === null));
  assert.ok(inpsNaspiData.observations.filter((r) => !r.suppressed).every((r) => Number.isInteger(r.count)));
});

test("persone e prestazioni restano misure distinte", () => {
  const measureOf = new Map(inpsNaspiData.tables.map((t) => [t.id, t.measure]));
  for (const row of inpsNaspiData.observations) {
    assert.equal(row.measure, measureOf.get(row.table));
  }
  assert.match(inpsNaspiData.measures.beneficiari, /teste|persone/i);
  assert.match(inpsNaspiData.measures.trattamenti, /prestazion|periodi/i);
});

test("le riconciliazioni sono esatte, non tolleranti", () => {
  assert.equal(inpsNaspiData.reconciliation.exact, true);
  assert.ok(inpsNaspiData.reconciliation.checks.length >= 3);
  for (const check of inpsNaspiData.reconciliation.checks) {
    assert.equal(check.mismatches, 0, check.id);
    assert.ok(check.comparisons > 0, check.id);
  }
  // Ricalcolo indipendente della gerarchia territoriale.
  const sum = (table, prefix) => {
    const out = new Map();
    for (const row of inpsNaspiData.observations) {
      if (row.table !== table || row.count === null) continue;
      const key = `${prefix ? row.territorio.slice(0, prefix) : row.territorio}/${row.year}`;
      out.set(key, (out.get(key) ?? 0) + row.count);
    }
    return out;
  };
  const regioni = sum("beneficiari_02");
  const province = sum("beneficiari_04", 4);
  let compared = 0;
  for (const [key, value] of regioni) {
    const other = province.get(key);
    if (other === undefined) continue;
    compared += 1;
    assert.equal(value, other, `province non sommano alla regione su ${key}`);
  }
  assert.equal(compared, 105);
});

test("i caveat tengono separate le due misure e la soppressione", () => {
  const joined = inpsNaspiData.caveats.join(" ");
  assert.match(joined, /misure diverse/);
  assert.match(joined, /NON euro|non sono euro/);
  assert.match(joined, /flusso annuale/);
  assert.match(joined, /soppressa/);
});

test("le distribuzioni scartate sono documentate col motivo", () => {
  const choice = inpsNaspiMetadata.source.distributionChoice;
  assert.match(choice.used, /SDMX-ML/);
  assert.match(choice.rejectedCsv, /newline|byte di controllo/);
  assert.match(choice.rejectedJson, /underscore|non valido/);
  assert.equal(inpsNaspiMetadata.source.licenseId, "IODL-2.0");
});

test("la query filtra per tabella, misura, anno e territorio", () => {
  const campania = queryInpsNaspi({ table: "beneficiari_02", year: 2022, territory: "ITF3" });
  assert.equal(campania.observations.length, 2, "due sessi");
  assert.ok(campania.observations.every((r) => r.territorio === "ITF3" && r.year === 2022));

  const soloBeneficiari = queryInpsNaspi({ measure: "beneficiari", year: 2018 });
  assert.ok(soloBeneficiari.observations.every((r) => r.measure === "beneficiari" && r.year === 2018));
  assert.ok(soloBeneficiari.tables.every((t) => t.measure === "beneficiari"));
});

test("la query rifiuta codici e anni fuori dallo snapshot", () => {
  assert.throws(() => queryInpsNaspi({ year: 2017 }), /Anno fuori dal periodo/);
  assert.throws(() => queryInpsNaspi({ year: 2023 }), /Anno fuori dal periodo/);
  assert.throws(() => queryInpsNaspi({ table: "inesistente" }), /Tabella non riconosciuta/);
  assert.throws(() => queryInpsNaspi({ measure: "spesa" }), /Misura non riconosciuta/);
  assert.throws(() => queryInpsNaspi({ territory: "ZZ" }), /Territorio non riconosciuto/);
});

test("il contratto boccia una cella soppressa trasformata in numero", () => {
  const broken = structuredClone(inpsNaspiData);
  const cell = broken.observations.find((row) => row.suppressed);
  cell.count = 0;
  assert.throws(() => validateInpsNaspiBundle(broken, inpsNaspiMetadata));
});

test("il contratto boccia una riconciliazione rotta", () => {
  const broken = structuredClone(inpsNaspiData);
  const cell = broken.observations.find((row) => row.table === "beneficiari_02" && row.count !== null);
  cell.count += 1000;
  assert.throws(() => validateInpsNaspiBundle(broken, inpsNaspiMetadata), /riconciliazione/i);
});

test("il contratto boccia una provenienza non ufficiale", () => {
  const broken = structuredClone(inpsNaspiMetadata);
  // Passerebbe un controllo di prefisso senza la barra finale.
  broken.source.landingUrl = "https://opendata.inps.it.example.org/opendata";
  assert.throws(() => validateInpsNaspiBundle(inpsNaspiData, broken));
});
