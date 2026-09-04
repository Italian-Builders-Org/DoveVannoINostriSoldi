import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { parseDelimitedRecords, parsePublicNumber } = await import(
  "../src/lib/data/delimited.ts"
);
const { classifyFreshness } = await import("../src/lib/data/freshness.ts");
const { SOURCE_IDS, SOURCE_POLICIES } = await import("../src/lib/data/source-policy.ts");
const { publicSources } = await import("../src/lib/sources.ts");
const { fetchOfficialSource } = await import("../src/lib/data/source-fetch.ts");

test("semicolon parser preserves quoted delimiters and escaped quotes", () => {
  const csv = [
    '"Nome";"Descrizione";"Totale";',
    '"Ente A";"Voce; con separatore";1234.50;',
    '"Ente B";"Testo con ""virgolette""";10,25;',
  ].join("\r\n");

  const records = parseDelimitedRecords(csv);

  assert.equal(records.length, 2);
  assert.deepEqual(records[0], {
    Nome: "Ente A",
    Descrizione: "Voce; con separatore",
    Totale: "1234.50",
  });
  assert.equal(records[1].Descrizione, 'Testo con "virgolette"');
  assert.equal(parsePublicNumber(records[1].Totale), 10.25);
});

test("public number parser handles whitespace, decimal comma and empty values", () => {
  assert.equal(parsePublicNumber(" 1234,56 "), 1234.56);
  assert.equal(parsePublicNumber("0.00"), 0);
  assert.equal(parsePublicNumber(undefined), 0);
  assert.equal(parsePublicNumber("not-a-number"), 0);
});

test("every registered source has a complete operational policy", () => {
  assert.equal(new Set(SOURCE_IDS).size, SOURCE_IDS.length);
  assert.equal(SOURCE_IDS.length, 27);
  assert.deepEqual(
    [...publicSources.map((source) => source.slug)].sort(),
    [...SOURCE_IDS].sort(),
    "public registry and operational policy registry must stay aligned",
  );

  for (const sourceId of SOURCE_IDS) {
    const policy = SOURCE_POLICIES[sourceId];
    assert.equal(policy.id, sourceId);
    assert.match(policy.sourceUrl, /^https:\/\//);
    assert.ok(policy.discoveryRevalidateSeconds > 0);
    assert.ok(policy.dataRevalidateSeconds > 0);
    assert.ok(policy.timeoutMs >= 1_000);
    assert.ok(policy.maxRetries >= 0 && policy.maxRetries <= 2);
    assert.ok(policy.tags.includes(`source:${sourceId}`));
  }
});

test("ISTAT Casellario remains snapshot-only at runtime", async () => {
  await assert.rejects(
    fetchOfficialSource(
      "istat-casellario-pensioni",
      "https://esploradati.istat.it/SDMXWS/rest/data/IT1,46_813,1.0",
    ),
    /Host non consentito per la fonte istat-casellario-pensioni/,
  );
});

test("freshness uses source thresholds without inventing missing ones", () => {
  const now = new Date("2026-08-19T20:00:00.000Z");
  const ipaThreshold = SOURCE_POLICIES.ipa.staleAfterSeconds;

  const freshIpa = classifyFreshness(
    ipaThreshold,
    "2026-08-18T20:00:00.000Z",
    now,
  );
  assert.equal(freshIpa.state, "fresh");
  assert.equal(freshIpa.ageSeconds, 86_400);

  const staleIpa = classifyFreshness(
    ipaThreshold,
    "2026-08-16T20:00:00.000Z",
    now,
  );
  assert.equal(staleIpa.state, "stale");

  const periodicWithoutThreshold = classifyFreshness(
    SOURCE_POLICIES.camera.staleAfterSeconds,
    "2026-08-19T12:00:00.000Z",
    now,
  );
  assert.equal(periodicWithoutThreshold.state, "unknown");
  assert.equal(periodicWithoutThreshold.ageSeconds, 28_800);

  const futureTimestamp = classifyFreshness(
    ipaThreshold,
    "2026-08-20T20:00:00.000Z",
    now,
  );
  assert.equal(futureTimestamp.state, "unknown");
});
