import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { mefIrpefDettaglioData, mefIrpefDettaglioMetadata, queryMefIrpefDettaglio } = await import(
  "../src/lib/mef-irpef-dettaglio-snapshot.ts"
);
const { validateMefIrpefDettaglioBundle } = await import("../src/lib/data/mef-irpef-dettaglio-contract.ts");

test("lo snapshot copre i 79 file dichiarati", () => {
  const c = mefIrpefDettaglioData.coverage;
  assert.equal(c.observedFiles, c.expectedFiles);
  assert.equal(c.observedRows, c.expectedRows);
  assert.equal(mefIrpefDettaglioData.tables.length, c.expectedFiles);
  assert.equal(mefIrpefDettaglioData.rows.length, c.expectedRows);
});

test("la famiglia bonus dichiara due strumenti diversi", () => {
  const perAnno = new Map(
    mefIrpefDettaglioData.tables
      .filter((t) => t.family === "bonus_irpef" && t.breakdown === "regione")
      .map((t) => [t.year, t.instruments.slice().sort()]),
  );
  assert.deepEqual(perAnno.get(2020), ["bonus"]);
  // L'anno di transizione li espone entrambi: e' il punto in cui una serie
  // ingenua unirebbe due politiche fiscali diverse.
  assert.deepEqual(perAnno.get(2021), ["bonus", "trattamento"]);
  assert.deepEqual(perAnno.get(2022), ["trattamento"]);
  assert.match(mefIrpefDettaglioData.instruments.note, /non sono concatenabili/i);
});

test("lo schema e' vincolato per file, non per famiglia", () => {
  const distinti = new Set(mefIrpefDettaglioData.tables.map((t) => t.schemaId));
  assert.equal(distinti.size, 18);
  const reg = new Map(
    mefIrpefDettaglioData.tables
      .filter((t) => t.family === "tipo_reddito" && t.breakdown === "regione")
      .map((t) => [t.year, t.schemaId]),
  );
  assert.notEqual(reg.get(2019), reg.get(2020));
  assert.notEqual(reg.get(2022), reg.get(2023));
});

test("una misura puo' esistere in un taglio e non in un altro", () => {
  const target = "Perdita di spettanza dell'imprenditore in contabilita' semplificata - Frequenza";
  const ha = (breakdown, year) => {
    const t = mefIrpefDettaglioData.tables.find(
      (x) => x.family === "tipo_reddito" && x.breakdown === breakdown && x.year === year,
    );
    return mefIrpefDettaglioData.schemas[t.schemaId].measures.some((m) => m.name === target);
  };
  for (const anno of [2020, 2021, 2022]) {
    assert.equal(ha("regione", anno), true, `regione ${anno}`);
    assert.equal(ha("classeEta", anno), false, `classeEta ${anno}`);
    assert.equal(ha("sesso", anno), false, `sesso ${anno}`);
  }
});

test("una cella vuota non e' uno zero", () => {
  let vuote = 0;
  let zeri = 0;
  for (const row of mefIrpefDettaglioData.rows) {
    for (const v of row.v) {
      if (v === null) vuote += 1;
      else if (v === 0) zeri += 1;
    }
  }
  assert.equal(vuote, mefIrpefDettaglioData.coverage.emptyCells);
  // Convivono: la fonte distingue, e lo snapshot conserva la distinzione.
  assert.ok(vuote > 0 && zeri > 0);
});

test("assenze e rilasci vuoti restano dichiarati", () => {
  const c = mefIrpefDettaglioData.coverage;
  assert.deepEqual(Object.keys(c.missingFiles).sort(),
    ["cla_anno_bonus_irpef_2018.csv", "cla_anno_calcolo_irpef_2018.csv"]);
  assert.deepEqual(Object.keys(c.emptyReleases), ["REG_bonus_irpef_2024.csv"]);
});

test("le tre nature restano etichettate", () => {
  const nature = new Set(
    Object.values(mefIrpefDettaglioData.schemas).flatMap((s) => s.measures.map((m) => m.nature)),
  );
  assert.deepEqual([...nature].sort(), ["ammontare", "conteggio", "frequenza"]);
});

test("la query filtra per famiglia, taglio e anno", () => {
  const r = queryMefIrpefDettaglio({ family: "tipo_reddito", breakdown: "regione", year: 2025 });
  assert.equal(r.tables.length, 1);
  assert.equal(r.tables[0].table.id, "REG_tipo_reddito_2025");
  assert.ok(r.tables[0].rows.length > 0);
  assert.equal(r.tables[0].rows[0].values.length, r.tables[0].schema.measures.length);
  assert.ok(r.caveats.length > 0);
  assert.equal(r.source.licenseId, "CC-BY-3.0-IT");
});

test("la query rifiuta valori fuori dallo snapshot", () => {
  assert.throws(() => queryMefIrpefDettaglio({ year: 2016 }), /Anno fuori dal periodo/);
  assert.throws(() => queryMefIrpefDettaglio({ year: 2026 }), /Anno fuori dal periodo/);
  assert.throws(() => queryMefIrpefDettaglio({ family: "iva" }), /Famiglia non riconosciuta/);
  assert.throws(() => queryMefIrpefDettaglio({ breakdown: "provincia" }), /Taglio non riconosciuto/);
});

test("il contratto boccia un rilascio vuoto non dichiarato", () => {
  const broken = structuredClone(mefIrpefDettaglioData);
  broken.coverage.emptyReleases = {};
  assert.throws(() => validateMefIrpefDettaglioBundle(broken, mefIrpefDettaglioMetadata), /rilasci vuoti/i);
});

test("il contratto boccia un conteggio di celle vuote falsato", () => {
  const broken = structuredClone(mefIrpefDettaglioData);
  broken.coverage.emptyCells += 1;
  assert.throws(() => validateMefIrpefDettaglioBundle(broken, mefIrpefDettaglioMetadata), /vuote/i);
});

test("il contratto boccia una provenienza non ufficiale", () => {
  const broken = structuredClone(mefIrpefDettaglioMetadata);
  broken.source.landingUrl = "https://www1.finanze.gov.it.example.org/x";
  assert.throws(() => validateMefIrpefDettaglioBundle(mefIrpefDettaglioData, broken));
});

test("declaration years and tax years remain distinct and traceable", () => {
  const result = queryMefIrpefDettaglio({ family: "bonus_irpef", breakdown: "sesso", year: 2021 });
  assert.equal(result.periodBasis, "declaration-year");
  assert.deepEqual(result.taxPeriod, { from: 2016, to: 2024 });
  assert.equal(result.tables[0].table.taxYear, 2020);
  assert.equal(result.tables[0].table.publicationDate, "2022-04-13");
  assert.match(result.tables[0].source.sha256, /^[a-f0-9]{64}$/);
});

test("pagination covers a filtered table exactly once and enforces bounds", () => {
  const query = { family: "tipo_reddito", breakdown: "regione", year: 2025, limit: 100 };
  const keys = new Set();
  let offset = 0;
  let total;
  do {
    const result = queryMefIrpefDettaglio({ ...query, offset });
    total = result.pagination.totalRows;
    assert.ok(result.pagination.returnedRows <= 100);
    for (const row of result.tables[0].rows) {
      const key = JSON.stringify(row.keys);
      assert.ok(!keys.has(key));
      keys.add(key);
    }
    offset = result.pagination.nextOffset;
  } while (offset !== null);
  assert.equal(keys.size, total);
  for (const invalid of [{limit:101}, {limit:0}, {limit:1.5}, {offset:-1}, {offset:100001}]) {
    assert.throws(() => queryMefIrpefDettaglio({...query,...invalid}), /Paginazione/);
  }
});

test("contract rejects duplicate rows, changed positive cells and altered file provenance", () => {
  const duplicate = structuredClone(mefIrpefDettaglioData);
  duplicate.rows[1] = structuredClone(duplicate.rows[0]);
  assert.throws(() => validateMefIrpefDettaglioBundle(duplicate, mefIrpefDettaglioMetadata), /duplicata/);
  const changed = structuredClone(mefIrpefDettaglioData);
  const row = changed.rows.find(row => row.v.some(value => value > 0));
  row.v[row.v.findIndex(value => value > 0)] += 1;
  assert.throws(() => validateMefIrpefDettaglioBundle(changed, mefIrpefDettaglioMetadata), /hash/);
  const metadata = structuredClone(mefIrpefDettaglioMetadata);
  Object.values(metadata.source.files)[0].sha256 = "0".repeat(64);
  assert.throws(() => validateMefIrpefDettaglioBundle(mefIrpefDettaglioData, metadata), /metadati/);
});
