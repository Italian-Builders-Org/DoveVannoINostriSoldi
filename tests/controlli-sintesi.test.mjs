import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

test("controlli sintesi page keeps verification copy and no automatic guilt labels", async () => {
  const [page, lib, nav] = await Promise.all([
    source("../src/app/controlli/sintesi/page.tsx"),
    source("../src/lib/controlli-sintesi.ts"),
    source("../src/lib/site-navigation.ts"),
  ]);

  assert.match(page, /Cosa monitorare, dove approfondire/);
  assert.match(page, /buildControlliSintesiPathways/);
  assert.match(page, /buildAiStewardshipAgenda/);
  assert.match(page, /agenda-ai/);
  assert.match(page, /aiZone|aiHero|aiBrief/);
  assert.match(page, /Cosa riguarda/);
  assert.match(page, /Operazione/);
  assert.match(page, /Effetto/);
  assert.match(page, /Regole AI/);
  assert.match(page, /aiStewardshipDisclosure/);
  assert.match(page, /Non attribuiamo sprechi, illeciti o responsabilità/);
  assert.doesNotMatch(page, /\b(frode|corrotto|colpevole|spreco accertato)\b/i);
  assert.doesNotMatch(lib, /—|–/);
  assert.match(lib, /OpenCivitas/);
  assert.match(lib, /procurementComparisons/);
  assert.match(lib, /rgsConsultingSnapshot/);
  assert.match(lib, /centralScenarioBreakdown/);
  assert.match(lib, /buildAiStewardshipAgenda/);
  assert.match(lib, /aiStewardshipDisclosure/);
  assert.match(lib, /Agenda gestita da agenti AI/);
  assert.match(lib, /concerns:/);
  assert.match(lib, /operation:/);
  assert.match(lib, /effect:/);
  assert.match(lib, /metric:/);
  assert.match(lib, /bars:/);
  assert.match(lib, /non dimostra uno spreco/i);
  assert.match(nav, /\/controlli\/sintesi/);
  assert.match(nav, /label: "Sintesi"/);
});

test("buildControlliSintesiPathways and AI agenda stay sourced and non-accusatory", async () => {
  const {
    buildControlliSintesiPathways,
    buildAiStewardshipAgenda,
    aiStewardshipDisclosure,
  } = await import("../src/lib/controlli-sintesi.ts");
  const pathways = buildControlliSintesiPathways();
  assert.ok(pathways.length >= 10);
  for (const pathway of pathways) {
    assert.ok(pathway.observation.trim().length > 40, pathway.id);
    assert.ok(pathway.action.trim().length > 20, pathway.id);
    assert.ok(pathway.sourceLabel.trim().length > 3, pathway.id);
    assert.ok(pathway.period.trim().length > 0, pathway.id);
    assert.ok(pathway.limits.trim().length > 10, pathway.id);
    assert.match(pathway.deepenHref, /^\//);
    assert.doesNotMatch(
      `${pathway.headline}\n${pathway.observation}\n${pathway.action}`,
      /\b(corrotto|frode|colpevole|spreco accertato)\b/i,
    );
  }
  assert.ok(pathways.some((pathway) => pathway.id === "opencivitas-outliers"));
  assert.ok(pathways.some((pathway) => pathway.id === "anac-direct-awards"));
  assert.ok(pathways.some((pathway) => pathway.id === "improvement-hypothesis"));
  assert.ok(pathways.some((pathway) => pathway.id === "public-debt-interest"));
  assert.ok(pathways.some((pathway) => pathway.id === "opencivitas-high-low"));
  assert.ok(pathways.some((pathway) => pathway.id === "ssn-production-costs"));

  const agenda = buildAiStewardshipAgenda(pathways);
  assert.ok(agenda.length >= 5);
  assert.match(aiStewardshipDisclosure.badge, /agenti AI/i);
  assert.match(aiStewardshipDisclosure.title, /Agenda gestita da agenti AI/);
  assert.match(aiStewardshipDisclosure.lead, /separata di proposito|etichettata come AI/i);
  for (const move of agenda) {
    assert.ok(move.metric.display.trim().length > 0, move.id);
    assert.ok(move.bars.length >= 2, move.id);
    assert.ok(move.concerns.trim().length > 15, move.id);
    assert.ok(move.operation.trim().length > 30, move.id);
    assert.ok(move.effect.trim().length > 20, move.id);
    assert.ok(move.chartCaption.trim().length > 10, move.id);
    assert.match(move.operation, /L'agente|agente/i);
    assert.doesNotMatch(
      `${move.title}\n${move.concerns}\n${move.operation}\n${move.effect}`,
      /\b(corrotto|frode|colpevole|spreco accertato)\b/i,
    );
    assert.doesNotMatch(
      `${move.concerns}\n${move.operation}\n${move.effect}\n${move.chartCaption}`,
      /—|–/,
    );
  }
});
