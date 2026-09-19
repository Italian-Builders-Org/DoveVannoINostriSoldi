import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { aifaSpesaConsumiData, aifaSpesaConsumiMetadata, queryAifaSpesaConsumi } = await import(
  "../src/lib/aifa-spesa-consumi-snapshot.ts"
);
const { validateAifaSpesaConsumiBundle } = await import(
  "../src/lib/data/aifa-spesa-consumi-contract.ts"
);

test("lo snapshot AIFA dichiara copertura e granularità e le mantiene", () => {
  assert.equal(aifaSpesaConsumiData.granularity, "annual-region-class-atc2");
  assert.deepEqual(aifaSpesaConsumiData.coverage.years, [2022, 2023, 2024, 2025]);
  assert.equal(aifaSpesaConsumiData.regions.length, 21);
  assert.equal(aifaSpesaConsumiData.observations.length, aifaSpesaConsumiData.coverage.publishedRows);
  const keys = new Set(
    aifaSpesaConsumiData.observations.map((row) => `${row.year}/${row.regionCode}/${row.class}/${row.atc2}`),
  );
  assert.equal(keys.size, aifaSpesaConsumiData.observations.length, "chiavi duplicate nello snapshot");
});

test("i due canali restano separati e riconciliano con i totali dichiarati", () => {
  for (const declared of aifaSpesaConsumiData.reconciliation.byYear) {
    const rows = aifaSpesaConsumiData.observations.filter((row) => row.year === declared.year);
    const sum = (field) => rows.reduce((total, row) => total + (row[field] ?? 0), 0);
    assert.equal(sum("traceabilitySpendCents"), declared.traceabilitySpendCents, `${declared.year} tracciabilità`);
    assert.equal(sum("convenzionataSpendCents"), declared.convenzionataSpendCents, `${declared.year} convenzionata`);
    assert.equal(sum("traceabilityPacks"), declared.traceabilityPacks);
    assert.equal(sum("convenzionataPacks"), declared.convenzionataPacks);
    // Se i canali fossero stati fusi i due totali coinciderebbero: non è così.
    assert.notEqual(declared.traceabilitySpendCents, declared.convenzionataSpendCents);
  }
});

test("canale assente resta null e i negativi stanno solo sulla tracciabilità", () => {
  const missing = aifaSpesaConsumiData.observations.filter((row) => row.convenzionataSpendCents === null);
  assert.ok(missing.length > 0, "la fonte ha combinazioni senza canale convenzionata");
  for (const row of missing) assert.equal(row.convenzionataPacks, null);
  for (const row of aifaSpesaConsumiData.observations) {
    assert.ok((row.convenzionataSpendCents ?? 0) >= 0, "convenzionata negativa");
    assert.ok(Number.isSafeInteger(row.traceabilitySpendCents ?? 0));
  }
  assert.ok(
    aifaSpesaConsumiData.observations.some((row) => (row.traceabilitySpendCents ?? 0) < 0),
    "i resi sulla tracciabilità devono restare negativi",
  );
});

test("i caveat dicono cosa il dato non è", () => {
  const caveats = aifaSpesaConsumiData.caveats.join(" ");
  assert.match(caveats, /non vanno sommati/i);
  assert.match(caveats, /payback/i);
  assert.match(caveats, /GF07|Conto economico/i);
  assert.match(caveats, /DDD/i);
  const { semantics } = aifaSpesaConsumiMetadata;
  assert.equal(semantics.soldi.unit, "centesimi di euro");
  assert.equal(semantics.periodo.referencePeriod, "2022-2025");
  assert.equal(semantics.provenance.license, "CC-BY-4.0");
  assert.notEqual(semantics.provenance.publicationDate, semantics.provenance.acquisitionDate);
});

test("la query filtra per anno, regione, classe e ATC II", () => {
  const lombardia2025 = queryAifaSpesaConsumi({ year: 2025, regionCode: "030" });
  assert.ok(lombardia2025.observations.length > 0);
  assert.ok(lombardia2025.observations.every((row) => row.year === 2025 && row.regionCode === "030"));
  assert.equal(lombardia2025.regions.length, 1);

  const c09 = queryAifaSpesaConsumi({ atc2: "c09" });
  assert.ok(c09.observations.every((row) => row.atc2 === "C09"));
  assert.deepEqual(c09.atc2.map((entry) => entry.code), ["C09"]);

  const classeH = queryAifaSpesaConsumi({ year: 2024, class: "h" });
  assert.ok(classeH.observations.every((row) => row.class === "H" && row.year === 2024));
});

test("la query rifiuta anni, regioni, classi e codici fuori dallo snapshot", () => {
  assert.throws(() => queryAifaSpesaConsumi({ year: 2021 }), /Anno fuori dal periodo/);
  assert.throws(() => queryAifaSpesaConsumi({ year: 2026 }), /Anno fuori dal periodo/);
  assert.throws(() => queryAifaSpesaConsumi({ regionCode: "999" }), /Regione non riconosciuta/);
  assert.throws(() => queryAifaSpesaConsumi({ class: "Z" }), /Classe di rimborsabilità/);
  assert.throws(() => queryAifaSpesaConsumi({ atc2: "Z99" }), /ATC di II livello/);
});

test("il contratto boccia riconciliazione rotta, canale disallineato e caveat mancanti", () => {
  const broken = structuredClone(aifaSpesaConsumiData);
  broken.observations[0].traceabilitySpendCents = (broken.observations[0].traceabilitySpendCents ?? 0) + 100;
  assert.throws(
    () => validateAifaSpesaConsumiBundle(broken, aifaSpesaConsumiMetadata),
    /non riconcilia/i,
  );

  const misaligned = structuredClone(aifaSpesaConsumiData);
  const row = misaligned.observations.find((entry) => entry.convenzionataSpendCents === null);
  row.convenzionataPacks = 7;
  assert.throws(
    () => validateAifaSpesaConsumiBundle(misaligned, aifaSpesaConsumiMetadata),
    /disallineate/i,
  );

  const noCaveat = structuredClone(aifaSpesaConsumiData);
  noCaveat.caveats = noCaveat.caveats.filter((item) => !/payback/i.test(item));
  assert.throws(() => validateAifaSpesaConsumiBundle(noCaveat, aifaSpesaConsumiMetadata));
});
