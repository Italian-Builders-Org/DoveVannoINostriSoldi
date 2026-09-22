import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [page, graph, controls, diagram, facts, panel, styles, data] = await Promise.all([
  "src/app/politici/page.tsx", "src/app/politici/repubblica-graph.tsx",
  "src/app/politici/atlas-controls.tsx", "src/app/politici/atlas-hemicycle.tsx",
  "src/app/politici/atlas-facts.tsx", "src/app/politici/repubblica-panel.tsx",
  "src/app/politici/politici.module.css", "src/app/politici/atlas-data.ts",
].map(read));
const institutional = await read("src/app/politici/atlas-institutional-graph.tsx");
const overview = await read("src/app/politici/overview-geometry.ts");
const model = await read("src/app/politici/atlas-model.ts");

// Structural contracts supplement the behavioural model and browser suites.
// Keep unrelated immersive routing/navigation invariants during the redesign.
test("existing shell: root layout strips site chrome for the immersive route", async () => {
  const layout = await read("src/app/layout.tsx");
  const immersive = await read("src/components/immersive-chrome.tsx");
  const immersiveHelper = await read("src/lib/politici-immersive.ts");
  const proxySrc = await read("src/proxy.ts");
  for (const token of ["ImmersiveDocumentFlag", "ChromeUnlessImmersive", "isImmersiveMapRequest", "data-immersive"]) assert.ok(layout.includes(token));
  assert.match(immersive, /isPoliticiImmersive/);
  assert.match(immersiveHelper, /POLITICI_HOST|politici\.dovevannoinostrisoldi\.com/);
  assert.match(immersive, /dataset\.immersive|data-immersive/);
  // Soft-nav restore: chrome wrappers stay mounted even when SSR is immersive.
  assert.doesNotMatch(layout, /immersive \? null :/);
  // Only the atlas itself is immersive — never /politici/europa.
  assert.match(immersiveHelper, /pathname === "\/politici"/);
  assert.doesNotMatch(immersiveHelper, /startsWith\("\/politici\/"\)/);
  assert.match(proxySrc, /isPoliticiAtlasPath|pathname === "\/politici"/);
  assert.doesNotMatch(proxySrc, /startsWith\("\/politici\/"\)/);
});

test("existing shell: europa stays reachable, scrollable and outside immersive chrome", async () => {
  const europa = await read("src/app/politici/europa/page.tsx");
  const atlasPage = await read("src/app/politici/page.tsx");
  assert.match(europa, /shell page/);
  assert.doesNotMatch(europa, /immersivePage/);
  assert.match(europa, /Atlante nazionale/);
  assert.match(atlasPage, /data-europa-entry/);
  assert.match(atlasPage, /href="\/politici\/europa"/);
  assert.match(graph, /data-europa-entry/);
  assert.match(graph, /europaScopeLink/);
  // Brand uses a hard <a> so leaving the atlas remounts site chrome.
  assert.match(atlasPage, /<a className=\{styles\.immersiveBrand\} href=\{PUBLIC_SITE_URL\}/);
});

test("existing shell: navigation and discovery retain both entry points", async () => {
  const [nav, discovery] = await Promise.all([read("src/lib/site-navigation.ts"), read("src/lib/public-discovery.ts")]);
  assert.match(nav, /href: "\/politici"/);
  assert.match(nav, /Mappa della politica/);
  assert.match(discovery, /"\/politici"/);
  assert.match(page, /PUBLIC_SITE_URL/);
});

test("existing shell: document scrolling remains unlocked only on mobile", async () => {
  const globals = await read("src/app/globals.css");
  assert.match(globals, /html\[data-immersive="politici"\] body\s*\{[^}]*overflow:\s*hidden/s);
  const mobile = globals.slice(globals.indexOf("/* Mobile: unlock document scroll"));
  assert.match(mobile, /@media \(max-width: 899px\)/);
  assert.match(mobile, /overflow-y:\s*auto/);
  assert.match(mobile, /#contenuto-principale\s*\{[^}]*height:\s*auto/s);
});

test("atlas: server-first page reuses official readers, theme and explicit source dates", () => {
  assert.doesNotMatch(page, /^"use client"/);
  for (const token of ["getRepubblicaGraph", "getRepubblicaMap", "ThemeToggle", "readAtlasState", "observedDate", "source.license", "source.gap", "graph.caveats"]) assert.ok(page.includes(token), token);
  assert.doesNotMatch(page + graph, /CivLab|graph\.civlab|QA_DATA|fixtures\//);
  assert.match(page, /noscript/);
});

test("atlas: SVG exposes keyboard seats, a roving tab stop and equivalent list", () => {
  for (const token of ['role="group"', 'role="button"', "aria-pressed", "aria-describedby", "adjacentSeat", "data-seat-person"]) assert.ok(diagram.includes(token), token);
  assert.match(diagram, /focusId === seat.id \? 0 : -1/);
  assert.match(graph, /MemberDirectory/);
  assert.match(graph, /aria-label="Vista mappa o elenco"/);
  assert.doesNotMatch(diagram, /role="img"/);
});

test("atlas: responsive inspector uses native modality, focus restoration and scroll reset", () => {
  for (const token of ["showModal", "onCancel", "previous.focus", "selectionKey", "useSyncExternalStore", "scrollTo"]) assert.ok(controls.includes(token), token);
  assert.match(controls, /role="combobox"/);
  assert.match(controls, /aria-activedescendant/);
  assert.match(styles, /@media \(max-width: 899px\)/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /forced-colors/);
  assert.match(styles, /\.modeSwitch\s*\{[^}]*grid-template-columns:\s*1fr\s*1fr/s);
});

test("atlas: rich facts keep attendance, education, programs, CV, news and caveats", () => {
  for (const token of ["AttendanceRanking", "EducationBlock", "ProgramBlock", "VoteAttendance", "ProfileFacts", "NewsBlock", "InstitutionalRelations"]) assert.ok(panel.includes(token), token);
  for (const token of ["stemShareOfDeclared", "undeclared", "presencePercent", "votesCastPercent", "missionsPercent", "absencesPercent", "justifiedAbsences", "officialPages", "socialLinks", "photoCredit", "articleUrls", "observedAt"]) assert.ok(facts.includes(token), token);
  assert.match(facts, /missioni non sono presenze fisiche/);
  assert.match(facts, /non dimostrano|non dimostra|non implicano|non prova/);
  assert.match(graph, /vista separata/);
  assert.match(graph, /\/politici\/europa/);
});

test("atlas: legislative acts define «arrivate in fondo» from the official legge class", async () => {
  const acts = await read("src/app/politici/atlas-acts.tsx");
  assert.match(acts, /Arrivate in fondo/);
  assert.match(acts, /data-acts-end-definition/);
  assert.match(acts, /classe ufficiale di esito <strong>legge<\/strong>/);
  assert.match(acts, /Camera e Senato usano snapshot e regole/);
  assert.doesNotMatch(acts, /produttivit[àa]|merito politico/);
});

test("atlas: local foto and simboli proxies skip the next/image optimizer", async () => {
  const image = await read("src/app/politici/atlas-image.tsx");
  const symbol = await read("src/app/politici/atlas-symbol.tsx");
  assert.match(image, /unoptimized=\{src\.startsWith\("\/politici\/foto\/"\) \|\| src\.startsWith\("\/politici\/simboli\/"\)\}/);
  assert.match(symbol, /\/politici\/simboli\//);
  assert.match(graph, /Apri la vista eurodeputati/);
});

test("atlas: resource failures remain failures, bounded retries and URLs remain validated", () => {
  for (const token of ["parseProfiles", "parseNews", "isSafeExternalUrl", "requestDeadline", "signal", "payload.retry === true"]) assert.ok(data.includes(token), token);
  assert.match(graph, /window.history.pushState\(window.history.state/);
  assert.match(graph, /window.history.replaceState\(window.history.state/);
  assert.match(graph, /popstate/);
  assert.match(graph, /invalidSelection/);
});

test("atlas: every referenced CSS module class exists", async () => {
  const extra = await Promise.all(["atlas-primitives.tsx", "atlas-image.tsx", "atlas-rail.tsx", "atlas-acts.tsx", "atlas-seat-preview.tsx", "atlas-symbol.tsx", "atlas-institutional-graph.tsx", "atlas-storico-voti.tsx"].map((name) => read(`src/app/politici/${name}`)));
  const files = [graph, controls, diagram, facts, panel, page, ...extra];
  const combinedStyles = styles + await read("src/app/politici/atlas-enhancements.module.css");
  const classes = new Set([...combinedStyles.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1]));
  for (const text of files) for (const match of text.matchAll(/(?:styles|extra)\.([A-Za-z][\w]*)/g)) assert.ok(classes.has(match[1]), `Missing CSS class: ${match[1]}`);
});

test("atlas: institutional graph scope restores the radial overview map", async () => {
  assert.match(model, /id: "grafo"/);
  assert.match(model, /label: "Grafo"/);
  assert.match(model, /label: "Condanne"/);
  assert.match(model, /label: "Storico voti"/);
  assert.match(graph, /InstitutionalGraph/);
  assert.match(graph, /ConvictionsDirectory/);
  assert.match(graph, /ThemeVoteHistoryDirectory/);
  assert.match(graph, /scope === "grafo"/);
  assert.match(graph, /scope === "condanne"/);
  assert.match(graph, /scope === "storico-voti"/);
  assert.match(graph, /showMapListMode/);
  assert.match(graph, /scope !== "condanne"/);
  assert.match(graph, /scope !== "storico-voti"/);
  const storico = await read("src/app/politici/atlas-storico-voti.tsx");
  assert.match(storico, /Cosa si è votato/);
  assert.match(storico, /Chi ha votato/);
  assert.match(storico, /parseActHeadline/);
  assert.match(storico, /themeTimelineRail/);
  const europa = await read("src/app/politici/europa/page.tsx");
  assert.doesNotMatch(europa, /modeSwitch|Vista mappa o elenco/);
  assert.match(institutional, /Il Grafo Istituzionale/);
  assert.match(institutional, /buildOverviewGeometry/);
  assert.match(overview, /export function buildOverviewGeometry/);
  assert.match(styles, /\.institutionalGraph/);
  assert.match(styles, /\.graphBoard/);
});

test("storico voti parses camera act headlines into lead and title", async () => {
  await import("./helpers/register-ts-alias.mjs");
  const { parseActHeadline } = await import("../src/app/politici/atlas-act-headline.ts");
  assert.deepEqual(
    parseActHeadline('BOLDRINI: "Modifica dell’articolo 609- bis del codice penale" (1693)'),
    { lead: "Boldrini", title: "Modifica dell’articolo 609- bis del codice penale" },
  );
  assert.deepEqual(
    parseActHeadline('BERRUTO ed altri: "Impianti sportivi scolastici" (505)'),
    { lead: "Berruto ed altri", title: "Impianti sportivi scolastici" },
  );
  assert.equal(
    parseActHeadline("Disposizioni per la prevenzione delle discriminazioni").lead,
    null,
  );
});


test("atlas: attendance remains sourced data without ordinal ratings", () => {
  assert.match(facts, /ranking\.rows\.toSorted/);
  assert.match(facts, /a\.name\.localeCompare\(b\.name, "it"\)/);
  assert.match(facts, /Ordine alfabetico/);
  assert.doesNotMatch(facts, /\{(?:row|attendance)\.rank(?:edAmong)?\}/);
  for (const field of ["periodLabel", "observedDate", "sourceUrl", "rosterWithoutRow", "unmatchedRows"]) assert.ok(facts.includes(field), field);
});

test("atlas: the interactive-ready marker does not disable SSR or hide hydration errors", () => {
  assert.match(graph, /data-atlas-ready=\{ready \? "true" : "false"\}/);
  assert.match(graph, /useSyncExternalStore\(subscribeReady, clientReady, serverReady\)/);
  assert.match(graph, /serverReady = \(\) => false/);
  assert.doesNotMatch(graph, /suppressHydrationWarning|ssr:\s*false/);
});
