import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { groupSourcesByPublisher, sourcePublisher } from "../src/lib/source-publishers.ts";

// Dynamic: sources.ts uses the @/ alias, registered by the helper above.
const { publicSources } = await import("../src/lib/sources.ts");

test("publisher variants collapse to one short name, keeping a real department as detail", () => {
  assert.deepEqual(sourcePublisher("ISTAT — Istituto nazionale di statistica"), { name: "ISTAT", detail: null });
  assert.deepEqual(sourcePublisher("Istituto Nazionale di Statistica (ISTAT)"), { name: "ISTAT", detail: null });
  assert.deepEqual(sourcePublisher("Istituto Nazionale della Previdenza Sociale"), { name: "INPS", detail: null });
  assert.deepEqual(sourcePublisher("Eurostat (Commissione europea)"), { name: "Eurostat", detail: null });
  assert.deepEqual(sourcePublisher("AIFA — Agenzia Italiana del Farmaco"), { name: "AIFA", detail: null });
  assert.deepEqual(sourcePublisher("MEF – Dipartimento delle Finanze"), { name: "MEF", detail: "Dipartimento delle Finanze" });
  assert.deepEqual(sourcePublisher("MEF · Dipartimento dell'Economia"), { name: "MEF", detail: "Dipartimento dell'Economia" });
  assert.deepEqual(sourcePublisher("Commissione europea, DG TAXUD"), { name: "Commissione europea", detail: "DG TAXUD" });
  assert.deepEqual(sourcePublisher("Presidenza del Consiglio dei Ministri · Italia Domani"), { name: "Presidenza del Consiglio dei ministri", detail: "Italia Domani" });
  // A joint publisher is not a department of the first one.
  assert.deepEqual(sourcePublisher("RGS · Banca d'Italia"), { name: "RGS · Banca d'Italia", detail: null });
  assert.deepEqual(sourcePublisher("Senato della Repubblica"), { name: "Senato della Repubblica", detail: null });
});

test("groups keep every source exactly once, largest publishers first", () => {
  const groups = groupSourcesByPublisher(publicSources);
  const slugs = groups.flatMap((group) => group.sources.map((entry) => entry.source.slug));
  assert.deepEqual([...slugs].sort(), publicSources.map((source) => source.slug).sort());
  for (let index = 1; index < groups.length; index += 1) {
    assert.ok(groups[index - 1].sources.length >= groups[index].sources.length);
  }
  const istat = groups.find((group) => group.name === "ISTAT");
  assert.ok(istat && istat.sources.length >= 10, "ISTAT spellings form one group");
  assert.equal(new Set(groups.map((group) => group.name)).size, groups.length);
});

test("a source name drops the publisher prefix already shown by its group heading", () => {
  const groups = groupSourcesByPublisher([
    { slug: "a", name: "ISTAT · povertà assoluta", owner: "ISTAT — Istituto nazionale di statistica" },
    { slug: "b", name: "ISTAT SITUAS", owner: "Istituto nazionale di statistica" },
    { slug: "c", name: "OpenBDAP", owner: "Ragioneria Generale dello Stato" },
    { slug: "d", name: "Eurostat · gov_10a_main", owner: "Eurostat" },
  ]);
  const titles = Object.fromEntries(groups.flatMap((group) => group.sources.map((entry) => [entry.source.slug, entry.title])));
  assert.deepEqual(titles, { a: "Povertà assoluta", b: "ISTAT SITUAS", c: "OpenBDAP", d: "gov_10a_main" });
});
