import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

test("municipality economics keeps citizen explanations visible on every scheda", async () => {
  const [economics, spendingView] = await Promise.all([
    source("../src/app/enti/[codice]/municipality-economics.tsx"),
    source("../src/lib/municipality-spending-view.ts"),
  ]);

  assert.match(economics, /data-siope-reading-guide/);
  assert.match(economics, /data-peer-reading-guide/);
  assert.match(economics, /data-peer-glossary/);
  assert.match(economics, /data-opencivitas-reading-guide/);
  assert.match(economics, /data-opencivitas-glossary/);
  assert.match(economics, /title\.explanation/);
  assert.match(economics, /openCivitas\.methodology\.differenceMeaning/);
  assert.match(economics, /openCivitas\.methodology\.serviceMeaning/);
  assert.match(economics, /Scala OpenCivitas da 0 a 10/);
  assert.match(economics, /Valore tipico \(mediana\)/);
  assert.match(economics, /Spesa registrata per abitante/);
  assert.match(economics, /Valore di riferimento per abitante/);
  assert.doesNotMatch(economics, /—|–/);

  assert.match(spendingView, /Costi di funzionamento quotidiano/);
  assert.match(spendingView, /partite di giro/);
  assert.match(spendingView, /OTHER_EXPLANATION/);
  assert.match(spendingView, /explainMunicipalitySpendingTitle/);
});
