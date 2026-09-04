import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BUDGET_DOCUMENT_CALENDAR_OBSERVED_AT,
  BUDGET_DOCUMENT_CALENDAR_YEAR,
  assertBudgetDocumentCalendar,
  budgetDocumentCalendar,
} from "../src/lib/budget-document-calendar.ts";

test("il calendario 2026 separa documenti pubblicati e attesi", () => {
  assert.equal(BUDGET_DOCUMENT_CALENDAR_YEAR, 2026);
  assert.equal(BUDGET_DOCUMENT_CALENDAR_OBSERVED_AT, "2026-09-03");
  assert.equal(budgetDocumentCalendar.length, 8);
  assert.equal(budgetDocumentCalendar.filter((document) => document.status === "published").length, 6);
  assert.deepEqual(
    budgetDocumentCalendar
      .filter((document) => document.status === "expected")
      .map((document) => document.id),
    ["dpfp-2026", "ddl-bilancio-2027"],
  );
  assert.ok(budgetDocumentCalendar.every((document) => document.observedAt === "2026-09-03"));
  assert.ok(budgetDocumentCalendar.every((document) => document.sourceUrl.startsWith("https://")));
  assert.ok(budgetDocumentCalendar.every((document) => document.referencePeriod.length > 0));
});

test("il contratto rifiuta date inventate e fonti non ufficiali", () => {
  assert.throws(
    () => assertBudgetDocumentCalendar([]),
    /elenco vuoto/,
  );

  const expectedWithDate = structuredClone(budgetDocumentCalendar);
  expectedWithDate.at(-1).publishedOn = "2026-10-01";
  assert.throws(
    () => assertBudgetDocumentCalendar(expectedWithDate),
    /data inventata per documento atteso/,
  );

  const unofficial = structuredClone(budgetDocumentCalendar);
  unofficial[0].sourceUrl = "https://example.com/dfp-2026";
  assert.throws(
    () => assertBudgetDocumentCalendar(unofficial),
    /fonte non ufficiale/,
  );

  const missingReferencePeriod = structuredClone(budgetDocumentCalendar);
  missingReferencePeriod[0].referencePeriod = " ";
  assert.throws(
    () => assertBudgetDocumentCalendar(missingReferencePeriod),
    /referencePeriod vuoto/,
  );

  const unknownStatus = structuredClone(budgetDocumentCalendar);
  unknownStatus[0].status = "late";
  assert.throws(
    () => assertBudgetDocumentCalendar(unknownStatus),
    /stato inatteso/,
  );

  const impossibleDate = structuredClone(budgetDocumentCalendar);
  impossibleDate[0].publishedOn = "2026-02-31";
  assert.throws(
    () => assertBudgetDocumentCalendar(impossibleDate),
    /non è una data ISO valida/,
  );

  const duplicateId = structuredClone(budgetDocumentCalendar);
  duplicateId[1].id = duplicateId[0].id;
  assert.throws(
    () => assertBudgetDocumentCalendar(duplicateId),
    /id duplicato/,
  );
});

test("la pagina spiega limiti, stato e provenienza del calendario", async () => {
  const page = await readFile(
    new URL("../src/app/fonti/calendario/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /Quando escono i documenti che guidano i conti pubblici/);
  assert.match(page, /Una data non è un dato economico/);
  assert.match(page, /atteso.+non significa in ritardo/s);
  assert.match(page, /target="_blank"/);
  assert.match(page, /aria-label=/);
});
