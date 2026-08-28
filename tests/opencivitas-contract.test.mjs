import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import test from "node:test";
import { PYTHON_BIN } from "./helpers/python.mjs";
import { assertOpenCivitasSnapshot } from "../src/lib/data/opencivitas-contract.ts";

const snapshotPath = new URL("../src/data/generated/opencivitas-2022.json", import.meta.url);

function committedSnapshot() {
  return JSON.parse(readFileSync(snapshotPath, "utf8"));
}

test("OpenCivitas snapshot reconciles municipal amounts and keeps the official scope", () => {
  const snapshot = assertOpenCivitasSnapshot(committedSnapshot());
  assert.equal(snapshot.referenceYear, 2022);
  assert.equal(snapshot.coverage.municipalities, 6_557);
  assert.equal(snapshot.coverage.regions, 15);
  assert.match(snapshot.methodology.differenceMeaning, /non è una misura di spreco/i);

  const rome = snapshot.municipalities.find((item) => item.istatCode === "058091");
  assert.ok(rome);
  assert.equal(rome.differenceCents, 46_582_579_490);
  assert.equal(rome.differencePerCapitaCents, 16_906);
  assert.equal(rome.serviceDifferenceBasisPoints, -428);
});

test("OpenCivitas contract fails closed on false provenance and broken totals", () => {
  const wrongSource = structuredClone(committedSnapshot());
  wrongSource.source.dataUrl = "https://example.com/data.zip";
  assert.throws(() => assertOpenCivitasSnapshot(wrongSource), /URL ufficiale inatteso/);

  const brokenDifference = structuredClone(committedSnapshot());
  const differenceIndex = brokenDifference.municipalityColumns.indexOf("differenceCents");
  brokenDifference.municipalityRows[0][differenceIndex] += 1;
  assert.throws(() => assertOpenCivitasSnapshot(brokenDifference), /non riconciliata/);

  const unsafeMoney = structuredClone(committedSnapshot());
  const historicalIndex = unsafeMoney.municipalityColumns.indexOf("historicalSpendingCents");
  unsafeMoney.municipalityRows[0][historicalIndex] = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => assertOpenCivitasSnapshot(unsafeMoney), /intero sicuro/);
});

test("OpenCivitas keeps source anomaly warnings and nullable assessments", () => {
  const snapshot = assertOpenCivitasSnapshot(committedSnapshot());
  assert.equal(snapshot.municipalities.filter((item) => item.sourceWarnings.length > 0).length, 2);
  assert.equal(snapshot.municipalities.filter((item) => item.spendingLevel === null).length, 3);
  assert.equal(snapshot.municipalities.filter((item) => item.serviceLevel === null).length, 10);
});

test("OpenCivitas ETL validates the committed snapshot offline", () => {
  const checked = spawnSync(PYTHON_BIN, ["scripts/etl/opencivitas_snapshot.py", "--check"], {
    encoding: "utf8",
  });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /Snapshot OpenCivitas valido/);
});

test("OpenCivitas TLS supplement is the expected public intermediate", () => {
  const certificatePath = new URL(
    "../scripts/etl/certs/sectigo-public-server-authentication-ca-ov-r36.pem",
    import.meta.url,
  );
  const certificate = new X509Certificate(readFileSync(certificatePath));
  assert.equal(certificate.subject, "C=GB\nO=Sectigo Limited\nCN=Sectigo Public Server Authentication CA OV R36");
  assert.equal(
    certificate.fingerprint256,
    "65:42:D1:76:BE:D5:0F:19:3C:0C:E2:97:AE:44:EC:D8:A0:A8:6B:EC:2E:DE:68:27:69:34:40:59:B4:E7:85:30",
  );
});
