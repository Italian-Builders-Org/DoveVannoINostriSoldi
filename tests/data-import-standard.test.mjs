import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import test from "node:test";

test("data import standard is linked from contributing and ships an agent skill", async () => {
  const [standard, contributing, sources, skill, roadmap] = await Promise.all([
    readFile(new URL("../docs/DATA_IMPORT_STANDARD.md", import.meta.url), "utf8"),
    readFile(new URL("../CONTRIBUTING.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/DATA_SOURCES.md", import.meta.url), "utf8"),
    readFile(new URL("../.agents/skills/import-dvns-dataset/SKILL.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/ROADMAP.md", import.meta.url), "utf8"),
  ]);

  await access(
    new URL("../.agents/skills/import-dvns-dataset/SKILL.md", import.meta.url),
    constants.R_OK,
  );

  assert.match(standard, /Tre campi semantici obbligatori/);
  assert.match(standard, /Soldi \(unità e natura contabile\)/);
  assert.match(standard, /Periodo \(tempo del fatto economico\)/);
  assert.match(standard, /Provenance/);
  assert.match(standard, /Corpus integrato/);
  assert.match(standard, /import-dvns-dataset/);
  assert.doesNotMatch(standard, /—|–/);

  assert.match(contributing, /DATA_IMPORT_STANDARD\.md/);
  assert.match(contributing, /import-dvns-dataset/);
  assert.match(sources, /DATA_IMPORT_STANDARD\.md/);
  assert.match(roadmap, /#264/);
  assert.match(skill, /name: import-dvns-dataset/);
  assert.match(skill, /DATA_IMPORT_STANDARD\.md/);
  assert.doesNotMatch(skill, /—|–/);
});
