import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { EDITORIAL_TOPICS } from '../../src/lib/integrated-editorial.ts';
import { STATE_ADMINISTRATION_IPA_CODES } from '../../src/lib/data/state-administration-identities.ts';
import { PRIMARY_NAV } from '../../src/lib/site-navigation.ts';
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario } from './harness.mjs';

const baseUrl = defaultBaseUrl();
const directory = 'artifacts/browser/ui-clarity';
mkdirSync(directory, { recursive: true });
const results = [];
const browser = await launchBrowser();

async function geometry(page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const visible = (node) => !!node && node.getBoundingClientRect().width > 0 && getComputedStyle(node).visibility !== 'hidden';
    const header = document.querySelector('.site-header').getBoundingClientRect();
    const input = document.querySelector('#global-site-search');
    const trigger = document.querySelector('.header-search-trigger');
    const content = document.querySelector('.site-content').getBoundingClientRect();
    return {
      width: innerWidth, scroll: document.documentElement.scrollWidth,
      input: visible(input), trigger: visible(trigger),
      content: { left: content.left, right: content.right },
      header: { height: header.height, bottom: header.bottom },
      bodyBottomPadding: getComputedStyle(document.body).paddingBottom,
      heading: document.querySelector('main h1')?.textContent.trim(),
    };
  });
}
function assertGeometry(state) {
  assert.ok(state.scroll <= state.width + 1, `Pagina più larga dello schermo: ${JSON.stringify(state)}`);
  assert.ok(state.content.left >= 0 && state.content.right <= state.width + 1, JSON.stringify(state));
  assert.equal(state.trigger, state.width < 1100, 'Ricerca compatta sotto 1100 px');
  assert.equal(state.input, state.width >= 1100, 'Campo e pulsante di ricerca si alternano');
  assert.equal(state.bodyBottomPadding, '0px', 'Nessuna fascia sotto il contenuto');
}

try {
  for (const width of process.env.DVNS_CLARITY_ROUTES_ONLY === '1' ? [] : (process.env.DVNS_CLARITY_WIDTHS ? process.env.DVNS_CLARITY_WIDTHS.split(",").map(Number) : [320, 390, 675, 743, 768, 983, 1100, 1280, 1309, 1440, 1600])) {
    for (const pathname of ['/', '/assistente']) await runScenario(browser, {
      label: `Chiarezza ${pathname} ${width}`, pathname, width, baseUrl, suite: 'ui-clarity', waitUntil: 'networkidle2',
      validate: async (page) => {
        await page.setViewport({ ...page.viewport(), height: width === 390 ? 844 : width === 1309 ? 818 : width === 1280 ? 695 : width < 1100 ? 695 : 900 });
        const state = await geometry(page); assertGeometry(state);
        if (width < 1100) {
          await page.focus('.header-search-trigger'); await page.keyboard.press('Enter');
          await page.waitForSelector('#global-site-search', { visible: true });
          assert.equal(await page.evaluate(() => document.activeElement?.id), 'global-site-search');
          const box = await page.$eval('.header-search', (node) => node.getBoundingClientRect().toJSON());
          assert.ok(box.left >= 0 && box.right <= width, JSON.stringify(box));
          assert.ok(box.top >= state.header.bottom, 'Il campo si apre sotto la barra');
          await page.keyboard.press('Escape');
          await page.waitForSelector('#global-site-search', { hidden: true });
          assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('header-search-trigger')), true);
        }
        if (pathname === '/') {
          if (width > 900) {
            const rows = await page.evaluate(() => {
              const box = (part) => document.querySelector(`main [class*="${part}"]`).getBoundingClientRect();
              return { firstBottom: Math.abs(box('summaryPanel').bottom - box('mapPanel').bottom), secondTop: Math.abs(box('monthsPanel').top - box('regionsPanel').top), secondBottom: Math.abs(box('monthsPanel').bottom - box('regionsPanel').bottom) };
            });
            assert.ok(Object.values(rows).every((gap) => gap < 2), `Pannelli disallineati: ${JSON.stringify(rows)}`);
          }
          assert.equal(await page.$eval('.footer-sitemap', (node) => node.open), false);
          await page.hover('.footer-support-action');
          const colors = await page.$eval('.footer-support-action', (node) => ({
            bg: getComputedStyle(node).backgroundColor,
            text: getComputedStyle(node.querySelector('strong')).color,
          }));
          assert.notEqual(colors.bg, colors.text, 'Testo della card visibile in hover');
          await page.focus('.footer-sitemap > summary'); await page.keyboard.press('Enter');
          assert.equal(await page.$eval('.footer-sitemap', (node) => node.open), true);
          await page.keyboard.press('Enter');
          if (width >= 1100) {
            const links = await page.$$eval('#desktop-navigation .nav-item > a', (nodes) => nodes.map((node) => {
              const box = node.getBoundingClientRect(); const nav = node.closest('nav').getBoundingClientRect();
              return { name: node.textContent.trim(), fits: box.top >= nav.top && box.bottom <= nav.bottom + 1 };
            }));
            assert.deepEqual(links.map((link) => link.name), PRIMARY_NAV.map((item) => item.label));
            assert.ok(links.every((link) => link.fits), 'Tutte le voci principali visibili nell’altezza disponibile');
          }
        }
        await page.evaluate(() => { document.activeElement?.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
        await page.mouse.move(width - 2, 2);
        assertGeometry(await geometry(page));
        await page.screenshot({ path: `${directory}/${pathname === '/' ? 'home' : 'assistant'}-${width}.png`, fullPage: true });
        results.push({ pathname, ...state, status: 'PASS' });
      },
    });
  }

  if (process.env.DVNS_CLARITY_ROUTES_ONLY !== '1') await runScenario(browser, {
    label: 'Annunci, pausa, tastiera e movimento ridotto', pathname: '/', width: 1440, baseUrl, suite: 'ui-clarity', waitUntil: 'networkidle2',
    validate: async (page) => {
      const active = () => page.$eval('[data-announcement] a[data-active="true"]', (node) => ({ text: node.textContent.trim(), href: node.getAttribute('href') }));
      assert.equal((await active()).href, '/report/2026-08');
      await page.waitForFunction(() => document.querySelector('[data-announcement] a[data-active="true"]')?.getAttribute('href') === '/studi/dai-fondi-ai-posti', { timeout: 10_000 });
      await page.focus('[data-announcement] button[aria-pressed]'); await page.keyboard.press('Enter');
      await page.mouse.move(1400, 850);
      const paused = await active();
      await new Promise((resolve) => setTimeout(resolve, 7_200));
      assert.deepEqual(await active(), paused, 'Pausa mantiene articolo e URL');
      await page.focus('[data-announcement] button[aria-label^="Mostra:"]'); await page.keyboard.press('Enter');
      assert.equal((await active()).href, '/report/2026-08');
      assert.equal(await page.$eval('[data-announcement]', (node) => node.dataset.instant), 'true');
      assert.equal(await page.$$eval('[data-announcement] a:not([tabindex="-1"])', (nodes) => nodes.length), 1);
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.reload({ waitUntil: 'networkidle2' });
      const reduced = await active();
      await new Promise((resolve) => setTimeout(resolve, 7_200));
      assert.deepEqual(await active(), reduced, 'Movimento ridotto ferma la rotazione');
      assert.ok(['none', 'blur(0px)'].includes(await page.$eval('[data-announcement] a[data-active="true"]', (node) => getComputedStyle(node).filter)));
      await page.focus('#global-site-search');
      await page.setViewport({ ...page.viewport(), width: 743 });
      await page.waitForFunction(() => document.activeElement?.id === 'global-site-search' && document.querySelector('#global-site-search').getBoundingClientRect().width > 0);
      await page.keyboard.press('Escape');
      await page.setViewport({ ...page.viewport(), width: 1440 });
      await page.waitForFunction(() => document.activeElement?.id === 'global-site-search');
      results.push({ pathname: '/', scenario: 'announcements-and-keyboard', status: 'PASS' });
    },
  });

  if (process.env.DVNS_CLARITY_ROUTES_ONLY !== '1') await runScenario(browser, {
    label: 'Categorie e andamento mensile', pathname: '/', width: 1440, baseUrl, suite: 'ui-clarity', waitUntil: 'networkidle2',
    validate: async (page) => {
      const snapshot = JSON.parse(readFileSync('src/data/generated/siope-municipal.json', 'utf8'));
      const money = (value) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(value).replace(/\s/g, '');
      const root = '[data-composition-state="ready"]';
      assert.equal(await page.$$eval(`${root} [data-label-mode]`, (nodes) => nodes.length), 5);
      await page.click(`${root} details > summary`);
      const total = await page.$eval(`${root} tbody tr:last-child td`, (node) => node.textContent.replace(/\s/g, ''));
      assert.equal(total, money(snapshot.totalPaid));
      const values = await page.$$eval('[class*="monthList"] li > b', (nodes) => nodes.map((node) => node.textContent.trim()));
      assert.equal(values.length, snapshot.monthly.length);
      for (const [index, point] of snapshot.monthly.entries()) assert.equal(values[index], (point.flow / 1e9).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      results.push({ pathname: '/', scenario: 'category-shares-and-monthly-values', status: 'PASS' });
    },
  });

  if (process.env.DVNS_CLARITY_ROUTES_ONLY !== '1') for (const width of [390, 1440]) await runScenario(browser, {
    label: `Colonne comprensibili e dettagli ${width}`, pathname: '/dati/affitti-immobili', width, baseUrl, suite: 'ui-clarity', waitUntil: 'networkidle2',
    validate: async (page) => {
      const headers = await page.$$eval('table thead th', (nodes) => nodes.map((node) => node.textContent.trim()));
      assert.equal(headers[0], 'Ente');
      assert.ok(headers.includes('Canone annuo (€)'));
      assert.ok(!headers.some((header) => ['Riga', 'Codice IPA', 'Codice fiscale'].includes(header)));
      const first = 'table tbody tr:first-child';
      assert.doesNotMatch(await page.$eval(first, (node) => node.innerText), /row-[a-f0-9]+/);
      const label = await page.$eval('[class*="statText"]', (node) => ({ size: getComputedStyle(node).fontSize, weight: getComputedStyle(node).fontWeight }));
      assert.deepEqual(label, { size: '16px', weight: '500' });
      await page.focus(`${first} details summary`); await page.keyboard.press('Enter');
      const detail = await page.$eval(`${first} details`, (node) => ({ open: node.open, text: node.innerText }));
      assert.equal(detail.open, true);
      assert.match(detail.text, /row-[a-f0-9]+/);
      assert.match(detail.text, /Codice IPA/);
      assert.match(detail.text, /Codice fiscale/);
      assertGeometry(await geometry(page));
      results.push({ pathname: '/dati/affitti-immobili', width, scenario: 'source-fields-preserved-in-row-details', status: 'PASS' });
    },
  });

  if (process.env.DVNS_CLARITY_ALL_ROUTES === '1') {
    const staticRoutes = readdirSync('src/app', { recursive: true }).filter((file) => /(^|\/)page\.tsx$/.test(file) && !file.includes('[')).map((file) => `/${file.replace(/(^|\/)page\.tsx$/, '')}`.replace(/\/$/, '') || '/');
    const catalog = JSON.parse(readFileSync('src/data/generated/integrated/catalog.json', 'utf8'));
    const paths = new Set([
      ...staticRoutes,
      ...EDITORIAL_TOPICS.map((topic) => `/${topic.section}/${topic.slug}`),
      ...catalog.datasets.map((dataset) => `/dati/${dataset.id}`),
      '/report/2026-08', '/governi/meloni-i', '/enti/c_f205', '/enti/agid',
      '/enti/c_h501/appalti?view=summary', '/progetti/B11B21001610005',
      '/imprese?metric=turnover', '/imprese?metric=istat_value_added_per_employee', '/imprese?metric=active_enterprises', '/imprese?metric=employees', '/imprese?metric=active_local_units', '/imprese?metric=production_value_band_count',
      '/cerca?q=Roma', '/dati?vista=tutti', '/dati?vista=ambito',
    ]);
    for (const code of Object.keys(STATE_ADMINISTRATION_IPA_CODES).slice(0, 1)) paths.add(`/stato/amministrazioni/${code}`);
    for (const pathname of (process.env.DVNS_CLARITY_PATHS ? process.env.DVNS_CLARITY_PATHS.split(',') : [...paths].sort())) for (const width of [390, 1440]) {
      try {
        await runScenario(browser, {
          label: `Audit ${pathname} ${width}`, pathname, width, baseUrl, suite: 'ui-clarity-all', waitUntil: 'networkidle2',
          validate: async (page) => {
            const state = await geometry(page); assertGeometry(state);
            assert.ok(state.heading, 'Titolo della pagina disponibile');
            if (width >= 1100 && !(await page.$('#desktop-navigation .nav-submenu:not([hidden])'))) assert.equal(await page.$$eval('#desktop-navigation .nav-item > a', (links) => links.every((link) => {
              const box = link.getBoundingClientRect(); const nav = link.closest('nav').getBoundingClientRect();
              return box.top >= nav.top && box.bottom <= nav.bottom + 1;
            })), true, 'Nessuna sezione tagliata nella sidebar');
            const filename = `${pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}-${width}.png`;
            await page.screenshot({ path: `${directory}/${filename}`, fullPage: ['/', '/imprese', '/istruzione', '/spese', '/territori', '/coesione', '/controlli', '/istituzioni', '/fonti', '/dati', '/enti', '/entrate', '/stato', '/ministeri', '/regioni', '/palazzo-chigi'].includes(pathname) });
            const spacingCandidates = width < 1100 ? [] : await page.evaluate(() => [...document.querySelectorAll('main div, main section')].flatMap((node) => {
              if (getComputedStyle(node).display !== 'grid' || node.closest('details:not([open])')) return [];
              const boxes = [...node.children].filter((child) => getComputedStyle(child).position !== 'absolute').map((child) => ({ box: child.getBoundingClientRect(), label: child.querySelector('h2, h3')?.textContent.trim() }));
              const sameRow = boxes.filter(({ box }) => box.width > 180 && Math.abs(box.top - boxes[0]?.box.top) < 2);
              if (sameRow.length < 2) return [];
              const gap = Math.max(...sameRow.map(({ box }) => box.bottom)) - Math.min(...sameRow.map(({ box }) => box.bottom));
              return gap > 180 ? [{ label: node.className, gap: Math.round(gap), panels: sameRow.map(({ label }) => label) }] : [];
            }));
            results.push({ pathname, ...state, spacingCandidates, finalUrl: page.url(), status: 'PASS' });
          },
        });
      } catch (error) { results.push({ pathname, width, status: 'FAIL', error: error.message }); }
      writeFileSync(`${directory}/results.json`, JSON.stringify(results, null, 2));
      console.log(`${results.at(-1).status} ${pathname} ${width}`);
    }
  }
} finally {
  writeFileSync(`${directory}/results.json`, JSON.stringify(results, null, 2));
  await closeBrowser(browser);
}
assert.equal(results.filter((result) => result.status === 'FAIL').length, 0, 'Audit incompleto: consultare results.json');
console.log(`PASS UI clarity: ${results.length} checks`);
