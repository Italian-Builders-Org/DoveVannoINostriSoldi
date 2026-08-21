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

test("SIOPE ETL resolves official provinces and rejects unknown province codes", async () => {
  const code = [
    "import json, tempfile, zipfile",
    "from pathlib import Path",
    "from scripts.etl.siope_municipal_snapshot import load_municipalities",
    "with tempfile.TemporaryDirectory() as directory:",
    "    archive = Path(directory) / 'registry.zip'",
    "    with zipfile.ZipFile(archive, 'w') as target:",
    "        target.writestr('ANAG_REG_PROV.csv', 'ITALIA NORD-OCCIDENTALE,01,PIEMONTE,004,Cuneo\\n')",
    "        target.writestr('ANAG_ENTI_SIOPE.csv', '1,2020-01-01,9999-12-31,CF1,COMUNE DI TEST,001,004,100,COMUNE\\n')",
    "    active, _, count = load_municipalities(archive, {'CF1': 'Piemonte'})",
    "    province = active['1']['province']",
    "    with zipfile.ZipFile(archive, 'w') as target:",
    "        target.writestr('ANAG_REG_PROV.csv', 'ITALIA NORD-OCCIDENTALE,01,PIEMONTE,004,Cuneo\\n')",
    "        target.writestr('ANAG_ENTI_SIOPE.csv', '1,2020-01-01,9999-12-31,CF1,COMUNE DI TEST,001,999,100,COMUNE\\n')",
    "    try:",
    "        load_municipalities(archive, {'CF1': 'Piemonte'})",
    "    except RuntimeError as error:",
    "        rejected = 'Provincia SIOPE sconosciuta' in str(error)",
    "    else:",
    "        rejected = False",
    "    print(json.dumps({'province': province, 'count': count, 'rejected': rejected}))",
  ].join("\n");
  const { stdout } = await execFileAsync("python3", ["-c", code], {
    cwd: new URL("..", import.meta.url),
  });
  const result = JSON.parse(stdout);

  assert.deepEqual(result, { province: "Cuneo", count: 1, rejected: true });
});
