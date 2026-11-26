import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("the Swiss border IRPEF note cites the ratified 2020 agreement", async () => {
  const [copy, component, dossier, doc] = await Promise.all([
    source("../src/lib/mef-irpef-swiss-border-note.ts"),
    source("../src/components/mef-irpef-swiss-border-note.tsx"),
    source("../src/app/comuni/comuni-dossier.tsx"),
    source("../docs/MEF_IRPEF_COMUNALE.md"),
  ]);

  assert.match(copy, /23 dicembre 2020/);
  assert.match(copy, /Fascia di confine con la Svizzera/);
  assert.match(copy, /gazzettaufficiale\.it\/eli\/id\/2023\/06\/30\/23G00087\/SG/);
  assert.match(component, /MEF_IRPEF_SWISS_BORDER_NOTE_TITLE/);
  assert.match(dossier, /MefIrpefSwissBorderNote/);
  assert.match(doc, /Frontalieri e fascia di confine con la Svizzera/);
});