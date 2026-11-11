import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { inspectNavigationPrefetch } from "./navigation-prefetch.mjs";
import { PRIMARY_NAV, FOOTER_SITEMAP_GROUPS, flattenNavLinks } from "../../src/lib/site-navigation.ts";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
const destinations = [
  ...new Set(
    PRIMARY_NAV.flatMap((item) => [
      item.href,
      ...flattenNavLinks(item.children ?? []).map((child) => child.href),
    ]),
  ),
];
mkdirSync("artifacts/browser", { recursive: true });
await waitForServer(baseUrl);
const linkResults = [];
// These pages allow their OpenBDAP adapters 50 seconds before fallback/error UI.
// Give serialization time to complete; all other destinations retain 30 seconds.
const historyDestinations = new Set(['/spese/sanita/storico', '/stato/legislature']);
for (const href of destinations) {
  if (/^https?:\/\//i.test(href)) {
    // External menu targets (other hosts) are not served by this Next process.
    continue;
  }
  try {
    const response = await fetch(new URL(href, baseUrl), {
      signal: AbortSignal.timeout(historyDestinations.has(href) ? 60_000 : 30_000),
    });
    assert.equal(response.status, 200, `Destinazione non disponibile: ${href}`);
    await response.arrayBuffer();
  } catch (cause) {
    throw new Error(`Verifica della destinazione fallita: ${href}`, { cause });
  }
  // Record the expected status only after the response has passed the assertion.
  linkResults.push({ href, status: 200 });
}
writeFileSync("artifacts/browser/navigation-links.json", JSON.stringify(linkResults, null, 2));

async function tap(page, selector) {
  const element = await page.$(selector);
  assert.ok(element, `Controllo assente: ${selector}`);
  await element.scrollIntoView();
  const box = await element.boundingBox();
  assert.ok(box && box.width >= 44 && box.height >= 44, `Target touch troppo piccolo: ${selector}`);
  if (page.viewport()?.hasTouch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function openMenu(page) {
  await tap(page, '.mobile-menu-trigger');
  await page.waitForSelector('#mobile-navigation:modal .primary-nav', { visible: true });
  assert.equal(await page.$eval('.mobile-menu-trigger', (button) => button.getAttribute('aria-expanded')), 'true');
}

async function assertFits(page) {
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    root: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    main: document.querySelector('.site-content').getBoundingClientRect().toJSON(),
    search: document.querySelector(innerWidth < 1100 ? '.header-search-trigger' : '#global-site-search').getBoundingClientRect().toJSON(),
  }));
  assert.ok(geometry.root <= geometry.width + 1 && geometry.body <= geometry.width + 1, JSON.stringify(geometry));
  assert.ok(geometry.main.left >= 0 && geometry.main.right <= geometry.width + 1, JSON.stringify(geometry));
  assert.ok(geometry.search.width > 0 && geometry.search.left >= 0 && geometry.search.right <= geometry.width + 1, 'Ricerca sempre visibile');
  const header = await page.evaluate(() => {
    const shell = document.querySelector('.header-inner').getBoundingClientRect();
    const main = document.querySelector('main').getBoundingClientRect();
    const controls = [...document.querySelectorAll('.header-inner > *')].filter((node) => node.getClientRects().length).map((node) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right };
    });
    return { pathname: location.pathname, left: shell.left, right: shell.right, mainLeft: main.left, mainRight: main.right, controls };
  });
  if (['/', '/spese', '/spese/panoramica'].includes(header.pathname)) {
    assert.ok(Math.abs(header.left - header.mainLeft) < 2 && Math.abs(header.right - header.mainRight) < 2, 'Header e pagina condividono la stessa larghezza');
  }
  assert.ok(header.controls.every((box) => box.left >= header.left && box.right <= header.right + 1), 'Tutte le azioni dell’header rientrano nel contenitore');

}

async function headerAnchors(page) {
  return page.evaluate(() => Object.fromEntries(
    ['.mobile-menu-trigger', '.brand-mark'].map(selector => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return [selector, {left: box.left, top: box.top, width: box.width, height: box.height}];
    }),
  ));
}

function assertSameHeader(expected, actual, route) {
  for (const selector of Object.keys(expected)) for (const key of ['left', 'top', 'width', 'height']) {
    assert.ok(Math.abs(expected[selector][key] - actual[selector][key]) < 2,
      `${route}: ${selector} ${key} cambia tra home e sezione`);
  }
}

const browser = await launchBrowser();
try {
  await inspectNavigationPrefetch(browser, baseUrl);
  for (const width of [320, 390, 768, 1024, 1099, 1100, 1280, 1440, 1600, 1920]) {
    await runScenario(browser, {
      label: `Menu ${width}px`, pathname: '/imprese?metric=employees', width, touch: width < 1100, suite: 'navigation',
      validate: async (page) => {
        await assertFits(page);
        assert.equal(await page.$('.desktop-sidebar'), null);
        assert.equal(await page.$eval('.site-content', (node) => node.getBoundingClientRect().left), 0);
        await openMenu(page);
        const root = '#mobile-navigation-links';
        const hrefs = await page.$$eval(`${root} a`, (links) => [...new Set(links.map((link) => link.getAttribute('href')))]);
        assert.deepEqual(hrefs, destinations, 'Tutte le destinazioni restano nel menu');
        const names = await page.$$eval(`${root} .nav-item > a`, (links) => links.map((link) => link.textContent.trim()));
        assert.deepEqual(names, PRIMARY_NAV.map((item) => item.label));
        assert.equal(await page.$$eval(`${root} .nav-item > a > svg`, (icons) => icons.length), PRIMARY_NAV.length);
        assert.deepEqual(await page.$$eval(`${root} .nav-submenu:not([hidden]) a[aria-current="page"]`, (links) => links.map((link) => link.textContent.trim())), ['Addetti']);
        // Every disclosure is reachable by keyboard and stays exclusive.
        for (const item of PRIMARY_NAV.filter((entry) => entry.children?.length)) {
          const menuKey = item.href.replace(/^\//, "").replace(/\//g, "-") || "home";
          const selector = `${root} button[aria-controls$="-${menuKey}"]`;
          await page.focus(selector);
          if (await page.$eval(selector, (button) => button.getAttribute('aria-expanded')) !== 'true') await page.keyboard.press('Enter');
          assert.equal(await page.$$eval(`${root} .nav-submenu:not([hidden])`, (menus) => menus.length), 1);
          for (const child of item.children) {
            const link = await page.$(`${root} .nav-submenu a[href="${child.href}"]`);
            await link.focus();
            assert.equal(await link.evaluate((element) => {
              const box = element.getBoundingClientRect();
              const nav = element.closest('nav').getBoundingClientRect();
              return box.width > 0 && box.left >= nav.left && box.right <= nav.right + 1 && box.top >= nav.top - 1 && box.bottom <= nav.bottom + 1;
            }), true, `Link raggiungibile con Tab/focus: ${child.href}`);
          }
          await page.focus(selector);
          await page.keyboard.press('Enter');
          assert.equal(await page.$$eval(`${root} .nav-submenu:not([hidden])`, (menus) => menus.length), 0);
        }
        {
          await page.focus('[aria-label="Chiudi menu di navigazione"]');
          await page.screenshot({path:`artifacts/browser/menu-open-${width}.png`});
          assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflowY), 'hidden');
          await page.keyboard.down('Shift');
          await page.keyboard.press('Tab');
          await page.keyboard.up('Shift');
          assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#mobile-navigation')), true, 'Focus resta nel dialogo');
          await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#mobile-navigation')), true);
          await page.keyboard.press('Escape');
          await page.waitForSelector('#mobile-navigation', { hidden: true });
          assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('mobile-menu-trigger')), true, 'Escape restituisce il focus');
          assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).overflowY), 'hidden');
          await openMenu(page);
          if (page.viewport()?.hasTouch) await page.touchscreen.tap(width - 15, 200);
          else await page.mouse.click(width - 15, 200);
          await page.waitForSelector('#mobile-navigation', { hidden: true });
          await openMenu(page);
          await tap(page, '[aria-label="Chiudi menu di navigazione"]');
          await page.waitForSelector('#mobile-navigation', { hidden: true });
        }
        await assertFits(page);
        await page.screenshot({path:`artifacts/browser/menu-${width}.png`});
      },
    });
  }

  for (const width of [390, 768, 1100, 1280, 1440, 1600, 1920]) await runScenario(browser, {
    label: `Home editoriale ${width}px`, pathname: '/', width, suite: 'navigation',
    validate: async (page) => {
      await assertFits(page);
      assert.equal(await page.$('.desktop-sidebar'), null);
      assert.equal(await page.$('nav[aria-label="Argomenti della home"]'), null, 'Nessun indice intermedio');
      assert.equal(await page.$('.footer-sitemap'), null, 'Nessuna directory duplicata nel footer');
      assert.equal(await page.$eval('[data-home-editorial] > header', (header) => header.nextElementSibling?.id), 'analisi');
      assert.equal(await page.$$eval('#analisi > section', (sections) => sections.length), 5);
      for (const href of ['/spese/panoramica', '/imprese', '/controlli']) {
        assert.ok(await page.$(`#analisi a[href="${href}"]`), `Accesso diretto assente: ${href}`);
      }
      assert.equal(await page.$('#quadro-dei-conti'), null, 'Nessun riquadro dei conti nella home');
      assert.equal(await page.$$eval('.site-footer a', (links) => links.some((link) => link.href.includes('buymeacoffee.com'))), false);
      assert.ok(await page.$('#esplora form[action="/cerca"]'), 'Ricerca disponibile dopo le analisi');
      const directoryHrefs = await page.$$eval('#esplora a', (links) => links.map((link) => link.getAttribute('href')));
      for (const group of FOOTER_SITEMAP_GROUPS) for (const link of group.links) {
        assert.ok(directoryHrefs.includes(link.href), `Mappa del sito incompleta: ${link.href}`);
      }
      const headings = await page.$$eval('#analisi h2', (nodes) => nodes.map((node) => node.textContent.trim()));
      assert.equal(headings.length, 5);
      assert.ok(headings.every((title) => !/^0?\d[ /]/.test(title)), 'Titoli senza numerazione decorativa');
      assert.equal(await page.$eval('#esplora', (node) => Boolean(document.querySelector('#controlli-analisi').compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
      await page.click('.mobile-menu-trigger');
      await page.waitForSelector('#mobile-navigation:modal .primary-nav', {visible: true});
      await page.keyboard.press('Escape');
      await page.waitForSelector('#mobile-navigation', {hidden: true});
      assert.equal(await page.$eval('.mobile-menu-trigger', (button) => document.activeElement === button), true);
      await page.screenshot({path:`artifacts/browser/home-editoriale-${width}.png`, fullPage:true});
    },
  });

  for (const width of [320, 390, 768, 1100, 1280, 1440, 1920]) await runScenario(browser, {
    label: `Home verso spesa ${width}px`, pathname: '/', width, suite: 'navigation',
    validate: async (page) => {
      const tabsBefore = (await browser.pages()).length;
      const anchors = await headerAnchors(page);
      assert.equal(await page.$('.site-header a[href="/mcp"]'), null);
      await page.click('#spesa-pubblica a[href="/spese/panoramica"]');
      await page.waitForFunction(() => location.pathname === '/spese/panoramica');
      await page.waitForSelector('[data-region-map="true"]');
      assertSameHeader(anchors, await headerAnchors(page), "/spese/panoramica");
      await assertFits(page);
      await page.select('nav[aria-label="Pagine in Soldi"] select', '/spese');
      await page.waitForFunction(() => location.pathname === '/spese');
      await page.waitForSelector('main h1', { visible: true });
      assertSameHeader(anchors, await headerAnchors(page), "/spese");
      assert.equal(await page.$('.desktop-sidebar'), null);
      await assertFits(page);
      await page.select('nav[aria-label="Pagine in Soldi"] select', '/entrate');
      await page.waitForFunction(() => location.pathname === '/entrate');
      assert.equal((await browser.pages()).length, tabsBefore, 'La navigazione non apre nuove schede');
      await page.goBack();
      await page.waitForFunction(() => location.pathname === '/spese');
      await openMenu(page);
      assert.ok(await page.$('.navigation-tools a[href="/mcp"]'));
      await page.keyboard.press('Escape');
      assert.equal(await page.$eval('.mobile-menu-trigger', (button) => button === document.activeElement), true);
    },
  });

  // Route aliases, nested pages and query-backed children keep their identity.
  for (const [pathname, label] of [['/controlli','Cosa controllare'], ['/territori/irpef','Territori'], ['/appalti','Cosa controllare'], ['/parlamento','Istituzioni'], ['/debito','Soldi'], ['/paper','Studi'], ['/report/2026-08','Report']]) {
    for (const width of [390, 1280]) await runScenario(browser, {
      label:`Sezione attiva ${pathname} ${width}px`, pathname, width, suite:'navigation',
      validate: async(page) => {
        // Child aria-current is added by NavigationSearchSync after hydration.
        const child = `.nav-submenu a[href="${pathname}"]`;
        await openMenu(page);
        if (await page.$(child)) await page.waitForSelector(`${child}[aria-current="page"]`);
        const root = '#mobile-navigation-links';
        assert.deepEqual(await page.$$eval(`${root} .nav-item > a[data-section-active="true"]`, (links) => links.map((link) => link.textContent.trim())), [label]);
        await page.keyboard.press('Escape');
        await assertFits(page);
      },
    });
  }

  for (const width of [390, 1280]) await runScenario(browser, {
    label:`Menu navigazione query ${width}px`, pathname:'/imprese?metric=employees', width, suite:'navigation',
    validate:async(page) => {
      await openMenu(page);
      const root = '#mobile-navigation-links';
      await page.click(`${root} .nav-submenu a[href="/imprese?metric=active_local_units"]`);
      await page.waitForFunction(() => new URL(location.href).searchParams.get('metric') === 'active_local_units');
      await page.waitForSelector('#mobile-navigation', {hidden:true});
      await openMenu(page);
      await page.waitForFunction((selector) => document.querySelector(`${selector} .nav-submenu a[aria-current="page"]`)?.textContent.trim() === 'Localizzazioni attive', {}, root);
        await page.keyboard.press('Escape');
        await page.goBack();
        await page.waitForFunction(() => new URL(location.href).searchParams.get('metric') === 'employees');
        await openMenu(page);
        await page.waitForSelector(`${root} a[href="/imprese?metric=employees"][aria-current="page"]`);
        await page.keyboard.press('Escape');
      await assertFits(page);
    },
  });

  await runScenario(browser, {
    label:'Menu rotazione e focus', pathname:'/imprese', width:390, suite:'navigation',
    validate:async(page) => {
      await openMenu(page);
      // Preserve device emulation: changing isMobile would reload the page.
      await page.setViewport({...page.viewport(),width:1280,height:900});
      await page.waitForSelector('#mobile-navigation:modal');
      assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#mobile-navigation')), true);
      await page.setViewport({...page.viewport(),width:768,height:900});
      await page.waitForSelector('#mobile-navigation:modal');
      await page.keyboard.press('Escape');
    },
  });
} finally { await closeBrowser(browser); }
console.log(`PASS navigation: ${destinations.length} destinations, 10 widths, disclosures, focus, touch, route/query/history and resize`);
