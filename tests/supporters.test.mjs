import assert from "node:assert/strict";
import test from "node:test";

const { INDIVIDUAL_SUPPORTERS, SITE_SUPPORTERS } = await import(
  "../src/lib/supporters.ts"
);

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

test("public supporter data does not expose email addresses", () => {
  for (const supporter of [...INDIVIDUAL_SUPPORTERS, ...SITE_SUPPORTERS]) {
    assert.doesNotMatch(supporter.name, EMAIL_PATTERN);
    assert.doesNotMatch(supporter.contribution, EMAIL_PATTERN);
    assert.doesNotMatch(supporter.href ?? "", /^mailto:/i);
  }
});

test("individual supporters have unique public names and one anonymous aggregate", () => {
  const normalizedNames = INDIVIDUAL_SUPPORTERS.map((supporter) =>
    supporter.name.trim().toLocaleLowerCase("it"),
  );
  assert.equal(new Set(normalizedNames).size, normalizedNames.length);

  const anonymous = INDIVIDUAL_SUPPORTERS.filter((supporter) => supporter.name === "Someone");
  assert.equal(anonymous.length, 1);
  assert.match(anonymous[0].contribution, /5 ai compute in totale/);
});

test("supporter profile links are explicit HTTPS URLs", () => {
  for (const supporter of [...INDIVIDUAL_SUPPORTERS, ...SITE_SUPPORTERS]) {
    if (!supporter.href) continue;
    const url = new URL(supporter.href);
    assert.equal(url.protocol, "https:", supporter.name);
    assert.ok(url.hostname, supporter.name);
  }
});
