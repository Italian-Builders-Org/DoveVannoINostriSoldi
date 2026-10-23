import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  getTedOpenNoticePage,
  parseTedOpenNotice,
  isTedOpenDeadlineStillValid,
} = await import("../src/lib/ted-open-notices.ts");

test("open status requires a published deadline on or after today", () => {
  assert.equal(isTedOpenDeadlineStillValid("2026-12-01"), true);
  assert.equal(isTedOpenDeadlineStillValid("2020-01-01"), false);
});

test("TED open notices expose nature, deadline and official URL", async () => {
  const page = await getTedOpenNoticePage({ q: "674254-2026", includeExpired: "1" });
  assert.equal(page.dataset.publicRows, 1707);
  assert.equal(page.notices.length, 1);
  assert.equal(page.notices[0].nature, "Forniture");
  assert.match(page.notices[0].deadline, /^2026-/);
  assert.equal(page.notices[0].url, "https://ted.europa.eu/it/notice/-/detail/674254-2026");
  const parsed = parseTedOpenNotice(page.rows[0]);
  assert.equal(parsed.number, page.notices[0].number);
});

test("tipo filter keeps only the requested nature", async () => {
  const servizi = await getTedOpenNoticePage({ tipo: "servizi" });
  assert.ok(servizi.notices.length > 0);
  assert.ok(servizi.notices.every((row) => row.nature === "Servizi"));
  await assert.rejects(getTedOpenNoticePage({ tipo: "invalido" }));
});
