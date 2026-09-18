import assert from "node:assert/strict";
import test from "node:test";
import { atlasTargets } from "../scripts/browser/politici-atlas-driver.mjs";

const host = "politici.dovevannoinostrisoldi.com";
for (const local of ["127.0.0.1", "localhost"]) {
  test(`both local URLs run on the same server: ${local}`, () => {
    const result = atlasTargets(`http://${local}:3107/politici?person=dep-1`, undefined, host);
    assert.equal(result.urls[1], `http://${host}:3107/`);
    assert.deepEqual(result.extraArgs, [`--host-resolver-rules=MAP ${host} 127.0.0.1`]);
    assert.equal(result.localAlias, result.urls[1]);
  });
}
test("explicit preview alias never inherits a local DNS override", () => {
  const result = atlasTargets("https://preview.example/politici", "https://politici-preview.example/", host);
  assert.deepEqual(result.extraArgs, []);
  assert.equal(result.localAlias, null);
});
test("missing remote alias cannot silently count as full coverage", () => {
  assert.throws(() => atlasTargets("https://preview.example/politici", undefined, host), /DVNS_POLITICI_ALIAS_URL/);
});
test("reject duplicate targets, unsupported URLs and credentials", () => {
  assert.throws(() => atlasTargets("https://preview.example/politici", "https://preview.example/politici", host));
  assert.throws(() => atlasTargets("file:///tmp/atlas.html", undefined, host));
  assert.throws(() => atlasTargets("https://user:password@preview.example", "https://alias.example", host));
  assert.throws(() => atlasTargets("http://localhost:3000/politici", undefined, "name,EXCLUDE *"));
});
