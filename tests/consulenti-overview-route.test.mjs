import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertConsulentiSnapshot } from "../src/lib/data/consulenti-contract.ts";
import {
  assertIncarichiOverviewScope,
  INCARICHI_OVERVIEW_DATASET,
  INCARICHI_OVERVIEW_REUSE_TERMS,
  INCARICHI_OVERVIEW_YEARS,
} from "../src/app/incarichi/overview.ts";

const page = await readFile(
  new URL("../src/app/incarichi/page.tsx", import.meta.url),
  "utf8",
);
const css = await readFile(
  new URL("../src/app/incarichi/incarichi.module.css", import.meta.url),
  "utf8",
);
const snapshotJson = JSON.parse(
  await readFile(
    new URL("../src/data/generated/consulenti-overview.json", import.meta.url),
    "utf8",
  ),
);

test("the national appointments route keeps the two populations separate", () => {
  assert.match(page, /consulentiSnapshot as snapshot/);
  assert.match(page, /scopedSnapshot\.externalAppointments/);
  assert.match(page, /scopedSnapshot\.employeeAppointments/);
  assert.match(page, /le serie non si sommano/);
  assert.match(page, /non include gli incarichi ai\s+dipendenti/);
  assert.match(page, /resta distinta dagli incarichi\s+esterni/);
  assert.doesNotMatch(page, /paidCents\s*\+[^\n]*paidCents/);
});

test("the route labels partial coverage, amount meaning, and valid denominators", () => {
  assert.match(page, /const yearRange = `\$\{firstYear\}-\$\{scopedSnapshot\.latestYear\}`/);
  assert.deepEqual(INCARICHI_OVERVIEW_YEARS, [2023, 2024, 2025, 2026]);
  assert.match(page, /2026 è un anno parziale/);
  assert.match(page, /Quanto risulta pagato/);
  assert.match(page, /quanto risulta pagato alla fonte/);
  assert.match(page, /denominatore esplicito/);
  assert.match(page, /destinatari individuali \+ organizzazioni/);
  assert.match(page, /totale incarichi ai dipendenti/);
  assert.match(page, /Record PA conferente/);
  assert.match(page, /Scorri la tabella →/g);
  assert.match(page, /non equivale al numero di\s+amministrazioni distinte/);
  assert.match(page, /non equivale alle categorie contabili della Ragioneria generale dello\s+Stato/);
});

test("the route rejects a snapshot that drifts outside its promised years", () => {
  const scoped = assertIncarichiOverviewScope(assertConsulentiSnapshot(snapshotJson));
  assert.equal(scoped.latestYear, 2026);
  assert.equal(scoped.source.dataset, INCARICHI_OVERVIEW_DATASET);
  assert.equal(scoped.source.reuseTerms, INCARICHI_OVERVIEW_REUSE_TERMS);

  const drifted = structuredClone(snapshotJson);
  drifted.externalAppointments[0].year = 2022;
  drifted.employeeAppointments[0].year = 2022;
  assert.throws(
    () => assertIncarichiOverviewScope(assertConsulentiSnapshot(drifted)),
    /copertura annuale 2023-2026 inattesa/,
  );

  const datasetDrift = structuredClone(snapshotJson);
  datasetDrift.source.dataset = "Dataset diverso";
  assert.throws(
    () => assertIncarichiOverviewScope(assertConsulentiSnapshot(datasetDrift)),
    /dataset DFP inatteso/,
  );

  const ownerDrift = structuredClone(snapshotJson);
  ownerDrift.source.owner = "Titolare diverso";
  assert.throws(
    () => assertIncarichiOverviewScope(assertConsulentiSnapshot(ownerDrift)),
    /titolare DFP inatteso/,
  );

  const reuseDrift = structuredClone(snapshotJson);
  reuseDrift.source.reuseTerms = "Termini diversi";
  assert.throws(
    () => assertIncarichiOverviewScope(assertConsulentiSnapshot(reuseDrift)),
    /condizioni di riuso inattese/,
  );
});

test("the page has source, method, license, and coverage boundaries", () => {
  assert.match(page, /Fonte, metodo e limiti/);
  assert.match(page, /scopedSnapshot\.source\.landingUrl/);
  assert.match(page, /scopedSnapshot\.source\.endpoint/);
  assert.match(page, /scopedSnapshot\.source\.licenseUrl/);
  assert.match(page, /senza nomi individuali,?\s*\n?\s*curriculum o graduatorie/);
  assert.doesNotMatch(page, /href="\/consulenza"/);
  assert.doesNotMatch(page, /href="\/controlli"/);
});

test("the route gives landmarks and breadcrumb state real semantics", () => {
  assert.match(page, /<span aria-current="page">Incarichi pubblici<\/span>/);
  assert.match(
    page,
    /className=\{styles\.scopeBand\} role="group" aria-label="Perimetro della vista"/,
  );
  assert.doesNotMatch(page, /className=\{styles\.composition\} aria-label=/);
});

test("the overview stays flat and scroll-safe on narrow screens", () => {
  assert.match(css, /\.scopeBand\s*\{/);
  assert.match(css, /\.latestGrid,[\s\S]*\.comparisonGrid/);
  assert.match(css, /\.compositionTrack/);
  assert.match(css, /:global\(\.table-scroll\) table \{ min-width: 900px; \}/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.doesNotMatch(css, /border-radius\s*:/);
  assert.doesNotMatch(css, /gradient\s*\(/i);
});
