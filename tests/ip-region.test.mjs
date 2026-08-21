import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { italianRegionFromVercelHeaders } = await import("../src/lib/ip-region.ts");

test("maps every Italian ISO 3166-2 subdivision used by Vercel", () => {
  const cases = [
    ["21", "01", "Piemonte"], ["23", "02", "Valle d'Aosta/Vallée d'Aoste"],
    ["25", "03", "Lombardia"], ["32", "04", "Trentino-Alto Adige/Südtirol"],
    ["34", "05", "Veneto"], ["36", "06", "Friuli-Venezia Giulia"],
    ["42", "07", "Liguria"], ["45", "08", "Emilia-Romagna"],
    ["52", "09", "Toscana"], ["55", "10", "Umbria"], ["57", "11", "Marche"],
    ["62", "12", "Lazio"], ["65", "13", "Abruzzo"], ["67", "14", "Molise"],
    ["72", "15", "Campania"], ["75", "16", "Puglia"], ["77", "17", "Basilicata"],
    ["78", "18", "Calabria"], ["82", "19", "Sicilia"], ["88", "20", "Sardegna"],
  ];

  for (const [subdivision, istatCode, name] of cases) {
    const result = italianRegionFromVercelHeaders(new Headers({
      "x-vercel-ip-country": "IT",
      "x-vercel-ip-country-region": subdivision,
    }));
    assert.deepEqual(result, { istatCode, name });
  }
});

test("accepts a prefixed subdivision and rejects foreign or malformed headers", () => {
  assert.equal(
    italianRegionFromVercelHeaders(new Headers({
      "x-vercel-ip-country": "it",
      "x-vercel-ip-country-region": "IT-62",
    }))?.istatCode,
    "12",
  );
  assert.equal(italianRegionFromVercelHeaders(new Headers()), null);
  assert.equal(italianRegionFromVercelHeaders(new Headers({
    "x-vercel-ip-country": "FR",
    "x-vercel-ip-country-region": "IDF",
  })), null);
  assert.equal(italianRegionFromVercelHeaders(new Headers({
    "x-vercel-ip-country": "IT",
    "x-vercel-ip-country-region": "invalid",
  })), null);
});
