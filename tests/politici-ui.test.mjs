import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/politici/page.tsx", import.meta.url), "utf8");
const graph = await readFile(new URL("../src/app/politici/repubblica-graph.tsx", import.meta.url), "utf8");
const geometry = await readFile(new URL("../src/app/politici/graph-geometry.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/app/politici/politici.module.css", import.meta.url), "utf8");
const layout = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const immersive = await readFile(new URL("../src/components/immersive-chrome.tsx", import.meta.url), "utf8");
const nav = await readFile(new URL("../src/lib/site-navigation.ts", import.meta.url), "utf8");
const discovery = await readFile(new URL("../src/lib/public-discovery.ts", import.meta.url), "utf8");

test("politici page is immersive and server-first", () => {
  assert.doesNotMatch(page, /^"use client"/);
  assert.match(page, /immersivePage/);
  assert.match(page, /ThemeToggle/);
  assert.match(page, /RepubblicaGraph/);
  assert.match(page, /getRepubblicaMap/);
  assert.match(page, /initialSelection/);
  assert.doesNotMatch(page, /CivLab|graph\.civlab/);
  assert.doesNotMatch(page, /page-intro|shell page/);
});

test("root layout strips site chrome on the immersive map", () => {
  assert.match(layout, /ImmersiveDocumentFlag/);
  assert.match(layout, /ChromeUnlessImmersive/);
  assert.match(layout, /isImmersiveMapRequest/);
  assert.match(layout, /data-immersive/);
  assert.match(immersive, /isPoliticiImmersive/);
  assert.match(immersive, /POLITICI_HOST|politici\.dovevannoinostrisoldi\.com/);
  assert.match(immersive, /dataset\.immersive|data-immersive/);
});

test("explorer keeps overview drill-down, shareable selection and official portraits", () => {
  assert.match(graph, /^"use client"/);
  assert.match(graph, /Cerca una persona o un gruppo/);
  assert.match(graph, /window\.history\.replaceState/);
  assert.match(graph, /role="img"/);
  assert.match(graph, /Mappa/);
  assert.match(graph, /Elenco/);
  assert.match(graph, /portraitPath|\/politici\/foto\//);
  assert.match(graph, /Torna alla panoramica/);
  assert.match(graph, /data-enter-chamber/);
  assert.match(graph, /famiglia-politica|familyLink/);
  assert.match(graph, /newsLink|connections/);
  assert.match(geometry, /buildOverviewGeometry/);
  assert.match(geometry, /buildChamberScene/);
  assert.match(geometry, /sectorBand|executiveArc/);
  assert.doesNotMatch(graph, /neo4j|force-directed|d3\./i);
});

test("navigation and discovery keep /politici and point the map to the subdomain", () => {
  assert.match(nav, /href: "\/politici"/);
  assert.match(nav, /Mappa della politica/);
  assert.match(discovery, /"\/politici"/);
  assert.match(page, /PUBLIC_SITE_URL/);
  assert.match(page, /Torna al sito/);
  assert.match(styles, /\.explorer\s*\{/);
  assert.match(styles, /\.sideRail/);
  assert.match(styles, /\.topBar/);
  assert.match(styles, /@media \(max-width: 899px\)/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /\.chamberEnter/);
  assert.match(styles, /\.relationLegend/);
  assert.match(styles, /\.immersivePage/);
  assert.match(styles, /\.immersiveChrome/);
  assert.match(styles, /\.immersiveHomeLink/);
  assert.match(graph, /Viceministri e sottosegretari/);
});
