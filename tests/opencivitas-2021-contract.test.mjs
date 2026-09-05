import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { PYTHON_BIN } from "./helpers/python.mjs";
import { assertOpenCivitas2021Snapshot } from "../src/lib/data/opencivitas-2021-contract.ts";

const snapshotPath = new URL("../src/data/generated/opencivitas-2021.json", import.meta.url);

function committedSnapshot() {
  return JSON.parse(readFileSync(snapshotPath, "utf8"));
}

test("OpenCivitas 2021 FC70 snapshot keeps a distinct official scope", () => {
  const snapshot = assertOpenCivitas2021Snapshot(committedSnapshot());
  assert.equal(snapshot.referenceYear, 2021);
  assert.equal(snapshot.scope, "ordinary-statute-municipalities-total-services-fc70-2021");
  assert.equal(snapshot.source.family, "FC70TOT");
  assert.equal(snapshot.coverage.municipalities, 6_565);
  assert.equal(snapshot.coverage.regions, 15);
  assert.match(snapshot.methodology.differenceMeaning, /non è una misura di spreco/i);
  assert.match(snapshot.methodology.yearSeparationWarning, /non sono sommabili/i);

  const rome = snapshot.municipalities.find((item) => item.istatCode === "058091");
  assert.ok(rome);
  assert.equal(rome.differenceCents, 49_354_709_550);
  assert.equal(rome.differencePerCapitaCents, 17_954);
});

test("OpenCivitas 2021 contract fails closed on false provenance and broken totals", () => {
  const wrongSource = structuredClone(committedSnapshot());
  wrongSource.source.dataUrl = "https://example.com/data.zip";
  assert.throws(() => assertOpenCivitas2021Snapshot(wrongSource), /URL ufficiale inatteso/);

  const brokenDifference = structuredClone(committedSnapshot());
  const differenceIndex = brokenDifference.municipalityColumns.indexOf("differenceCents");
  brokenDifference.municipalityRows[0][differenceIndex] += 1;
  assert.throws(() => assertOpenCivitas2021Snapshot(brokenDifference), /non riconciliata/);
});

test("OpenCivitas 2021 ETL validates the committed snapshot offline", () => {
  const checked = spawnSync(PYTHON_BIN, ["scripts/etl/opencivitas_2021_snapshot.py", "--check"], {
    encoding: "utf8",
  });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /Snapshot OpenCivitas valido/);
});

test("OpenCivitas 2021 pins coherent amounts and metadata to the historical release", () => {
  for (const mutate of [
    (s) => { s.municipalityRows[0][4] += 100; s.municipalityRows[0][6] += 100; },
    (s) => { s.source.license = "Unverified"; },
    (s) => { s.municipalityRows[0][10] += 1; },
  ]) {
    const snapshot = committedSnapshot();
    mutate(snapshot);
    assert.throws(() => assertOpenCivitas2021Snapshot(snapshot), /SHA-256 semantico/);
  }
});
