import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  currentIstatMunicipalityCode,
  istatMunicipalityCodeAliases,
  istatMunicipalityCodeAliasesSource,
} = await import("../src/lib/istat-municipality-code-aliases.ts");

test("Sardinian codes resolve to the same alias pair from either side", () => {
  for (const [current, previous] of [["119014", "111054"], ["119009", "111035"]]) {
    assert.deepEqual(istatMunicipalityCodeAliases(current), [current, previous]);
    assert.deepEqual(istatMunicipalityCodeAliases(previous), [current, previous]);
    assert.equal(currentIstatMunicipalityCode(previous), current);
  }
  assert.deepEqual(istatMunicipalityCodeAliases(" 111054 "), ["119014", "111054"]);
});

test("codes outside the recoding are returned unchanged", () => {
  assert.deepEqual(istatMunicipalityCodeAliases("020030"), ["020030"]);
  assert.deepEqual(istatMunicipalityCodeAliases("015146"), ["015146"]);
  assert.equal(currentIstatMunicipalityCode("020030"), "020030");
});

test("malformed codes yield no alias to join on", () => {
  for (const value of ["", "11105", "1110540", "11105A", "c_g446"]) {
    assert.deepEqual(istatMunicipalityCodeAliases(value), []);
    assert.equal(currentIstatMunicipalityCode(value), null);
  }
});

test("runtime table carries the provenance of the locked ISTAT file", () => {
  const spec = JSON.parse(readFileSync("scripts/etl/specs/istat-sardegna-codici-2026.source.json", "utf8"));
  assert.equal(istatMunicipalityCodeAliasesSource.url, spec.source.url);
  assert.equal(istatMunicipalityCodeAliasesSource.sha256, spec.source.sha256);
  assert.equal(istatMunicipalityCodeAliasesSource.effectiveFrom, "2026-01-01");
  assert.equal(istatMunicipalityCodeAliasesSource.licenseId, "CC-BY-4.0");
});
