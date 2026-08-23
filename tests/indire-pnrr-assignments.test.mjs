import assert from "node:assert/strict";
import test from "node:test";
import snapshot from "../src/data/generated/indire-pnrr-assignments.json" with { type: "json" };
import { assertIndirePnrrAssignmentsSnapshot } from "../src/lib/data/indire-pnrr-assignments-contract.ts";

test("INDIRE PNRR assignments preserve coverage, totals and official provenance", () => {
  const data = assertIndirePnrrAssignmentsSnapshot(snapshot);
  assert.deepEqual(data.coverage, {
    compensationKnown: 88,
    latestEndDate: "2026-04-30",
    pnrrAssignments: 88,
    uniquePeople: 88,
    workbookAssignments: 201,
  });
  assert.equal(data.totals.contractCompensationCents, 597_807_504);
  assert.equal(data.source.owner, "Istituto Nazionale di Documentazione, Innovazione e Ricerca Educativa (INDIRE)");
  assert.equal(data.source.referencePeriod, "aggiornamento aprile 2026");
  assert.equal(data.source.licenseStatus, "not-declared");
  assert.ok(data.assignments.every((item) => item.compensation.basis === "contract_total"));
});

test("INDIRE PNRR assignments reconcile programs, tiers and selections", () => {
  assert.deepEqual(
    snapshot.programs.map(({ id, assignments, compensationCents }) => ({ id, assignments, compensationCents })),
    [
      { id: "m4c1-i3-1", assignments: 66, compensationCents: 560_354_004 },
      { id: "m4c1-r2-1", assignments: 22, compensationCents: 37_453_500 },
    ],
  );
  assert.deepEqual(
    Object.fromEntries(snapshot.tiers.map((item) => [item.compensationCents, item.assignments])),
    { 10_646_118: 3, 8_387_550: 63, 2_100_000: 8, 1_716_750: 2, 1_435_000: 12 },
  );
  assert.deepEqual(snapshot.selections, [
    { assignments: 68, code: "SEL 11/24" },
    { assignments: 20, code: "SEL 9/24" },
  ]);
});

test("INDIRE PNRR assignments fail closed on source, identity and amount drift", () => {
  assert.throws(
    () => assertIndirePnrrAssignmentsSnapshot({
      ...snapshot,
      source: {
        ...snapshot.source,
        referencePeriod: "aggiornamento successivo",
        asset: { ...snapshot.source.asset, sha256: "0".repeat(64) },
      },
    }),
    /provenienza ufficiale inattesa/,
  );

  const first = snapshot.assignments[0];
  assert.throws(
    () => assertIndirePnrrAssignmentsSnapshot({
      ...snapshot,
      assignments: [first, first, ...snapshot.assignments.slice(2)],
    }),
    /copertura o identità incarichi inattesa/,
  );

  assert.throws(
    () => assertIndirePnrrAssignmentsSnapshot({
      ...snapshot,
      assignments: [
        {
          ...first,
          compensation: { ...first.compensation, valueCents: first.compensation.valueCents + 1 },
        },
        ...snapshot.assignments.slice(1),
      ],
    }),
    /totale compensi inatteso/,
  );
});

test("INDIRE PNRR public artifacts contain no local or archive provenance", async () => {
  const { readFile } = await import("node:fs/promises");
  const paths = [
    "scripts/etl/indire_pnrr_assignments.py",
    "src/data/generated/indire-pnrr-assignments.json",
    "src/lib/data/indire-pnrr-assignments-contract.ts",
    "src/lib/indire-pnrr-assignments-snapshot.ts",
  ];
  for (const path of paths) {
    const content = await readFile(path, "utf8");
    assert.doesNotMatch(content, /\/Users\/|\/Downloads\/|\.tar\.gz|private\/tmp/i, path);
  }
  const loader = await readFile("src/lib/indire-pnrr-assignments-snapshot.ts", "utf8");
  assert.match(loader, /^import "server-only";/);
});
