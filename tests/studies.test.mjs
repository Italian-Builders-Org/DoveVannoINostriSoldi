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
  assert.equal(capsule.version, "1.2");
});
test("public study assets match the versioned checksums and research PDF", async () => {
  const capsule = await json("../src/content/studies/childcare.json");
  for (const [name, expected] of Object.entries(capsule.assets)) {
    const bytes = await readFile(new URL(`../public/studi/dai-fondi-ai-posti/v1.2/${name}`, import.meta.url));
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
});
