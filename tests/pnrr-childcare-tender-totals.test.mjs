import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  formatDerivedTenderTotal,
  summarizeTenderCents,
} = await import("../src/lib/pnrr-childcare-tender-totals.ts");
const pnrrChildcareData = JSON.parse(
  await readFile(new URL("../src/data/generated/pnrr-childcare.data.json", import.meta.url), "utf8"),
);

test("tender totals treat missing amounts as absent, not zero", () => {
  const allMissing = [{ amountCents: null, awardAmountCents: null }];
  assert.equal(formatDerivedTenderTotal(allMissing, "amountCents"), "non disponibile");
  assert.equal(formatDerivedTenderTotal(allMissing, "awardAmountCents"), "non disponibile");

  const partial = [
    { amountCents: 1_000_000, awardAmountCents: 900_000 },
    { amountCents: null, awardAmountCents: null },
  ];
  assert.equal(
    formatDerivedTenderTotal(partial, "amountCents"),
    "almeno 10.000,00\u00a0€ · 1 gara senza importo",
  );
  assert.equal(
    formatDerivedTenderTotal(partial, "awardAmountCents"),
    "almeno 9.000,00\u00a0€ · 1 gara senza importo",
  );

  const complete = [
    { amountCents: 500_000, awardAmountCents: 400_000 },
    { amountCents: 250_000, awardAmountCents: 200_000 },
  ];
  assert.equal(formatDerivedTenderTotal(complete, "amountCents"), "7.500,00\u00a0€");
  assert.equal(formatDerivedTenderTotal(complete, "awardAmountCents"), "6.000,00\u00a0€");
});

test("PNRR childcare projects cited in #781 expose partial or missing tender totals", () => {
  const find = (cup) => pnrrChildcareData.projects.find((project) => project.cup === cup);
  const onlyMissing = find("B75E24000130006");
  assert.ok(onlyMissing);
  assert.equal(formatDerivedTenderTotal(onlyMissing.tenders, "amountCents"), "non disponibile");
  assert.equal(formatDerivedTenderTotal(onlyMissing.tenders, "awardAmountCents"), "non disponibile");

  const partial = find("D45E24000050006");
  assert.ok(partial);
  assert.ok(summarizeTenderCents(partial.tenders, "amountCents").missingCount > 0);
  assert.match(formatDerivedTenderTotal(partial.tenders, "amountCents"), /^almeno /);
  assert.match(formatDerivedTenderTotal(partial.tenders, "amountCents"), /gara senza importo$/);
});
