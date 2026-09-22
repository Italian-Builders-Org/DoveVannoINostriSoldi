import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2021AmministrazioneSnapshot } = await import("../src/lib/data/opencivitas-2021-amministrazione-contract.ts");

const load = () => JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2021-amministrazione.json", import.meta.url), "utf8"));

test("FC70AMMIN 2021 preserves official source dates, money, RSO coverage and administration function", () => {
  const snapshot = assertOpenCivitas2021AmministrazioneSnapshot(load());
  assert.equal(snapshot.referenceYear, 2021);
  assert.equal(snapshot.publishedAt, "2024-05-30");
  assert.equal(snapshot.modifiedAt, "2024-05-30");
  assert.equal(snapshot.source.family, "FC70AMMIN");
  assert.equal(snapshot.coverage.function, "AMMINISTRAZIONE");
  assert.equal(snapshot.source.license, "CC BY 4.0");
  assert.equal(snapshot.source.bytes.data, 2240179);
  assert.equal(snapshot.coverage.municipalities, 6550);
  assert.equal(snapshot.coverage.regions, 15);
  const rome = snapshot.municipalities.find((row) => row.istatCode === "058091");
  assert.equal(rome.historicalSpendingCents, 65839311033);
  assert.equal(rome.standardSpendingCents, 41312348417);
  assert.equal(rome.differenceCents, 24526962616);
  assert.equal(rome.differencePerCapitaCents, 8922);
  assert.equal(rome.serviceDifferenceBasisPoints, -419);
  assert.equal(rome.spendingLevel, 10);
  assert.equal(rome.serviceLevel, 5);
  assert.equal(rome.spendingAssessmentReason, null);
  assert.match(snapshot.methodology.serviceMeaning, /Amministrazione/);
  assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
  assert.match(snapshot.methodology.functionSeparationWarning, /FC80AMMIN 2022/);
  assert.match(snapshot.methodology.coverageWarning, /15 Comuni/);
  assert.match(snapshot.methodology.nationalDifferenceWarning, /riproporzionato sul totale della spesa storica/);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "EMILIA-ROMAGNA").length, 330);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "CALABRIA").length, 398);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "ABRUZZO").length, 301);
  assert.ok(snapshot.municipalities.some((row) => row.istatCode === "066001"));
  const esclusi = ["016103", "057055", "063042", "063073", "066083", "066093", "069013", "069043", "073005", "078008", "078128", "078131", "079138", "080096", "102037"];
  assert.ok(!snapshot.municipalities.some((row) => esclusi.includes(row.istatCode)));
  assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.istatCode.startsWith("ZZ")));
});

test("FC70AMMIN pin rejects coherent tampering", () => {
  const snapshot = load();
  const tampered = structuredClone(snapshot);
  const historicalColumn = tampered.municipalityColumns.indexOf("historicalSpendingCents");
  assert.ok(historicalColumn >= 0);
  tampered.municipalityRows[0][historicalColumn] += 1;
  assert.throws(() => assertOpenCivitas2021AmministrazioneSnapshot(tampered), /SHA-256 semantico/);
  assert.doesNotThrow(() => assertOpenCivitas2021AmministrazioneSnapshot({
    ...snapshot,
    generatedAt: "2024-05-30T00:00:00Z",
    source: { ...snapshot.source, observedAt: "2024-05-30T00:00:00Z" },
  }));
  assert.throws(() => assertOpenCivitas2021AmministrazioneSnapshot({
    ...snapshot,
    generatedAt: "2024-01-01T00:00:00Z",
    source: { ...snapshot.source, observedAt: "2024-01-01T00:00:00Z" },
  }), /timestamp di acquisizione/);
});

test("FC70AMMIN keeps the reproportioning invariant readable from the published payload", () => {
  const snapshot = assertOpenCivitas2021AmministrazioneSnapshot(load());
  const somma = (chiave) => snapshot.municipalities.reduce((totale, riga) => totale + riga[chiave], 0);
  const storica = somma("historicalSpendingCents");
  const fabbisogno = somma("standardSpendingCents");

  // Il riproporzionamento vale sui 6565 Comuni, prima dei 15 esclusi.
  assert.equal(storica, 814318182205);
  assert.equal(fabbisogno, 812923059266);

  const residuoEsclusi = 1395122936;
  assert.equal(storica - fabbisogno, residuoEsclusi + 3);
  assert.ok(Math.abs(storica - (fabbisogno + residuoEsclusi)) <= 1000);

  assert.match(snapshot.methodology.nationalDifferenceWarning, /non è un risultato/);
  assert.match(snapshot.methodology.nationalDifferenceWarning, /13,95 milioni/);
});
