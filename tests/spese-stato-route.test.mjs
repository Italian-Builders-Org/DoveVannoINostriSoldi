import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { parseReferencePeriod } = await import("../src/lib/data/reference-period.ts");

test("year e month non sono parametri riconosciuti: restituiscono periodo vuoto", () => {
  const result = parseReferencePeriod(new URLSearchParams("year=2025&month=8"));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {});
});

test("anno e mese italiani vengono accettati", () => {
  const result = parseReferencePeriod(new URLSearchParams("anno=2025&mese=8"));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { year: 2025, month: 8 });
});

test("mese senza anno viene rifiutato", () => {
  const result = parseReferencePeriod(new URLSearchParams("mese=8"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /anno/i);
});

test("anno o mese non validi vengono rifiutati", () => {
  for (const query of ["anno=2025x", "anno=1999", "anno=2025&mese=0", "anno=2025&mese=13"]) {
    const result = parseReferencePeriod(new URLSearchParams(query));
    assert.equal(result.ok, false, query);
  }
});

test("produzione: year/month ignorati, anno/mese filtrano", async (context) => {
  const base = "https://www.dovevannoinostrisoldi.com/api/spese/stato";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const [latest, english, italian] = await Promise.all([
      fetch(base, { signal: controller.signal }),
      fetch(`${base}?year=2025&month=8`, { signal: controller.signal }),
      fetch(`${base}?anno=2025&mese=8`, { signal: controller.signal }),
    ]);
    if (!latest.ok || !english.ok || !italian.ok) {
      context.skip("endpoint produzione non raggiungibile");
      return;
    }
    const latestPayload = await latest.json();
    const englishPayload = await english.json();
    const italianPayload = await italian.json();
    assert.equal(latestPayload.ok, true);
    assert.deepEqual(latestPayload.period, englishPayload.period);
    assert.equal(italianPayload.period.year, 2025);
    assert.equal(italianPayload.period.month, 8);
  } catch (error) {
    if (error?.name === "AbortError") {
      context.skip("endpoint produzione non raggiungibile");
      return;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
});
