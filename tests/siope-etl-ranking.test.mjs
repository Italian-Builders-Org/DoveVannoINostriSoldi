import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { PYTHON_BIN } from "./helpers/python.mjs";

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
  const { stdout } = await execFileAsync(PYTHON_BIN, ["-c", code], {
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
    "    active, _, count = load_municipalities(archive, {'CF1': 'Piemonte'}, 2026)",
    "    province = active['1']['province']",
    "    with zipfile.ZipFile(archive, 'w') as target:",
    "        target.writestr('ANAG_REG_PROV.csv', 'ITALIA NORD-OCCIDENTALE,01,PIEMONTE,004,Cuneo\\n')",
    "        target.writestr('ANAG_ENTI_SIOPE.csv', '1,2020-01-01,9999-12-31,CF1,COMUNE DI TEST,001,999,100,COMUNE\\n')",
    "    try:",
    "        load_municipalities(archive, {'CF1': 'Piemonte'}, 2026)",
    "    except RuntimeError as error:",
    "        rejected = 'Provincia SIOPE sconosciuta' in str(error)",
    "    else:",
    "        rejected = False",
    "    print(json.dumps({'province': province, 'count': count, 'rejected': rejected}))",
  ].join("\n");
  const { stdout } = await execFileAsync(PYTHON_BIN, ["-c", code], {
    cwd: new URL("..", import.meta.url),
  });
  const result = JSON.parse(stdout);

  assert.deepEqual(result, { province: "Cuneo", count: 1, rejected: true });
});

test("SIOPE registry validity is evaluated against the requested year", async () => {
  const code = [
    "import json, tempfile, zipfile",
    "from pathlib import Path",
    "from scripts.etl.siope_municipal_snapshot import load_municipalities",
    "with tempfile.TemporaryDirectory() as directory:",
    "    archive = Path(directory) / 'registry.zip'",
    "    with zipfile.ZipFile(archive, 'w') as target:",
    "        target.writestr('ANAG_REG_PROV.csv', 'ITALIA NORD-OCCIDENTALE,01,PIEMONTE,004,Cuneo\\n')",
    "        target.writestr('ANAG_ENTI_SIOPE.csv', '1,2024-01-01,2026-06-30,CF1,COMUNE STORICO,001,004,100,COMUNE\\n')",
    "    active_2026, _, count_2026 = load_municipalities(archive, {'CF1': 'Piemonte'}, 2026)",
    "    active_2027, _, count_2027 = load_municipalities(archive, {'CF1': 'Piemonte'}, 2027)",
    "    print(json.dumps({'active2026': sorted(active_2026), 'active2027': sorted(active_2027), 'count2026': count_2026, 'count2027': count_2027}))",
  ].join("\n");
  const { stdout } = await execFileAsync(PYTHON_BIN, ["-c", code], {
    cwd: new URL("..", import.meta.url),
  });
  assert.deepEqual(JSON.parse(stdout), {
    active2026: ["1"],
    active2027: [],
    count2026: 1,
    count2027: 0,
  });
});

test("SIOPE ETL builds resident-weighted distribution from the full municipal input", async () => {
  const rows = [
    { region: "Nord", population: 100, totalCents: 200_000, titleCents: 100_000 },
    { region: "Nord", population: 300, totalCents: 1_200_000, titleCents: 600_000 },
    { region: "Sud", population: 600, totalCents: 3_600_000, titleCents: 1_800_000 },
    { region: "Sud", population: 1_000, totalCents: 8_000_000, titleCents: 4_000_000 },
    { region: "Sud", population: null, totalCents: 2_000_000, titleCents: 1_000_000 },
    { region: null, population: 500, totalCents: 1_000_000, titleCents: 500_000 },
  ];
  const code = [
    "import json",
    "from scripts.etl.siope_municipal_snapshot import build_distribution",
    `rows = json.loads(${JSON.stringify(JSON.stringify(rows))})`,
    "validators = {k: {'lastModified': 'now', 'sha256': 'a' * 64} for k in ('movements', 'registry', 'ipa')}",
    "result = build_distribution(rows=rows, year=2026, latest_month=8, observed_at='2026-08-21T00:00:00+00:00', validators=validators)",
    "print(json.dumps(result))",
  ].join("\n");
  const { stdout } = await execFileAsync(PYTHON_BIN, ["-c", code], {
    cwd: new URL("..", import.meta.url),
  });
  const result = JSON.parse(stdout);

  assert.equal(result.schemaVersion, 2);
  assert.equal(result.period.completeness, "partial");
  assert.equal(result.coverage.municipalitiesWithMovements, 6);
  assert.equal(result.coverage.municipalitiesWithValidPopulation, 5);
  assert.equal(result.coverage.populationCovered, 2_500);
  assert.equal(result.coverage.municipalitiesWithRegion, 5);
  assert.equal(result.coverage.municipalitiesWithoutRegion, 1);
  assert.equal(result.coverage.municipalitiesWithValidPopulationAndRegion, 4);
  assert.equal(result.coverage.populationRegionalized, 2_000);
  assert.equal(result.coverage.paymentsWithoutRegion, 10_000);
  assert.equal(result.coverage.titlePaymentsWithoutRegion, 5_000);
  assert.equal(result.coverage.paymentsWithPopulationWithoutRegion, 10_000);
  assert.equal(result.coverage.titlePaymentsWithPopulationWithoutRegion, 5_000);
  assert.equal(result.nationalShareAll, 0.5);
  assert.equal(result.nationalShareCovered, 0.5);
  assert.deepEqual(result.perCapita.municipalityWeighted, {
    p10: 10,
    p25: 10,
    p50: 20,
    p75: 30,
    p90: 40,
  });
  assert.deepEqual(result.perCapita.residentWeighted, {
    p10: 10,
    p25: 20,
    p50: 30,
    p75: 40,
    p90: 40,
  });
  assert.equal(result.populationBands[0].municipalities, 4);
  assert.equal(result.populationBands[1].municipalities, 1);
  assert.deepEqual(result.regions.map((item) => item.region), ["Nord", "Sud"]);
  assert.equal(result.regions.reduce((total, item) => total + item.municipalities, 0), 4);
  assert.equal(result.regions.reduce((total, item) => total + item.population, 0), 2_000);
  assert.equal(result.regions.reduce((total, item) => total + item.totalAmount, 0), 130_000);
  assert.equal(result.provenance.siopeMovementsSha256, "a".repeat(64));
});

test("SIOPE ETL keeps an IPA-unmatched municipality national but not geographic", async () => {
  const code = [
    "import json, tempfile, zipfile",
    "from pathlib import Path",
    "from scripts.etl.siope_municipal_snapshot import build_snapshot",
    "with tempfile.TemporaryDirectory() as directory:",
    "    root = Path(directory)",
    "    registry = root / 'registry.zip'",
    "    with zipfile.ZipFile(registry, 'w') as target:",
    "        target.writestr('ANAG_REG_PROV.csv', 'ITALIA NORD-OCCIDENTALE,01,PIEMONTE,001,Torino\\nITALIA CENTRALE,12,LAZIO,002,Roma\\n')",
    "        target.writestr('ANAG_ENTI_SIOPE.csv', '1,2020-01-01,9999-12-31,CF-A,COMUNE A,001,001,100,COMUNE\\n2,2020-01-01,9999-12-31,CF-B,COMUNE B,002,002,200,COMUNE\\n3,2020-01-01,9999-12-31,CF-C,COMUNE C,003,001,300,COMUNE\\n')",
    "    ipa = root / 'ipa.csv'",
    "    ipa.write_text('cf;regione;cod_amm\\nCF-A;Piemonte;c_a\\nCF-B;Lazio;c_b\\n', encoding='utf-8')",
    "    movements = root / 'movements.zip'",
    "    with zipfile.ZipFile(movements, 'w') as target:",
    "        target.writestr('USCITE_2026.csv', '1,2026,1,1,100\\n1,2026,1,2,50\\n2,2026,1,1,200\\n3,2026,1,1,300\\n')",
    "    validators = {k: {'lastModified': 'now', 'sha256': letter * 64} for k, letter in (('movements', 'a'), ('registry', 'b'), ('ipa', 'c'))}",
    "    result = build_snapshot(year=2026, movements_zip=movements, registry_zip=registry, ipa_path=ipa, validators=validators)",
    "    print(json.dumps({'snapshot': result}))",
  ].join("\n");
  const { stdout } = await execFileAsync(PYTHON_BIN, ["-c", code], {
    cwd: new URL("..", import.meta.url),
  });
  const { snapshot } = JSON.parse(stdout);

  assert.equal(snapshot.totalPaid, 6.5);
  assert.equal(snapshot.coverage.withMovements, 3);
  assert.equal(snapshot.coverage.withRegion, 2);
  assert.equal(snapshot.coverage.withoutRegion, 1);
  assert.equal(snapshot.coverage.matchedToIpaRegion, 2);
  assert.equal(snapshot.coverage.unmatchedToIpaRegion, 1);
  assert.equal(snapshot.coverage.paymentsWithoutRegion, 3);
  assert.deepEqual(snapshot.regions.map((item) => item.region).sort(), ["Lazio", "Piemonte"]);
  assert.equal(snapshot.regions.reduce((total, item) => total + item.value, 0), 3.5);
  assert.deepEqual(snapshot.topMunicipalitiesByValue.map((item) => item.name), ["COMUNE B", "COMUNE A"]);
  assert.deepEqual(snapshot.topMunicipalitiesByPerCapita.map((item) => item.name), ["COMUNE B", "COMUNE A"]);
  assert.equal(snapshot.distribution.coverage.municipalitiesWithMovements, 3);
  assert.equal(snapshot.distribution.coverage.municipalitiesWithRegion, 2);
  assert.equal(snapshot.distribution.coverage.municipalitiesWithoutRegion, 1);
  assert.equal(snapshot.distribution.coverage.municipalitiesWithValidPopulationAndRegion, 2);
  assert.equal(snapshot.distribution.coverage.paymentsWithoutRegion, 3);
  assert.equal(snapshot.distribution.coverage.paymentsWithPopulationWithoutRegion, 3);
  assert.equal(snapshot.distribution.regions.reduce((total, item) => total + item.totalAmount, 0), 3.5);
  assert.equal(snapshot.distribution.populationBands.reduce((total, item) => total + item.municipalities, 0), 3);
  assert.equal(snapshot.distribution.nationalShareAll, 0.92307692);
});

test("SIOPE distribution does not fabricate a share for a zero denominator", async () => {
  const code = [
    "import json",
    "from scripts.etl.siope_municipal_snapshot import build_distribution",
    "rows = [{'region': 'Nord', 'population': 100, 'totalCents': 0, 'titleCents': 0}]",
    "validators = {k: {'lastModified': None, 'sha256': 'b' * 64} for k in ('movements', 'registry', 'ipa')}",
    "result = build_distribution(rows=rows, year=2025, latest_month=12, observed_at='2026-08-21T00:00:00+00:00', validators=validators)",
    "print(json.dumps(result))",
  ].join("\n");
  const { stdout } = await execFileAsync(PYTHON_BIN, ["-c", code], {
    cwd: new URL("..", import.meta.url),
  });
  const result = JSON.parse(stdout);

  assert.equal(result.nationalShareAll, null);
  assert.equal(result.nationalShareCovered, null);
  assert.equal(result.populationBands[0].share, null);
  assert.equal(result.period.completeness, "complete");
});

test("SIOPE distribution rejects fake provenance and inconsistent title components", async () => {
  const code = [
    "import json",
    "from scripts.etl.siope_municipal_snapshot import build_distribution",
    "rows = [{'region': 'Nord', 'population': 100, 'totalCents': 100, 'titleCents': 101}]",
    "bad_hash = {k: {'lastModified': None, 'sha256': 'hash'} for k in ('movements', 'registry', 'ipa')}",
    "good_hash = {k: {'lastModified': None, 'sha256': 'c' * 64} for k in ('movements', 'registry', 'ipa')}",
    "errors = []",
    "for validators in (bad_hash, good_hash):",
    "    try:",
    "        build_distribution(rows=rows, year=2026, latest_month=8, observed_at='2026-08-21T00:00:00+00:00', validators=validators)",
    "    except RuntimeError as error:",
    "        errors.append(str(error))",
    "print(json.dumps(errors))",
  ].join("\n");
  const { stdout } = await execFileAsync(PYTHON_BIN, ["-c", code], {
    cwd: new URL("..", import.meta.url),
  });
  const errors = JSON.parse(stdout);
  assert.match(errors[0], /SHA-256 .*non valido/);
  assert.match(errors[1], /Titolo 1 supera il totale/);
});

test("SIOPE refresh skip includes upstream ETag when it is available", async () => {
  const code = [
    "import json, tempfile",
    "from pathlib import Path",
    "from scripts.etl.siope_municipal_snapshot import is_unchanged",
    "source = {",
    "  'siopeMovementsLastModified': 'one', 'siopeMovementsEtag': 'etag-one',",
    "  'siopeRegistryLastModified': 'two', 'siopeRegistryEtag': 'etag-two',",
    "  'ipaLastModified': 'three', 'ipaEtag': 'etag-three',",
    "  'siopeMovementsSha256': 'a' * 64, 'siopeRegistrySha256': 'b' * 64, 'ipaSha256': 'c' * 64,",
    "}",
    "validators = {",
    "  'movements': {'lastModified': 'one', 'etag': 'etag-one'},",
    "  'registry': {'lastModified': 'two', 'etag': 'etag-two'},",
    "  'ipa': {'lastModified': 'three', 'etag': 'etag-three'},",
    "}",
    "with tempfile.TemporaryDirectory() as directory:",
    "  path = Path(directory) / 'snapshot.json'",
    "  path.write_text(json.dumps({'schemaVersion': 3, 'year': 2026, 'source': source, 'distribution': {'schemaVersion': 2}}))",
    "  same = is_unchanged(path, 2026, validators)",
    "  validators['movements']['etag'] = 'etag-replaced-in-place'",
    "  drift = is_unchanged(path, 2026, validators)",
    "  validators['movements']['etag'] = None",
    "  no_etag = is_unchanged(path, 2026, validators)",
    "print(json.dumps({'same': same, 'drift': drift, 'noEtag': no_etag}))",
  ].join("\n");
  const { stdout } = await execFileAsync(PYTHON_BIN, ["-c", code], {
    cwd: new URL("..", import.meta.url),
  });
  assert.deepEqual(JSON.parse(stdout), { same: true, drift: false, noEtag: true });
});
