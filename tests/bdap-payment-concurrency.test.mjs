import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { getStateSpendingSnapshot } = await import("../src/lib/bdap-payments.ts");

test("required mission CSV starts while optional discovery is still pending", async () => {
  const originalFetch = globalThis.fetch;
  let releaseCompanions;
  const companions = new Promise(resolve => { releaseCompanions = resolve; });
  let missionStarted;
  const started = new Promise(resolve => { missionStarted = resolve; });
  const id = "12345678-1234-4abc-8def-1234567890ab";
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("package_search")) {
      if (url.searchParams.get("q") !== "PBS_SPE_RND_MISS_001") {
        await companions;
        return Response.json({ success: true, result: { results: [] } });
      }
      return Response.json({ success: true, result: { results: [{
        id, name: "annual-mission", title: "2025 - Pagamenti Bilancio dello Stato per Missione Consuntivo",
        notes: "Dati di Spesa relativi ai pagamenti Bilancio dello Stato per l'esercizio finanziario di riferimento. - [PBS_SPE_RND_MISS_001]",
      }] } });
    }
    missionStarted();
    return new Response("Esercizio finanziario;Codice Missione;Missione;OP Erario;OP Tesoreria;OP Esterno;OA Tesoreria;OA Spesa Funz Deleg;RSF Stipendi;RSF Altro;Note Imputazione;Totale pagato\n2025;001;Missione;100;0;0;0;0;0;0;0;100", { headers: { "content-type": "text/csv" } });
  };
  let request;
  try {
    request = getStateSpendingSnapshot({ year: 2025 });
    const outcome = await Promise.race([started.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 100))]);
    assert.equal(outcome, true, "optional catalog discovery must not delay the mandatory CSV");
  } finally {
    releaseCompanions();
    if (request) {
      const snapshot = await request;
      assert.equal(snapshot.totalPaid, 100);
      assert.equal(snapshot.period.releaseKind, "consuntivo");
      assert.equal(snapshot.period.year, 2025);
      assert.equal(snapshot.availability.administrations, "unavailable");
    }
    globalThis.fetch = originalFetch;
  }
});
