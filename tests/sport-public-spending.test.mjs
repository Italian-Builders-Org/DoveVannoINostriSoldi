import assert from "node:assert/strict";
import { createGunzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

async function source(relativePath) {
  const { readFile } = await import("node:fs/promises");
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

async function focusNames() {
  const path = fileURLToPath(
    new URL("../src/data/generated/integrated/rows/partecipate-statali-focus.part-00000.jsonl.gz", import.meta.url),
  );
  const names = new Set();
  const stream = createReadStream(path).pipe(createGunzip());
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const name = row?.cells?.nome;
    if (typeof name === "string") names.add(name);
  }
  return names;
}

test("sport page stays fail-closed and wired into nav/discovery", async () => {
  const [page, lib, nav, discovery, search] = await Promise.all([
    source("../src/app/spese/sport/page.tsx"),
    source("../src/lib/sport-public-spending.ts"),
    source("../src/lib/site-navigation.ts"),
    source("../src/lib/public-discovery.ts"),
    source("../src/lib/global-search.ts"),
  ]);

  assert.match(page, /Sport: missione di bilancio/);
  assert.match(page, /buildSportPublicSpendingView/);
  assert.match(page, /Non sommiamo queste fonti/);
  assert.doesNotMatch(page, /\b(frode|corrotto|spreco accertato)\b/i);
  assert.doesNotMatch(lib, /—|–/);
  assert.match(lib, /Giovani e sport/);
  assert.match(lib, /SPORT_FOCUS_ENTITIES/);
  assert.match(lib, /Totale unico della spesa sportiva/);
  assert.match(nav, /\/spese\/sport/);
  assert.match(nav, /label: "Sport"/);
  assert.match(discovery, /\/spese\/sport/);
  assert.match(search, /\/spese\/sport/);
});

test("buildSportPublicSpendingView exposes sourced mission series and entities", async () => {
  const { buildSportPublicSpendingView, SPORT_FOCUS_ENTITIES } = await import(
    "../src/lib/sport-public-spending.ts"
  );
  const view = buildSportPublicSpendingView();

  assert.equal(view.missionLabel, "Giovani e sport");
  assert.ok(view.budgetLaw.series.length >= 5);
  assert.equal(view.budgetLaw.latest.year, view.budgetLaw.series.at(-1).year);
  assert.ok(view.budgetLaw.latest.enactedEur > 0);
  assert.equal(view.pcm.missionCode, "30");
  assert.ok(view.pcm.paymentsCents > 0);
  assert.equal(view.rgs.missionCode, "030");
  assert.ok(view.rgs.paymentsCompetenceCpCents > 0);
  assert.equal(view.entities.length, SPORT_FOCUS_ENTITIES.length);
  assert.ok(view.outOfScope.length >= 3);
  assert.doesNotMatch(
    `${view.readingNotes.join("\n")}\n${view.outOfScope.join("\n")}`,
    /—|–|\b(frode|corrotto)\b/i,
  );

  const names = await focusNames();
  for (const entity of SPORT_FOCUS_ENTITIES) {
    assert.ok(names.has(entity.name), `entity missing from focus corpus: ${entity.name}`);
  }
});
