import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("SIOPE ETL ranks a low-volume municipality first per capita", async () => {
  const fixture = [
    { name: "Grande", region: "A", codiceFiscale: "1", population: 1_000_000, value: 1_000_000, perCapita: 1 },
    { name: "Piccolo", region: "B", codiceFiscale: "2", population: 10, value: 1_000, perCapita: 100 },
    { name: "Senza popolazione", region: "C", codiceFiscale: "3", population: null, value: 2_000_000, perCapita: null },
  ];
  const code = [
    "import json",
    "from scripts.etl.siope_municipal_snapshot import municipality_rankings, parse_population",
    `items = json.loads(${JSON.stringify(JSON.stringify(fixture))})`,
    "by_value, by_per_capita = municipality_rankings(items, 3)",
    "print(json.dumps({'value': [x['name'] for x in by_value], 'perCapita': [x['name'] for x in by_per_capita], 'sentinel': parse_population('00000001'), 'valid': parse_population('00000125')}))",
  ].join("\n");
  const { stdout } = await execFileAsync("python3", ["-c", code], {
    cwd: new URL("..", import.meta.url),
  });
  const result = JSON.parse(stdout);
  assert.deepEqual(result.value, ["Senza popolazione", "Grande", "Piccolo"]);
  assert.deepEqual(result.perCapita, ["Piccolo", "Grande"]);
  assert.equal(result.sentinel, null);
  assert.equal(result.valid, 125);
});
