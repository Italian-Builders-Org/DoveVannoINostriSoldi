import assert from "node:assert/strict";
import test from "node:test";
import { filterDirectory, shareableViewUrl } from "../src/lib/frontend-exploration.ts";

const groups = [
  { title: "Soldi", links: [{ href: "/spese/sanita", label: "Sanità pubblica" }, { href: "/pensioni", label: "Pensioni" }] },
  { title: "Territori", links: [{ href: "/territori/irpef", label: "Redditi e IRPEF" }] },
];

test("directory finds accented labels, multiple words and section names", () => {
  assert.equal(filterDirectory(groups, "  SANITA pubblica ")[0].links[0].href, "/spese/sanita");
  assert.equal(filterDirectory(groups, "soldi")[0].links.length, 2);
  assert.equal(filterDirectory(groups, "territori irpef")[0].links[0].label, "Redditi e IRPEF");
  assert.deepEqual(filterDirectory(groups, "sanità irpef"), []);
  assert.deepEqual(filterDirectory(groups, "   "), groups);
  assert.equal(groups[0].links.length, 2, "filtering must not mutate the complete directory");
});

test("shared views retain the current preview, selected filters and anchor", () => {
  const url = new URL(shareableViewUrl("https://preview.example/istruzione?period=202526&region=03&pathway=SCIENZE%20UMANE#dati"));
  assert.equal(url.origin, "https://preview.example");
  assert.equal(url.searchParams.get("region"), "03");
  assert.equal(url.searchParams.get("pathway"), "SCIENZE UMANE");
  assert.equal(url.hash, "#dati");
});

test("shared views omit credentials and auth parameters without losing data filters", () => {
  const url = new URL(shareableViewUrl("https://user:password@preview.example/spese?anno=2025&token=secret&code=secret&access_token=secret&refresh_token=secret&_vercel_share=secret"));
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  assert.equal(url.search, "?anno=2025");
});
