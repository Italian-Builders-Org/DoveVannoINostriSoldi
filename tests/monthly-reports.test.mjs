import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

import companySnapshot from "../src/data/generated/company-atlas-snapshot.json" with { type: "json" };
import debtSnapshot from "../src/data/generated/public-debt.json" with { type: "json" };
import municipalSnapshot from "../src/data/generated/siope-municipal.json" with { type: "json" };
import {
  buildMonthlyReportDraft,
  parseReportArguments,
  writeDraft,
} from "../scripts/reports/new-monthly-report.mjs";
const {
  monthlyReportWordCount,
  validatePublishedMonthlyReport,
} = await import("../src/lib/monthly-reports-contract.ts");
const { createMonthlyReportsCatalog } = await import("../src/lib/monthly-reports.ts");

const revision = "1".repeat(40);
const sha256 = "2".repeat(64);
const provenance = {
  "src/data/generated/company-atlas-snapshot.json": { revision, sha256 },
  "src/data/generated/public-debt.json": { revision, sha256 },
  "src/data/generated/siope-municipal.json": { revision, sha256 },
};

function generatedDraft() {
  return buildMonthlyReportDraft({
    month: "2026-08",
    cutoff: "2026-09-05",
    snapshots: {
      companies: structuredClone(companySnapshot),
      debt: structuredClone(debtSnapshot),
      municipal: structuredClone(municipalSnapshot),
    },
    provenance,
  });
}

function publishedReport(issueMonth = "2026-08") {
  const draft = generatedDraft();
  const prose = Array.from({ length: 145 }, (_, index) => `parola${index}`).join(" ");
  const section = (title) => ({ title, paragraphs: [{ text: prose, evidenceIds: ["company-active-stock"] }] });
  const body = structuredClone(draft);
  delete body.draftNotes;
  delete body.publication;
  return {
    ...body,
    issueMonth,
    status: "published",
    publication: { publishedOn: "2026-09-10", dataCutoff: "2026-09-05" },
    lead: section("La storia del mese"),
    rubrics: {
      numbers: section("Numeri da ricordare"),
      territories: section("Territori"),
      signal: section("Un segnale da capire"),
      sources: section("Fonti e limiti"),
      nextMonth: section("Il mese prossimo"),
    },
    contentRevision: 1,
    corrections: [],
  };
}

test("report:new rifiuta mesi e cutoff non semantici", () => {
  assert.deepEqual(parseReportArguments(["--month", "2026-08", "--cutoff", "2026-09-05"]), { month: "2026-08", cutoff: "2026-09-05" });
  assert.throws(() => parseReportArguments(["--month", "2026-13", "--cutoff", "2026-09-05"]), /mese non valido/);
  assert.throws(() => parseReportArguments(["--month", "2026-08", "--cutoff", "2026-02-30"]), /cutoff non valido/);
});

test("il generatore congela i fatti, le due figure e le venti regioni", () => {
  const companies = structuredClone(companySnapshot);
  const draft = buildMonthlyReportDraft({
    month: "2026-08", cutoff: "2026-09-05",
    snapshots: { companies, debt: structuredClone(debtSnapshot), municipal: structuredClone(municipalSnapshot) },
    provenance,
  });
  assert.equal(draft.figures.length, 2);
  assert.equal(draft.figures[0].rows.length, 16);
  assert.equal(draft.figures[1].rows.length, 20);
  assert.equal(draft.facts.find((fact) => fact.id === "active-stock-latest").value.value, 5_022_940);
  assert.equal(draft.facts.find((fact) => fact.id === "public-debt-latest").value.cents, 320_724_730_000_000);
  assert.equal(draft.facts.find((fact) => fact.id === "municipal-payments-ytd").referencePeriod.completeness, "partial");
  const frozen = JSON.stringify(draft.figures);
  companies.observations[0].value = 999_999_999;
  assert.equal(JSON.stringify(draft.figures), frozen);
});

test("il generatore non sovrascrive e non registra né pubblica la bozza", () => {
  const root = mkdtempSync(join(tmpdir(), "dvns-report-"));
  try {
    const draft = generatedDraft();
    const target = writeDraft(root, draft);
    assert.match(readFileSync(target, "utf8"), /status": "draft"/);
    assert.throws(() => writeDraft(root, draft), /esiste già/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("il contratto pubblicato accetta solo capsule complete e verificabili", () => {
  const valid = publishedReport();
  assert.equal(validatePublishedMonthlyReport(valid), valid);
  assert.ok(monthlyReportWordCount(valid) >= 900 && monthlyReportWordCount(valid) <= 1400);

  const duplicateId = structuredClone(valid);
  duplicateId.facts.push(structuredClone(duplicateId.facts[0]));
  assert.throws(() => validatePublishedMonthlyReport(duplicateId), /fatto duplicato/);

  const noEvidence = structuredClone(valid);
  noEvidence.facts[0].evidenceIds = ["missing"];
  assert.throws(() => validatePublishedMonthlyReport(noEvidence), /fonte sconosciuta/);

  const noDenominator = structuredClone(valid);
  noDenominator.facts[0].value = { kind: "percentage", basisPoints: 100 };
  noDenominator.facts[0].denominator = null;
  assert.throws(() => validatePublishedMonthlyReport(noDenominator), /denominatore obbligatorio/);

  const lateEvidence = structuredClone(valid);
  lateEvidence.evidence[0].checkedOn = "2026-09-06";
  assert.throws(() => validatePublishedMonthlyReport(lateEvidence), /dopo il cutoff/);

  const missingCaveat = structuredClone(valid);
  missingCaveat.figures[0].caveat = "";
  assert.throws(() => validatePublishedMonthlyReport(missingCaveat), /perimetro o caveat assente/);

  const missingPeriod = structuredClone(valid);
  missingPeriod.facts[0].referencePeriod = { kind: "date", date: "2026-02-30" };
  assert.throws(() => validatePublishedMonthlyReport(missingPeriod), /data di riferimento non valida/);

  const oneFigure = structuredClone(valid);
  oneFigure.figures.pop();
  assert.throws(() => validatePublishedMonthlyReport(oneFigure), /esattamente due visualizzazioni/);
});

test("catalogo pubblico ordina le edizioni e non conosce le bozze", () => {
  const august = publishedReport("2026-08");
  const july = publishedReport("2026-07");
  const catalog = createMonthlyReportsCatalog([july, august]);
  assert.deepEqual(catalog.listPublished().map((entry) => entry.issueMonth), ["2026-08", "2026-07"]);
  assert.equal(catalog.getPublished("2026-08")?.title, "Imprese e territori");
  assert.equal(catalog.getPublished("draft"), null);
  assert.deepEqual(Object.keys(catalog).sort(), ["getPublished", "listPublished"]);
});

test("il registry pubblico non importa bozze o snapshot correnti", () => {
  const registry = readFileSync(new URL("../src/content/monthly-reports/published/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(registry, /drafts|data\/generated|fetch\s*\(/);
});
