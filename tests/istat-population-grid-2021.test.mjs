import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const {
  istatPopulationGrid2021Data: data,
  istatPopulationGrid2021Metadata: metadata,
} = await import("../src/lib/istat-population-grid-2021-snapshot.ts");
const {
  assertIstatPopulationGrid2021Data: assertData,
  validateIstatPopulationGrid2021Bundle: validate,
} = await import("../src/lib/data/istat-population-grid-2021-contract.ts");
const { GET } = await import("../src/app/api/territori/griglia/route.ts");

test("ISTAT population grid overview keeps official pins and no runtime network", () => {
  const raw = readFileSync("src/data/generated/istat-population-grid-2021.data.json");
  const parsed = assertData(data);
  const bundle = validate(data, metadata, raw);

  assert.equal(parsed.totals.cells, 319154);
  assert.equal(parsed.totals.residentPopulation, 58933936);
  assert.equal(
    parsed.totals.malePopulation + parsed.totals.femalePopulation,
    parsed.totals.residentPopulation,
  );
  assert.equal(metadata.refreshWorkflow, null);
  assert.equal(metadata.runtimeNetwork, false);
  assert.equal(bundle.metadata.artifact.sha256, createHash("sha256").update(raw).digest("hex"));
  assert.ok(parsed.economicJoins.some((join) => join.href.includes("istat-misura-comune")));
  assert.ok(parsed.caveats.some((caveat) => /digital twin|simulazioni/i.test(caveat)));
});

test("ISTAT population grid API serves static overview without inventing values", async () => {
  const response = await GET(new NextRequest("http://localhost/api/territori/griglia"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.totals.residentPopulation, 58933936);
  assert.equal(body.runtimeNetwork, false);
  assert.equal(body.refreshWorkflow, null);
  assert.equal(body.populationBands.length, 8);
});

test("ISTAT population grid overview rejects money claims and unofficial URLs", () => {
  const raw = readFileSync("src/data/generated/istat-population-grid-2021.data.json");
  const broken = structuredClone(data);
  broken.provenance.landingUrl = "https://example.com/grid";
  assert.throws(() => assertData(broken), /ufficiale ISTAT/);

  const money = structuredClone(metadata);
  money.semantics.soldi.present = true;
  assert.throws(() => validate(data, money, raw), /soldi\.present/);

  const networked = structuredClone(metadata);
  networked.runtimeNetwork = true;
  assert.throws(() => validate(data, networked, raw), /runtimeNetwork/);
});
