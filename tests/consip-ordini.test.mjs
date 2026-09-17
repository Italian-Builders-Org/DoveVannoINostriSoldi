import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  consipOrdiniData,
  consipOrdiniMetadata,
  queryConsipOrdini,
} = await import("../src/lib/consip-ordini-snapshot.ts");
const { validateConsipOrdiniBundle } = await import("../src/lib/data/consip-ordini-contract.ts");

test("il bundle Consip mantiene periodo, canali e provenienza ufficiale", () => {
  const validated = validateConsipOrdiniBundle(consipOrdiniData, consipOrdiniMetadata);
  assert.equal(validated.data.schemaVersion, 1);
  assert.deepEqual(validated.data.period, { from: 2024, to: 2026 });
  assert.deepEqual(validated.data.channels, ["convenzioni", "mepa"]);
  assert.equal(validated.data.totals.length, 6);
  assert.equal(validated.metadata.source.licenseId, "CC-BY-4.0");
  assert.equal(validated.metadata.source.landingUrl.startsWith("https://dati.consip.it/"), true);
  assert.equal(Object.keys(validated.metadata.source.assets).length, 6);
});

test("un host che imita il dominio Consip viene rifiutato", () => {
  // "https://dati.consip.it" senza barra finale e' prefisso letterale anche di
  // "https://dati.consip.it.example.org": un controllo di provenienza che si
  // fermasse li' direbbe ufficiale un host di terzi.
  const spoofedLanding = structuredClone(consipOrdiniMetadata);
  spoofedLanding.source.landingUrl = "https://dati.consip.it.example.org/";
  assert.throws(() => validateConsipOrdiniBundle(consipOrdiniData, spoofedLanding));

  const spoofedCanonical = structuredClone(consipOrdiniMetadata);
  spoofedCanonical.semantics.provenance.canonicalUrls = [
    "https://dati.consip.it.example.org/download/dataset/ordini-mepa-2025.csv",
  ];
  assert.throws(() => validateConsipOrdiniBundle(consipOrdiniData, spoofedCanonical));
});

test("i caveats dichiarano i limiti del dato invece di lasciarli dedurre", () => {
  const caveats = consipOrdiniData.caveats.join(" ");
  assert.match(caveats, /LIMITI INFERIORI/);
  assert.match(caveats, /non è un? pagamento|non coincide con un pagamento/i);
  assert.match(caveats, /storni/i);
});

test("ogni osservazione riconcilia righe note e soppresse", () => {
  for (const section of [consipOrdiniData.byRegion, consipOrdiniData.byAdministrationType]) {
    for (const row of section) {
      assert.equal(row.rowsWithAmount + row.rowsAmountSuppressed, row.rows);
      assert.equal(row.rowsWithOrders + row.rowsOrdersSuppressed, row.rows);
    }
  }
});

test("un artefatto manomesso viene rifiutato, non riparato", () => {
  const tampered = structuredClone(consipOrdiniData);
  tampered.byRegion[0].amountKnownCents += 1;
  assert.throws(() => validateConsipOrdiniBundle(tampered, consipOrdiniMetadata), /non riconciliato/);
});

test("queryConsipOrdini filtra per anno e canale e proietta la fonte", () => {
  const filtered = queryConsipOrdini({ year: 2025, channel: "mepa" });
  assert.equal(filtered.totals.length, 1);
  assert.equal(filtered.totals[0].year, 2025);
  assert.equal(filtered.totals[0].channel, "mepa");
  assert.equal(filtered.byRegion.every((row) => row.year === 2025 && row.channel === "mepa"), true);
  assert.equal(filtered.source.licenseId, "CC-BY-4.0");
  assert.match(filtered.source.suppressionNote, /sopprime/);

  const everything = queryConsipOrdini();
  assert.equal(everything.totals.length, 6);
});

test("queryConsipOrdini rifiuta anni fuori periodo e canali sconosciuti", () => {
  assert.throws(() => queryConsipOrdini({ year: 2023 }), /periodo coperto/);
  assert.throws(() => queryConsipOrdini({ channel: "sdapa" }), /Canale non riconosciuto/);
});
