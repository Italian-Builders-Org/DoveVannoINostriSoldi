import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  buildEducationDistribution,
  classifyEducation,
  extractEducationSourceText,
} = await import("../src/lib/politici-education.ts");
const { programForGroup, ELECTORAL_PROGRAMS_XIX } = await import("../src/lib/politici-electoral-programs.ts");
const { getRepubblicaMap, getRepubblicaProfiles } = await import("../src/lib/politici-repubblica.ts");

test("education classifier keeps undeclared distinct from STEM and legal", () => {
  assert.equal(classifyEducation(null, "").area, "undeclared");
  assert.equal(classifyEducation("Laurea in ingegneria gestionale; Consulente.", null).area, "stem");
  assert.equal(classifyEducation("Laurea in giurisprudenza; Avvocato.", null).area, "legal");
  assert.equal(classifyEducation("Laurea in economia e commercio; Dottore commercialista.", null).area, "economic");
  assert.equal(classifyEducation("Laurea in medicina; Medico.", null).area, "health");
  assert.equal(classifyEducation("Laurea in filosofia; Docente.", null).area, "humanities_social");
  assert.equal(classifyEducation("Imprenditore.", null).area, "other");
});

test("education extractor prefers profession notes and biography formazione clause", () => {
  assert.equal(
    extractEducationSourceText("Laurea in fisica", "ignored").text,
    "Laurea in fisica",
  );
  const bio = "Deputato. Formazione o note professionali: Laurea in architettura; Architetto.";
  const fromBio = extractEducationSourceText(null, bio);
  assert.equal(fromBio.sourceField, "biography");
  assert.match(fromBio.text, /architettura/i);
  assert.equal(classifyEducation(null, bio).area, "stem");
});

test("education distribution never invents STEM scarcity from missing notes", () => {
  const distribution = buildEducationDistribution([
    { profession: "Laurea in ingegneria", biography: "" },
    { profession: null, biography: "" },
    { profession: "Laurea in giurisprudenza", biography: "" },
  ]);
  assert.equal(distribution.total, 3);
  assert.equal(distribution.stemCount, 1);
  assert.equal(distribution.undeclared, 1);
  assert.equal(distribution.declared, 2);
  assert.ok(distribution.stemShareOfDeclared !== null);
  assert.ok(Math.abs(distribution.stemShareOfDeclared - 0.5) < 1e-9);
});

test("repubblica map exposes education aggregates and profiles carry classification", () => {
  const map = getRepubblicaMap();
  assert.equal(map.education.all.total, map.coverage.people);
  assert.equal(map.education.camera.total, map.coverage.deputies);
  assert.equal(map.education.senato.total, map.coverage.senators);
  assert.ok(map.education.all.stemCount >= 0);
  assert.ok(map.education.all.undeclared >= 0);
  assert.match(map.education.all.caveat, /STEM/);

  const profiles = getRepubblicaProfiles();
  const sample = Object.values(profiles)[0];
  assert.ok(sample?.education?.area);
  assert.ok(sample?.education?.label);
});

test("electoral programs catalog matches official party families without inventing alignment", () => {
  assert.ok(ELECTORAL_PROGRAMS_XIX.length >= 3);
  for (const entry of ELECTORAL_PROGRAMS_XIX) {
    assert.match(entry.programUrl, /^https:\/\//);
    assert.ok(entry.themes.length > 0);
    assert.ok(entry.caveats.some((caveat) => /allineamento|Non |non /i.test(caveat)));
  }
  const fdi = programForGroup({ partyFamily: "fratelli-italia", shortLabel: "Fratelli d’Italia" });
  assert.equal(fdi?.id, "fdi-2022");
  assert.equal(programForGroup({ partyFamily: "misto", shortLabel: "Misto" }), null);
});
