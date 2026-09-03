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
  assert.match(page, /buildAiInterventionMap/);
  assert.match(page, /buildAiNextMoves/);
  assert.match(page, /agenda-ai/);
  assert.match(page, /mappa-interventi/);
  assert.match(page, /ancora-da-fare/);
  assert.match(page, /In pratica propone/);
  assert.match(page, /aiZone|aiHero|aiBrief|aiProposal/);
  assert.match(page, /Regole AI/);
  assert.match(page, /aiStewardshipDisclosure/);
  assert.match(page, /Non attribuiamo sprechi, illeciti o responsabilità/);
  assert.doesNotMatch(page, /\b(frode|corrotto|colpevole|spreco accertato)\b/i);
  assert.doesNotMatch(lib, /—|–/);
  assert.match(lib, /OpenCivitas/);
  assert.match(lib, /proposal:/);
  assert.match(lib, /buildAiNextMoves/);
  assert.match(lib, /buildAiInterventionMap/);
  assert.match(lib, /Cosa proporrebbe un agente AI/);
  assert.match(lib, /mefParticipationsSnapshot/);
  assert.match(lib, /opencoesioneOverview/);
  assert.match(nav, /\/controlli\/sintesi/);
  assert.match(nav, /label: "Sintesi"/);
});

test("buildControlliSintesiPathways and AI agenda stay sourced and non-accusatory", async () => {
  const {
    buildControlliSintesiPathways,
    buildAiStewardshipAgenda,
    buildAiInterventionMap,
    buildAiNextMoves,
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

  const agenda = buildAiStewardshipAgenda(pathways);
  assert.ok(agenda.length >= 5);
  assert.match(aiStewardshipDisclosure.badge, /agenti AI/i);
  assert.match(aiStewardshipDisclosure.title, /Cosa proporrebbe un agente AI/);
  assert.match(aiStewardshipDisclosure.howToRead, /In pratica propone/i);
  for (const move of agenda) {
    assert.ok(move.metric.display.trim().length > 0, move.id);
    assert.ok(move.bars.length >= 2, move.id);
    assert.ok(move.concerns.trim().length > 20, move.id);
    assert.match(move.proposal, /Propone/i, move.id);
    assert.ok(move.operation.trim().length > 30, move.id);
    assert.ok(move.effect.trim().length > 20, move.id);
    assert.doesNotMatch(
      `${move.title}\n${move.proposal}\n${move.concerns}\n${move.operation}\n${move.effect}`,
      /\b(corrotto|frode|colpevole|spreco accertato)\b/i,
    );
    assert.doesNotMatch(
      `${move.proposal}\n${move.concerns}\n${move.operation}\n${move.effect}`,
      /—|–/,
    );
  }

  const map = buildAiInterventionMap(agenda);
  assert.equal(map.length, agenda.length);
  assert.ok(map.every((step) => step.plain.includes("Propone") || /Propone/i.test(step.plain)));

  const next = buildAiNextMoves();
  assert.ok(next.length >= 6);
  for (const move of next) {
    assert.match(move.proposal, /Propone/i, move.id);
    assert.match(move.deepenHref, /^\//);
    assert.ok(move.sourceNote.trim().length > 5, move.id);
    assert.doesNotMatch(`${move.title}\n${move.proposal}\n${move.effect}`, /—|–|\b(frode|corrotto)\b/i);
  }
  assert.ok(next.some((move) => move.id === "next-off-budget"));
  assert.ok(next.some((move) => move.id === "next-pnrr-cohesion"));
  assert.ok(next.some((move) => move.id === "next-participations"));
  assert.ok(next.some((move) => move.id === "next-consip-gate"));
});
