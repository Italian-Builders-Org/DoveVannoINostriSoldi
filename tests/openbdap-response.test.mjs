import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { isTransientSourceError, runLiveOpenBdap } from "./helpers/live-openbdap.mjs";

test("live OpenBDAP handles discovery outages after a successful probe and propagates contract failures", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("{}"));
  const skipped = [];
  const context = { skip: (reason) => skipped.push(reason) };
  for (const status of [429, 500, 502, 503, 504]) {
    await runLiveOpenBdap(context, async () => {
      throw new Error(`OpenBDAP package_search HTTP ${status}`);
    });
  }
  assert.equal(skipped.length, 5);
  assert.ok(skipped.every((reason) => reason.includes("non raggiungibile")));
  for (const error of [
    ...[400, 401, 403, 404].map((status) => new Error(`OpenBDAP package_search HTTP ${status}`)),
    new Error("OpenBDAP package_search HTTP 503: unexpected schema"),
    new Error("Header CSV divergente"),
    new assert.AssertionError({ message: "OpenBDAP package_search HTTP 503" }),
  ]) {
    await assert.rejects(runLiveOpenBdap(context, async () => { throw error; }), (actual) => actual === error);
  }
  assert.equal(skipped.length, 5);
});

test("live OpenBDAP classifies CSV outages without hiding contract or client errors", () => {
  for (const status of [429, 500, 502, 503, 504]) {
    assert.equal(isTransientSourceError(new Error(`OpenBDAP CSV HTTP ${status}`)), true);
    assert.equal(isTransientSourceError(new Error(`OpenBDAP CSV HTTP ${status} per l'anno 2012`)), true);
  }
  for (const message of ["OpenBDAP CSV HTTP 400", "OpenBDAP CSV HTTP 401", "OpenBDAP CSV HTTP 403", "OpenBDAP CSV HTTP 404", "Header CSV divergente", "Expected OpenBDAP CSV HTTP 503"]) {
    assert.equal(isTransientSourceError(new Error(message)), false);
  }
  assert.equal(isTransientSourceError(new assert.AssertionError({ message: "unexpected CSV contract" })), false);
  assert.equal(isTransientSourceError(new assert.AssertionError({ message: "OpenBDAP CSV HTTP 503" })), false);
  assert.equal(isTransientSourceError(new Error("OpenBDAP CSV HTTP 404 per l'anno 2012")), false);
  assert.equal(isTransientSourceError(new Error("OpenBDAP CSV HTTP 503 per l'anno invalido")), false);
});

const {
  isOpenBdapCsvConversionError,
  OpenBdapUnavailableError,
} = await import("../src/lib/data/openbdap-response.ts");
const { SourceFetchError } = await import("../src/lib/data/source-fetch.ts");

test("recognizes only the known OpenBDAP CSV conversion outage", () => {
  assert.equal(
    isOpenBdapCsvConversionError(JSON.stringify({
      success: false,
      error: { message: "Cannot convert data to csv" },
    })),
    true,
  );
  assert.equal(
    isOpenBdapCsvConversionError(JSON.stringify({
      success: false,
      error: { message: "Cannot convert data to csv. Attachment not found" },
    })),
    true,
  );
});

test("does not hide unknown JSON, schema drift, or non-JSON responses", () => {
  assert.equal(isOpenBdapCsvConversionError('{"error":{"message":"Schema changed"}}'), false);
  assert.equal(
    isOpenBdapCsvConversionError('{"success":true,"error":{"message":"Cannot convert data to csv"}}'),
    false,
  );
  assert.equal(isOpenBdapCsvConversionError('{"success":true,"result":[]}'), false);
  assert.equal(isOpenBdapCsvConversionError("Anno;Importo\n2024;1"), false);
  assert.equal(isOpenBdapCsvConversionError("<html>maintenance</html>"), false);
});

test("live checks skip only explicit OpenBDAP outages and network failures", () => {
  assert.equal(isTransientSourceError(new OpenBdapUnavailableError("CSV non disponibile")), true);
  assert.equal(
    isTransientSourceError(new SourceFetchError("Errore di rete verso openbdap dopo 2 tentativo/i", "openbdap")),
    true,
  );
  assert.equal(isTransientSourceError(Object.assign(new Error("timeout"), { name: "TimeoutError" })), true);
});

test("live checks do not hide source configuration or data-contract failures", () => {
  assert.equal(
    isTransientSourceError(new SourceFetchError("Host non consentito per la fonte openbdap", "openbdap")),
    false,
  );
  assert.equal(isTransientSourceError(new Error("Header CSV divergente")), false);
  assert.equal(isTransientSourceError(new Error("Anno incoerente")), false);
});
