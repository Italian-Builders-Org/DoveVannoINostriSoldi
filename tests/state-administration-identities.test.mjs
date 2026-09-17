import assert from "node:assert/strict";
import test from "node:test";
import {
  getStateAdministrationIdentity,
  STATE_ADMINISTRATION_IPA_CODES,
} from "../src/lib/data/state-administration-identities.ts";

test("all 15 OpenBDAP ministries have a unique verified IPA code", () => {
  const mappings = Object.entries(STATE_ADMINISTRATION_IPA_CODES);
  assert.equal(mappings.length, 15);
  assert.equal(new Set(mappings.map(([, item]) => item.ipaCode)).size, 15);
  for (const [code, mapping] of mappings) {
    const identity = getStateAdministrationIdentity(code, mapping.openBdapLabel);
    assert.equal(identity?.ipaCode, mapping.ipaCode);
    assert.equal(identity?.joinMethod, "curated-exact");
    assert.match(identity?.entityApiPath ?? "", /^\/api\/enti\//);
  }
});

test("the ministry join fails closed when an official label changes", () => {
  assert.equal(getStateAdministrationIdentity("2", "Ministero rinominato"), null);
  assert.equal(getStateAdministrationIdentity("999", "Ente sconosciuto"), null);
});
