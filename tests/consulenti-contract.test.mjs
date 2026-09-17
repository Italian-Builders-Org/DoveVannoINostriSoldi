import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { PYTHON_BIN } from "./helpers/python.mjs";
import { assertConsulentiSnapshot } from "../src/lib/data/consulenti-contract.ts";

const snapshotPath = new URL(
  "../src/data/generated/consulenti-overview.json",
  import.meta.url,
);

function committedSnapshot() {
  return JSON.parse(readFileSync(snapshotPath, "utf8"));
}

test("Consulenti Pubblici snapshot preserves annual totals and semantics", () => {
  const snapshot = assertConsulentiSnapshot(committedSnapshot());

  assert.equal(snapshot.latestYear, 2026);
  assert.deepEqual(
    snapshot.externalAppointments.map((item) => item.year),
    snapshot.employeeAppointments.map((item) => item.year),
  );
  assert.ok(snapshot.externalAppointments.every((item) => item.paidCents >= 0));
  assert.ok(
    snapshot.employeeAppointments.every(
      (item) => item.managerAssignments + item.nonManagerAssignments === item.assignments,
    ),
  );
  assert.match(snapshot.methodology.amountMeaning, /comunicato/i);
  assert.match(snapshot.methodology.currentYearWarning, /parziale/i);
});

test("Consulenti Pubblici contract fails closed on unsafe or inconsistent data", () => {
  const wrongEndpoint = structuredClone(committedSnapshot());
  wrongEndpoint.source.endpoint = "https://example.com/api";
  assert.throws(() => assertConsulentiSnapshot(wrongEndpoint), /URL ufficiale inatteso/);

  const brokenReconciliation = structuredClone(committedSnapshot());
  brokenReconciliation.employeeAppointments[0].managerAssignments += 1;
  assert.throws(() => assertConsulentiSnapshot(brokenReconciliation), /non riconciliano/);

  const unsafeMoney = structuredClone(committedSnapshot());
  unsafeMoney.externalAppointments[0].paidCents = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => assertConsulentiSnapshot(unsafeMoney), /intero non negativo sicuro/);
});

test("Consulenti Pubblici ETL converts decimal amounts to integer cents", () => {
  const directory = mkdtempSync(join(tmpdir(), "dovevanno-consulenti-test-"));
  const input = join(directory, "input.json");
  const output = join(directory, "snapshot.json");
  writeFileSync(
    input,
    JSON.stringify({
      consulenti: [
        {
          annoConferimento: 2025,
          numeroIncarichi: 3,
          ammontareErogato: 12.345,
          incarichiConclusi: 2,
          personaFisicaCount: 2,
          personaGiuridicaCount: 1,
        },
      ],
      dipendenti: [
        {
          annoConferimento: 2025,
          numeroIncarichi: 3,
          ammontareErogato: 10.005,
          incarichiConclusi: 1,
          dirigentiCount: 1,
          nonDirigentiCount: 2,
          paConferenteCount: 2,
        },
      ],
    }),
  );

  const generated = spawnSync(
    PYTHON_BIN,
    ["scripts/etl/consulenti_snapshot.py", "--input", input, "--output", output],
    { encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr);
  const snapshot = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(snapshot.externalAppointments[0].paidCents, 1235);
  assert.equal(snapshot.employeeAppointments[0].paidCents, 1001);

  const checked = spawnSync(
    PYTHON_BIN,
    ["scripts/etl/consulenti_snapshot.py", "--check", "--output", output],
    { encoding: "utf8" },
  );
  assert.equal(checked.status, 0, checked.stderr);
});
