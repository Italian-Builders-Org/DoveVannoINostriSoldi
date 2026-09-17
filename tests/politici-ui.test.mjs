import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/politici/page.tsx", import.meta.url), "utf8");
const graph = await readFile(new URL("../src/app/politici/politici-graph.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/app/politici/politici.module.css", import.meta.url), "utf8");
const nav = await readFile(new URL("../src/lib/site-navigation.ts", import.meta.url), "utf8");
const discovery = await readFile(new URL("../src/lib/public-discovery.ts", import.meta.url), "utf8");

test("politici page is server-first and stays inside the civic shell", () => {
  assert.doesNotMatch(page, /^"use client"/);
  assert.match(page, /<main className="shell page">/);
  assert.match(page, /page-intro/);
  assert.match(page, /PoliticiGraphExplorer/);
  assert.match(page, /getPoliticiParlamentoSnapshot/);
  assert.match(page, /initialSelection/);
  assert.match(page, /snapshot\.chambers/);
  assert.match(page, /Camera e Senato/);
  assert.doesNotMatch(page, /CivLab|graph\.civlab/);
});

test("graph explorer is immersive, shareable and exposes official profiles", () => {
  assert.match(graph, /^"use client"/);
  assert.match(graph, /Cerca una persona o un gruppo/);
  assert.match(graph, /window\.history\.replaceState/);
  assert.match(graph, /Scheda \{chamberName/);
  assert.match(graph, /role="img"/);
  assert.match(graph, /Grafo/);
  assert.match(graph, /Elenco/);
  assert.match(graph, /portraitUrl/);
  assert.match(graph, /Notizie collegate/);
  assert.match(graph, /GDELT/);
  assert.match(graph, /Doppio emiciclo/);
  assert.match(graph, /crossChamberEdge/);
  assert.match(graph, /newsConnections/);
  assert.match(graph, /selectedPerson\.biography/);
  assert.doesNotMatch(graph, /neo4j|force-directed|d3\./i);
});

test("navigation and discovery expose /politici without inventing a subdomain route", () => {
  assert.match(nav, /href: "\/politici"/);
  assert.match(nav, /Grafo politici/);
  assert.match(discovery, /"\/politici"/);
  assert.match(styles, /\.explorer\s*\{/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /prefers-reduced-motion/);
});
