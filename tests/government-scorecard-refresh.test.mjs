import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Isolate module caches while exercising the real runtime against a future
// oath fixture. No tracked files or production registry are changed.
test("a new oath becomes current, closes its predecessor and receives no forecast-based score", () => {
  const script = `
    import './tests/helpers/register-ts-alias.mjs';
    import { readFileSync } from 'node:fs';
    import { registerHooks } from 'node:module';
    const registry = JSON.parse(readFileSync('scripts/etl/specs/government-scorecard-chronology.json', 'utf8'));
    registry.asOfDate = registry.verifiedAt = '2026-09-04';
    registry.governments.push({
      id: 'fixture-i', name: 'Fixture I', startDate: '2026-09-04',
      sourceOwner: 'Presidenza della Repubblica',
      sourceUrl: 'https://www.quirinale.it/it/notizie/fixture-giuramento',
      sourceLocator: 'Fixture del giuramento verificato del 4 settembre 2026.'
    });
    registerHooks({load(url, context, nextLoad) {
      if (url.endsWith('/government-scorecard-chronology.json')) {
        return { format: 'json', source: JSON.stringify(registry), shortCircuit: true };
      }
      return nextLoad(url, context);
    }});
    const { GOVERNMENT_SCORECARD_V6_CHRONOLOGY: chronology } = await import('./src/lib/government-scorecard-chronology.ts');
    const { getGovernmentScorecardV6Assessment: assess, GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS: ids } = await import('./src/lib/government-scorecard-governments.ts');
    console.log(JSON.stringify({ ids, current: chronology.at(-1), previous: chronology.at(-2), assessment: assess('fixture-i') }));
  `;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ids.at(-1), "fixture-i");
  assert.equal(output.current.status, "current");
  assert.equal(output.previous.status, "ended");
  assert.equal(output.previous.end_exclusive, "2026-09-04");
  assert.equal(output.assessment.score_state, "not_scored_short");
  assert.equal(output.assessment.window.end_year, null);
  assert.equal(output.assessment.gate.forecast_free, true);
});
