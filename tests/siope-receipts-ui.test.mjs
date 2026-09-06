import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import "./helpers/register-ts-alias.mjs";
import { receiptsPageFilters, receiptsPageHref, receiptsPeriodLabel } from "../src/app/entrate/receipts-view.ts";
import { activeNavSection, SITE_MAP_GROUPS } from "../src/lib/site-navigation.ts";
import { LLMS_DISCOVERY_PATHS, PUBLIC_INDEXABLE_PATHS } from "../src/lib/public-discovery.ts";

const row = {
  taxCode: "01234567890", codiceIpa: "c_test", name: "Comune di prova", province: "BO", region: "Emilia-Romagna",
  population: 100, totalCents: 123456, perCapitaCents: 1235, perSquareKmCents: 2469,
  titles: [{ code: "1", label: "Entrate tributarie", amountCents: 123456 }],
};
const snapshot = {
  year: 2026, latestMonth: 9, latestMonthLabel: "Settembre", totalCollected: 1000000,
  receiptsWithPopulation: 1000000, populationCovered: 1000, nationalPerCapita: 1000,
  generatedAt: "2026-09-05T12:00:00Z",
  coverage: { activeSiopeMunicipalities: 30, withMovements: 29, withPopulation: 29, withoutRegion: 1, receiptsWithoutRegion: 100 },
  titles: [{ code: "1", label: "Entrate tributarie", value: 1000000 }],
  monthly: [{ month: 9, label: "Settembre", flow: 1000, cumulative: 1000000 }],
  regions: [{ region: "Emilia-Romagna", value: 999900, perCapita: 1000 }],
  source: {
    siopeOwner: "RGS e Banca d’Italia", siopeMovementsUrl: "https://www.siope.it/movimenti",
    siopeRegistryUrl: "https://www.siope.it/anagrafiche", ipaUrl: "https://indicepa.gov.it/",
    siopeMovementsLastModified: "2026-09-05T12:00:00Z", siopeRegistryLastModified: null, ipaLastModified: null,
    acquisitionDate: "2026-09-05T12:00:00Z", checkedAt: "2026-09-05T12:00:00Z", observedAt: "2026-09-05T12:00:00Z",
    siopeMovementsSha256: "a".repeat(64), siopeRegistrySha256: "b".repeat(64), ipaSha256: "c".repeat(64),
  },
  methodology: { measure: "Incassi di cassa.", periodicity: "Mensile.", territorialJoin: "Sede IPA.", populationSource: "SIOPE.", populationReference: "Data non dichiarata.", perCapitaCoverage: "Solo popolazione nota.", warning: "Non competenza." },
};
const fixtureUrl = `data:text/javascript,${encodeURIComponent(`
  export const state = { error: null, comparable: false, absent: false, filters: null, historicalPartial: false, latestComplete: false };
  export const availableSiopeReceiptsYears = [2026, 2025, 2024];
  const row = ${JSON.stringify(row)};
  const snapshot = ${JSON.stringify(snapshot)};
  const period = year => ({year, startMonth: 1, endMonth: year === 2026 && !state.latestComplete ? 9 : 12, completeness: (year === 2026 && !state.latestComplete) || (year === 2025 && state.historicalPartial) ? 'partial' : 'complete'});
  export const getSiopeMunicipalReceiptsSnapshot = (year = 2026) => ({...snapshot, year});
  export function querySiopeMunicipalReceipts(filters) {
    state.filters = filters;
    if (state.error) throw new Error(state.error);
    return {
      national: getSiopeMunicipalReceiptsSnapshot(filters.year), period: period(filters.year ?? 2026), filters: {region: filters.region ?? null, query: filters.query ?? null, code: filters.code ?? null},
      selection: {municipalities: 30, withMovements: 29, totalCents: 987654},
      pagination: {total: 30, limit: filters.limit, offset: filters.offset, returned: 2},
      municipalities: [row, {...row, taxCode: '09876543210', codiceIpa: null, name: 'Comune senza IPA', totalCents: null, perCapitaCents: null, perSquareKmCents: null}], caveats: [],
    };
  }
  export const getSiopeMunicipalityCashComparison = (taxCode, year) => ({
    receipts: state.absent ? null : row, paymentsCents: 98765, comparable: state.comparable,
    reason: 'Periodi non allineati: rilascio diverso.', period: period(year),
  });
`)}`;
const linkUrl = `data:text/javascript,${encodeURIComponent(`import { createElement } from ${JSON.stringify(new URL("../node_modules/react/index.js", import.meta.url).href)}; export default function Link(props) { return createElement('a', props); }`)}`;
const cssUrl = `data:text/javascript,${encodeURIComponent("export default new Proxy({}, {get: (_, key) => String(key)});")}`;
const owned = { test: (url) => /\/src\/app\/(?:entrate\/|enti\/\[codice\]\/municipality-receipts\.tsx)/.test(decodeURIComponent(url)) };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/siope-receipts" && owned.test(context.parentURL ?? "")) return { url: fixtureUrl, shortCircuit: true };
    if (specifier === "next/link") return { url: linkUrl, shortCircuit: true };
    if (specifier.endsWith(".module.css")) return { url: cssUrl, shortCircuit: true };
    if (specifier.startsWith(".") && owned.test(context.parentURL ?? "") && !/\.[a-z]+$/.test(specifier)) {
      const extension = specifier.endsWith("receipts-view") ? ".ts" : ".tsx";
      return nextResolve(new URL(`${specifier}${extension}`, context.parentURL).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".tsx") || !owned.test(url)) return nextLoad(url, context);
    return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
    };
  },
});
const { state } = await import(fixtureUrl);
const { default: Page, metadata } = await import("../src/app/entrate/page.tsx");
const { MunicipalityReceipts } = await import("../src/app/enti/[codice]/municipality-receipts.tsx");

const renderPage = async (params = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));

test("receipts filters reject malformed or repeated parameters and cap the page size", () => {
  assert.deepEqual(receiptsPageFilters({}), { year: undefined, region: undefined, query: undefined, code: undefined, limit: 25, offset: 0 });
  assert.deepEqual(receiptsPageFilters({ anno: "2024", regione: " Lazio ", q: " Roma ", pagina: "3", codice: "c_roma" }), { year: 2024, region: "Lazio", query: "Roma", code: "c_roma", limit: 25, offset: 50 });
  for (const params of [{ anno: "2026oops" }, { anno: ["2024", "2026"] }, { regione: ["Lazio"] }, { pagina: "0" }, { pagina: "-1" }, { pagina: "2.5" }, { pagina: "4002" }]) {
    assert.throws(() => receiptsPageFilters(params));
  }
  assert.equal(receiptsPageFilters({ q: "", regione: "" }).query, undefined);
});

test("pagination retains all filters and the observed period stays explicit", () => {
  const href = receiptsPageHref({ year: 2026, region: "Valle d'Aosta", query: "Saint & Pierre", code: "c_test", page: 2 });
  assert.deepEqual(receiptsPageFilters(Object.fromEntries(new URL(href, "https://example.test").searchParams)), { year: 2026, region: "Valle d'Aosta", query: "Saint & Pierre", code: "c_test", limit: 25, offset: 25 });
  assert.equal(receiptsPeriodLabel({ year: 2026, endMonth: 9, completeness: "partial" }), "Gennaio-settembre 2026 · dati parziali");
  assert.equal(receiptsPeriodLabel({ year: 2024, endMonth: 12, completeness: "complete" }), "Anno 2024 · completo");
});

test("receipts page renders server-filtered rows, a national context and canonical IPA links", async () => {
  const html = await renderPage({ regione: "Emilia-Romagna", q: "prova" });
  assert.match(html, /method="get"/);
  assert.match(html, /name="anno"/);
  assert.match(html, /name="regione"/);
  assert.match(html, /name="q"/);
  assert.match(html, /dati parziali/);
  assert.match(html, /non accertamenti né entrate di competenza/);
  assert.match(html, /Contesto nazionale, anche con filtri attivi/);
  assert.match(html, /Incassi dell’intera selezione/);
  assert.match(html, /href="\/enti\/c_test#dati-incassi"/);
  assert.doesNotMatch(html, /\/enti\/09876543210|\/enti\/null/);
  assert.match(html, /Nessun movimento osservato/);
  assert.match(html, /pagina=2/);
  assert.match(html, /rel="next"/);
  assert.match(html, /Movimenti SIOPE/);
  assert.equal(state.filters.limit, 25);
  assert.equal(state.filters.query, "prova");
});

test("invalid query input and runtime filter errors render readable recovery states", async () => {
  assert.match(await renderPage({ anno: "wrong" }), /role="alert"/);
  state.error = "Regione non valida";
  try {
    const html = await renderPage({ regione: "Atlantide" });
    assert.match(html, /Regione non valida/);
    assert.match(html, /Torna ai filtri/);
  } finally { state.error = null; }
});

test("municipality payments are hidden unless the cash-period guard permits them", () => {
  state.comparable = false;
  const blocked = renderToStaticMarkup(createElement(MunicipalityReceipts, { taxCode: row.taxCode }));
  assert.match(blocked, /Periodi non allineati: rilascio diverso/);
  assert.doesNotMatch(blocked, /987,65/);
  assert.match(blocked, /Gennaio-settembre 2026 · dati parziali/);
  assert.match(blocked, /Anno 2025 · completo/);
  assert.match(blocked, /Anno 2024 · completo/);
  state.comparable = true;
  try {
    assert.match(renderToStaticMarkup(createElement(MunicipalityReceipts, { taxCode: row.taxCode })), /987,65/);
  } finally { state.comparable = false; }
  state.absent = true;
  try {
    assert.match(renderToStaticMarkup(createElement(MunicipalityReceipts, { taxCode: row.taxCode })), /Nessun movimento osservato/);
  } finally { state.absent = false; }
});

test("a historical December snapshot remains partial when the runtime says partial", async () => {
  state.historicalPartial = true;
  try {
    assert.equal(receiptsPeriodLabel({ year: 2025, endMonth: 12, completeness: "partial" }), "Gennaio-dicembre 2025 · dati parziali");
    const page = await renderPage({ anno: "2025" });
    assert.match(page, /Gennaio-dicembre 2025 · dati parziali/);
    assert.doesNotMatch(page, /Anno 2025 · completo|Anno completo/);
    const municipality = renderToStaticMarkup(createElement(MunicipalityReceipts, { taxCode: row.taxCode }));
    assert.match(municipality, /Gennaio-dicembre 2025 · dati parziali/);
    assert.doesNotMatch(municipality, /Anno 2025 · completo/);
  } finally { state.historicalPartial = false; }
});

test("a complete 2026 refresh removes partial assertions and labels HTTP source timestamps", async () => {
  assert.match(metadata.description, /può essere parziale/);
  assert.doesNotMatch(metadata.description, /2026 è parziale/);
  const partial = renderToStaticMarkup(createElement(MunicipalityReceipts, { taxCode: row.taxCode }));
  assert.match(partial, /Il periodo più recente è una rilevazione parziale/);
  state.latestComplete = true;
  try {
    const page = await renderPage({ anno: "2026" });
    assert.match(page, /Anno 2026 · completo/);
    assert.doesNotMatch(page, /dati parziali|2026 è parziale/);
    const municipality = renderToStaticMarkup(createElement(MunicipalityReceipts, { taxCode: row.taxCode }));
    assert.match(municipality, /Anno 2026 · completo/);
    assert.doesNotMatch(municipality, /rilevazione parziale|dati parziali|File del/);
    assert.match(municipality, /Aggiornamento HTTP \(Last-Modified\)/);
  } finally { state.latestComplete = false; }
});

test("receipts discovery includes Soldi, footer, sitemap and llms without a client data bundle", () => {
  assert.equal(activeNavSection("/entrate?anno=2026")?.label, "Soldi");
  assert.ok(SITE_MAP_GROUPS.find((group) => group.title === "Soldi").links.some((link) => link.href === "/entrate"));
  assert.ok(PUBLIC_INDEXABLE_PATHS.includes("/entrate"));
  assert.ok(LLMS_DISCOVERY_PATHS.includes("/entrate"));
  assert.ok(readFileSync(new URL("../public/llms.txt", import.meta.url), "utf8").split(/\r?\n/).some((line) => line.startsWith("- [Incassi comunali](https://www.dovevannoinostrisoldi.com/entrate): ")));
  for (const path of ["../src/app/entrate/page.tsx", "../src/app/enti/[codice]/municipality-receipts.tsx"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /["']use client["']|\.json["']|JSON\.stringify/);
  }
});
