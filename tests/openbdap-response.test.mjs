import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { isTransientSourceError } from "./helpers/live-openbdap.mjs";

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
