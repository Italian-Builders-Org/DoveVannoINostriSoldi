import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
test("study capsule agrees with research and conserves all denominators", async () => {
  const capsule = await json("../src/content/studies/childcare.json");
  const analysis = await json("../research/pnrr-childcare-delivery/generated/analysis_summary.json");
  assert.deepEqual(capsule.source, analysis.source);
  assert.deepEqual(capsule.headline, analysis.headline);
  assert.deepEqual(capsule.pipeline, analysis.pipeline);
  assert.deepEqual(capsule.procurement, analysis.procurement.procedure_number_value);
  assert.equal(capsule.pipeline.reduce((n, r) => n + r.projects, 0), 2980);
  assert.equal(capsule.procurement.reduce((n, r) => n + r.procedures, 0), 13715);
  assert.equal(capsule.pipeline[0].projects + capsule.pipeline[1].projects, capsule.headline.commissioning_or_concluded);
  assert.equal(capsule.source.reference_date, "2026-06-13");
  assert.equal(capsule.version, "1.3");
});
test("public study assets match the versioned checksums and research PDF", async () => {
  const capsule = await json("../src/content/studies/childcare.json");
  for (const [name, expected] of Object.entries(capsule.assets)) {
    const bytes = await readFile(new URL(`../public/studi/dai-fondi-ai-posti/v${capsule.version}/${name}`, import.meta.url));
    assert.equal(bytes.length, expected.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected.sha256);
  }
  const research = await readFile(new URL("../research/pnrr-childcare-delivery/paper/main.pdf", import.meta.url));
  assert.equal(createHash("sha256").update(research).digest("hex"), capsule.assets["dai-fondi-ai-posti.pdf"].sha256);
  assert.equal(research.subarray(0, 5).toString(), "%PDF-");
});
test("study is editorially separate from monthly reports and raw snapshots", async () => {
  const code = await readFile(new URL("../src/lib/studies.ts", import.meta.url), "utf8");
  assert.doesNotMatch(code, /data\/generated|monthly-reports/);
  const page = await readFile(new URL("../src/app/studi/dai-fondi-ai-posti/page.tsx", import.meta.url), "utf8");
  assert.match(page, /non posti nido aperti/);
  assert.match(page, /non è una baseline pre-intervento/);
  assert.doesNotMatch(page, /href="\/report/);
  const wastePage = await readFile(new URL("../src/app/studi/tre-interventi-sprechi/page.tsx", import.meta.url), "utf8");
  assert.match(wastePage, /non si sommano/);
  assert.match(wastePage, /non coincide con un taglio di bilancio/);
  assert.doesNotMatch(wastePage, /href="\/report/);
  const layout = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /data-scroll-behavior="smooth"/);
});

test("waste interventions capsule matches the versioned public and research PDF", async () => {
  const capsule = await json("../src/content/studies/waste-interventions.json");
  assert.equal(capsule.version, "1");
  assert.equal(capsule.publishedOn, "2026-09-22");
  for (const [name, expected] of Object.entries(capsule.assets)) {
    const bytes = await readFile(new URL(`../public/studi/tre-interventi-sprechi/v${capsule.version}/${name}`, import.meta.url));
    assert.equal(bytes.length, expected.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected.sha256);
  }
  const research = await readFile(new URL("../research/quaderni-sprechi-2026-09/paper/tre-interventi-sprechi.pdf", import.meta.url));
  assert.equal(createHash("sha256").update(research).digest("hex"), capsule.assets["tre-interventi-sprechi.pdf"].sha256);
  assert.equal(research.subarray(0, 5).toString(), "%PDF-");
});

test("camera presenze capsule matches the versioned public and research PDF", async () => {
  const capsule = await json("../src/content/studies/camera-presenze.json");
  assert.equal(capsule.version, "2.1");
  assert.equal(capsule.publishedOn, "2026-11-20");
  assert.doesNotMatch(JSON.stringify(capsule), /\u2014|\u2013/);
  for (const [name, expected] of Object.entries(capsule.assets)) {
    const bytes = await readFile(new URL(`../public/studi/presenze-camera/v${capsule.version}/${name}`, import.meta.url));
    assert.equal(bytes.length, expected.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected.sha256);
  }
  const research = await readFile(new URL("../research/camera-presenze-voto/paper/presenze-camera.pdf", import.meta.url));
  assert.equal(createHash("sha256").update(research).digest("hex"), capsule.assets["presenze-camera.pdf"].sha256);
  assert.equal(research.subarray(0, 5).toString(), "%PDF-");
  assert.equal(capsule.deputies, undefined, "le righe per deputato non entrano nel registro degli studi");
  const page = await readFile(new URL("../src/app/studi/presenze-camera/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Cosa misura/);
  assert.match(page, /vista=presenze/);
  assert.doesNotMatch(page, /\u2014/);
  assert.doesNotMatch(page, /href="\/report/);
});

test("camera presenze v2 keeps every official row and conserves its denominators", async () => {
  const capsule = await json("../src/content/studies/camera-presenze.json");
  const snapshot = await json("../src/data/generated/camera-partecipazione-voto.json");
  const { deputies, version } = await json("../src/content/studies/camera-presenze-deputati.json");
  assert.equal(version, capsule.version);
  const h = capsule.headline;
  // Every official row is published, matched or not: no deputy silently dropped.
  assert.equal(deputies.length, snapshot.deputies.length);
  assert.equal(h.rows, snapshot.coverage.rows);
  assert.equal(h.matchedDeputies, snapshot.coverage.matchedDeputies);
  assert.equal(deputies.filter((d) => d.unmatched).length, snapshot.coverage.unmatchedRows);
  assert.equal(capsule.presenceBins.reduce((n, b) => n + b.count, 0), h.rows);
  assert.equal(capsule.votesBins.reduce((n, b) => n + b.count, 0), h.rows);
  assert.equal(capsule.groups.reduce((n, g) => n + g.count, 0), h.rows);
  assert.equal(capsule.blocs.reduce((n, b) => n + b.count, 0), h.rows);
  assert.equal(capsule.profiles.roles.reduce((n, r) => n + r.count, 0), h.rows);
  assert.equal(capsule.profiles.gender.reduce((n, r) => n + r.count, 0), h.matchedDeputies);
  for (const d of deputies) {
    // Presence is votes + missions; the official table rounds each column to 0.01.
    assert.ok(Math.abs(d.votes + d.missions - d.presence) <= 0.03, d.name);
    assert.ok(d.justified <= d.absences + 0.01, d.name);
    assert.ok(d.votable > 0 && d.votable <= h.totalVotes, d.name);
  }
  // Government members vote far less than they are "present": the study must show it.
  assert.ok(h.governmentMedianVotes < 20);
  assert.ok(h.governmentMedianPresence > 90);
  const means = capsule.groups.map((g) => g.meanVotes + g.meanMissions + g.meanAbsences);
  for (const total of means) assert.ok(Math.abs(total - 100) <= 0.3);
});

test("camera presenze rankings exclude deceased deputies but keep their official row", async () => {
  const { deputies } = await json("../src/content/studies/camera-presenze-deputati.json");
  const bossi = deputies.find((d) => d.name === "Umberto Bossi");
  assert.equal(bossi?.deceased, true, "la riga ufficiale resta nella tabella completa, marcata");
  for (const path of ["../src/app/studi/presenze-camera/page.tsx", "../research/camera-presenze-voto/render-pdf.mjs"]) {
    const code = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(code, /!d\.deceased/, `${path} deve escludere i deputati deceduti dalle classifiche`);
  }
});

test("camera presenze v1 PDF stays published with its original checksum", async () => {
  const v1 = await readFile(new URL("../public/studi/presenze-camera/v1/presenze-camera.pdf", import.meta.url));
  assert.equal(createHash("sha256").update(v1).digest("hex"), "183bfc7b2d4c03aa6782e1f8281fc3ca5703844dcb190f0f5ab151fed1bc8f68");
  const v2 = await readFile(new URL("../public/studi/presenze-camera/v2/presenze-camera.pdf", import.meta.url));
  assert.equal(createHash("sha256").update(v2).digest("hex"), "4bea42976f95851393e72e55adf92b52346fdff509bc32ce8dff4ebc01b40395");
});

test("previous published PDF remains available with its original checksum", async () => {
  const previous = await readFile(new URL("../public/studi/dai-fondi-ai-posti/v1.2/dai-fondi-ai-posti.pdf", import.meta.url));
  assert.equal(createHash("sha256").update(previous).digest("hex"), "0f82b5d9f4204ef6f180c290923c5fd445214c9d758dfaeab4a5b9f236e66c01");
});
