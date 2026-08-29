import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/app/territori/territory-view-switcher.tsx", import.meta.url),
  "utf8",
);

test("territory view tabs expose one labelled panel and roving keyboard focus", () => {
  assert.match(source, /role="tablist"/);
  assert.match(source, /aria-controls=\{panelId\}/);
  assert.match(source, /role="tabpanel"/);
  assert.match(source, /aria-labelledby=\{tabId\(view\)\}/);
  assert.match(source, /tabIndex=\{view === tab\.value \? 0 : -1\}/);
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
    assert.match(source, new RegExp(`event\\.key === "${key}"`));
  }
});
