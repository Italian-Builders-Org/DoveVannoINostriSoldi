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
  assert.match(graph, /hintDesktop|hintMobile|pizzica per zoom/);
  assert.match(graph, /chamberEnterCompact|compact=\{overview\.layout === "stacked"\}/);
  assert.match(graph, /chamberEnterCtaPill/);
  assert.match(graph, /data-mobile-hub|MobileHub|filtersOpen|filtersToggle/);
  assert.match(graph, /Scegli un’istituzione/);
  assert.match(graph, /desktopExperienceNote|esperienza completa della mappa/);
  assert.match(styles, /\.hintMobile/);
  assert.match(styles, /\.chamberEnterCompact/);
  assert.match(styles, /\.chamberEnterCtaPill/);
  assert.match(styles, /\.mobileHub/);
  assert.match(styles, /\.filtersToggle/);
  assert.match(styles, /\.desktopExperienceNote/);
  assert.match(styles, /\.cvBlock|\.rankingBlock/);
  assert.match(styles, /grid-template-columns:\s*1fr\s*1fr/);
  assert.match(styles, /position:\s*sticky/);
  assert.match(styles, /\.peopleList[\s\S]*?max-height:\s*none/);
  assert.match(styles, /overflow:\s*visible/);
  assert.match(geometry, /cardH = layout === "stacked" \? 150/);
});

test("mobile mode switch stays full-width and page scrolls as one surface", () => {
  assert.match(graph, /data-mode=\{mode\}/);
  assert.match(graph, /aria-label="Vista mappa o elenco"/);
  assert.match(graph, /setMode\("mappa"\)/);
  assert.match(graph, /setMode\("elenco"\)/);
  const mobileBlock = styles.slice(styles.indexOf("@media (max-width: 899px)"));
  assert.match(mobileBlock, /\.modeSwitch\s*\{[^}]*grid-template-columns:\s*1fr\s*1fr/s);
  assert.match(mobileBlock, /\.immersivePage\s*\{[^}]*overflow:\s*visible/s);
  assert.match(mobileBlock, /\.explorer\s*\{[^}]*overflow:\s*visible/s);
  assert.match(mobileBlock, /\.peopleList[\s\S]*?max-height:\s*none/);
  assert.match(mobileBlock, /\.sideRail\s*\{[^}]*overflow:\s*visible/s);
  assert.match(mobileBlock, /\.topBar\s*\{[^}]*position:\s*sticky/s);
  assert.doesNotMatch(mobileBlock, /minmax\(140px,\s*22dvh\)/);
});

test("immersive politici unlocks document scroll only on mobile", async () => {
  const globals = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(globals, /html\[data-immersive="politici"\] body\s*\{[^}]*overflow:\s*hidden/s);
  const mobileImmersive = globals.slice(globals.indexOf("/* Mobile: unlock document scroll"));
  assert.match(mobileImmersive, /@media \(max-width: 899px\)/);
  assert.match(mobileImmersive, /overflow-y:\s*auto/);
  assert.match(mobileImmersive, /#contenuto-principale\s*\{[^}]*height:\s*auto/s);
});

test("person panel exposes institutional CV and Camera attendance ranking", async () => {
  const panel = await readFile(new URL("../src/app/politici/repubblica-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /Curriculum istituzionale/);
  assert.match(panel, /Classifica presenze/);
  assert.match(panel, /AttendanceRanking|cameraAttendanceRanking/);
  assert.match(panel, /Senato non pubblica/);
});
