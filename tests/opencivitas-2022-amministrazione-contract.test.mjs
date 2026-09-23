import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2022AmministrazioneSnapshot } = await import("../src/lib/data/opencivitas-2022-amministrazione-contract.ts");

const load = () => JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2022-amministrazione.json", import.meta.url), "utf8"));

test("FC80AMMIN 2022 preserves official source dates, money, RSO coverage and administration function", () => {
  const snapshot = assertOpenCivitas2022AmministrazioneSnapshot(load());
  assert.equal(snapshot.referenceYear, 2022);
  assert.equal(snapshot.publishedAt, "2025-06-16");
  assert.equal(snapshot.modifiedAt, "2025-06-16");
  assert.equal(snapshot.source.family, "FC80AMMIN");
  assert.equal(snapshot.coverage.function, "AMMINISTRAZIONE");
  assert.equal(snapshot.source.license, "CC BY 4.0");
  assert.equal(snapshot.source.bytes.data, 1783464);
  assert.equal(snapshot.coverage.municipalities, 6548);
  assert.equal(snapshot.coverage.regions, 15);
  const rome = snapshot.municipalities.find((row) => row.istatCode === "058091");
  assert.equal(rome.historicalSpendingCents, 67092452301);
  assert.equal(rome.standardSpendingCents, 42907941195);
  assert.equal(rome.differenceCents, 24184511106);
  assert.equal(rome.differencePerCapitaCents, 8777);
  assert.equal(rome.serviceDifferenceBasisPoints, -428);
  assert.equal(rome.spendingLevel, 10);
  assert.equal(rome.serviceLevel, 5);
  assert.equal(rome.spendingAssessmentReason, null);
  assert.match(snapshot.methodology.serviceMeaning, /Amministrazione/);
  assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
  assert.match(snapshot.methodology.functionSeparationWarning, /FC80TERRVIAB/);
  assert.match(snapshot.methodology.coverageWarning, /9 Comuni/);
  assert.match(snapshot.methodology.nationalDifferenceWarning, /riproporzionato sul totale della spesa storica/);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "EMILIA-ROMAGNA").length, 330);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "CALABRIA").length, 401);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "ABRUZZO").length, 302);
  // I 9 Comuni senza spesa storica restano fuori: nessuna imputazione a zero.
  assert.equal(snapshot.municipalities.length, 6548);
  assert.ok(snapshot.municipalities.some((row) => row.istatCode === "066001"));
  // I 9 Comuni senza spesa storica non compaiono: nessuna imputazione a zero.
  const esclusi = ["002003", "002045", "002089", "068003", "068008", "069013", "078052", "079138", "080040"];
  assert.ok(!snapshot.municipalities.some((row) => esclusi.includes(row.istatCode)));
  assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.istatCode.startsWith("ZZ")));
});

test("FC80AMMIN pin rejects coherent tampering", () => {
  const snapshot = load();
  // La manomissione deve colpire municipalityRows, la struttura che il digest copre:
  // municipalities non esiste nel payload, quindi mutarla sollevava un TypeError
  // che assert.throws catturava senza che il contratto venisse mai interrogato.
  const manomesso = structuredClone(snapshot);
  const colonnaStorica = manomesso.municipalityColumns.indexOf("historicalSpendingCents");
  assert.ok(colonnaStorica >= 0);
  manomesso.municipalityRows[0][colonnaStorica] += 1;
  assert.throws(() => assertOpenCivitas2022AmministrazioneSnapshot(manomesso), /SHA-256 semantico/);
  assert.throws(() => assertOpenCivitas2022AmministrazioneSnapshot({
    ...snapshot,
    generatedAt: "2024-01-01T00:00:00Z",
    source: { ...snapshot.source, observedAt: "2024-01-01T00:00:00Z" },
  }), /timestamp di acquisizione/);
});

test("FC80AMMIN keeps the reproportioning invariant readable from the published payload", () => {
  const snapshot = assertOpenCivitas2022AmministrazioneSnapshot(load());
  const somma = (chiave) => snapshot.municipalities.reduce((totale, riga) => totale + riga[chiave], 0);
  const storica = somma("historicalSpendingCents");
  const fabbisogno = somma("standardSpendingCents");

  // Valori del lock: l'uguaglianza vale sui 6557 Comuni joinati, non sui 6548 pubblicati.
  assert.equal(storica, 862276561316);
  assert.equal(fabbisogno, 861956990157);

  // I 9 Comuni esclusi portano 3,20 milioni di fabbisogno senza spesa storica:
  // la differenza sui pubblicati e' quel residuo, non un risparmio.
  const residuoEsclusi = 319571159;
  assert.equal(storica - fabbisogno, residuoEsclusi);
  assert.ok(Math.abs(storica - (fabbisogno + residuoEsclusi)) <= 1000);

  // Il caveat che lo spiega deve restare nel payload, non solo nella documentazione.
  assert.match(snapshot.methodology.nationalDifferenceWarning, /non è un risultato/);
  assert.match(snapshot.methodology.nationalDifferenceWarning, /3,20 milioni/);
});
