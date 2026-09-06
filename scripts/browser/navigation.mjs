import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { PRIMARY_NAV } from "../../src/lib/site-navigation.ts";
import { closeBrowser, defaultBaseUrl, launchBrowser, runScenario, waitForServer } from "./harness.mjs";

const baseUrl = defaultBaseUrl();
const destinations = [...new Set(PRIMARY_NAV.flatMap((item) => [item.href, ...(item.children ?? []).map((child) => child.href)]))];
mkdirSync("artifacts/browser", { recursive: true });
await waitForServer(baseUrl);
const linkResults = [];
for (const href of destinations) {
  const response = await fetch(new URL(href, baseUrl), { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `Destinazione non disponibile: ${href}`);
  await response.arrayBuffer();
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
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function openMobile(page) {
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
    search: document.querySelector('#global-site-search').getBoundingClientRect().toJSON(),
  }));
  assert.ok(geometry.root <= geometry.width + 1 && geometry.body <= geometry.width + 1, JSON.stringify(geometry));
  assert.ok(geometry.main.left >= 0 && geometry.main.right <= geometry.width + 1, JSON.stringify(geometry));
  assert.ok(geometry.search.width > 0 && geometry.search.left >= 0 && geometry.search.right <= geometry.width + 1, 'Ricerca sempre visibile');
}

const browser = await launchBrowser();
try {
  for (const width of [320, 390, 768, 1024, 1099, 1100, 1280, 1440, 1600]) {
    await runScenario(browser, {
      label: `Sidebar ${width}px`, pathname: '/imprese?metric=employees', width, touch: width < 1100, suite: 'navigation',
      validate: async (page) => {
        await assertFits(page);
        const mobile = width < 1100;
        if (mobile) await openMobile(page);
        const root = mobile ? '#mobile-navigation-links' : '#desktop-navigation';
        const hrefs = await page.$$eval(`${root} a`, (links) => [...new Set(links.map((link) => link.getAttribute('href')))]);
        assert.deepEqual(hrefs, destinations, 'Tutte le destinazioni restano nel menu');
        const names = await page.$$eval(`${root} .nav-item > a`, (links) => links.map((link) => link.textContent.trim()));
        assert.deepEqual(names, PRIMARY_NAV.map((item) => item.label));
        assert.equal(await page.$$eval(`${root} .nav-item > a > svg`, (icons) => icons.length), PRIMARY_NAV.length);
        assert.deepEqual(await page.$$eval(`${root} .nav-submenu:not([hidden]) a[aria-current="page"]`, (links) => links.map((link) => link.textContent.trim())), ['Addetti']);
        // Every disclosure is reachable by keyboard and stays exclusive.
        for (const item of PRIMARY_NAV.filter((entry) => entry.children?.length)) {
          const selector = `${root} button[aria-controls$="-${item.icon}"]`;
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
        if (mobile) {
          await page.focus('[aria-label="Chiudi menu di navigazione"]');
          await page.screenshot({path:`artifacts/browser/sidebar-open-${width}.png`});
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
          await openMobile(page);
          await page.touchscreen.tap(width - 15, 200);
          await page.waitForSelector('#mobile-navigation', { hidden: true });
          await openMobile(page);
          await tap(page, '[aria-label="Chiudi menu di navigazione"]');
          await page.waitForSelector('#mobile-navigation', { hidden: true });
        } else {
          const before = await page.$eval('.site-content', (node) => node.getBoundingClientRect().width);
          await page.focus('.sidebar-collapse');
          await page.keyboard.press('Enter');
          await page.waitForSelector('.desktop-sidebar[data-collapsed="true"]');
          const after = await page.$eval('.site-content', (node) => node.getBoundingClientRect().width);
          assert.ok(after - before >= 170, 'La riduzione libera spazio per mappe e tabelle');
          for (const item of PRIMARY_NAV) {
            const link = await page.$(`${root} .nav-item > a[href="${item.href}"]`);
            await link.focus();
            assert.equal(await link.evaluate((node) => {
              const box = node.getBoundingClientRect();
              return node.title === node.textContent.trim() && box.width >= 44 && box.height >= 44 && box.left >= 0 && box.right <= 69;
            }), true, 'Icona raggiungibile con nome e tooltip');
          }
          await assertFits(page);
          await page.screenshot({path:`artifacts/browser/sidebar-compact-${width}.png`});
          await page.click('.sidebar-collapse');
          await page.waitForSelector('.desktop-sidebar[data-collapsed="false"]');
        }
        await assertFits(page);
        await page.screenshot({path:`artifacts/browser/sidebar-${width}.png`});
      },
    });
  }

  for (const width of [1100, 1180, 1280, 1440, 1600]) await runScenario(browser, {
    label: `Sidebar e mappa home ${width}px`, pathname: '/', width, suite: 'navigation',
    validate: async (page) => {
      for (const compact of [false, true]) {
        if (compact) await page.click('.sidebar-collapse');
        await assertFits(page);
        const map = await page.$('[data-region-map="true"]');
        const geometry = await map.evaluate((node) => {
          const panel = node.closest('.panel');
          const box = panel.getBoundingClientRect();
          return { right: box.right, viewport: innerWidth, scroll: panel.scrollWidth, client: panel.clientWidth };
        });
        assert.ok(geometry.right <= geometry.viewport + 1 && geometry.scroll <= geometry.client + 1, JSON.stringify(geometry));
        await page.screenshot({path:`artifacts/browser/sidebar-home-${width}-${compact ? 'compact' : 'expanded'}.png`});
      }
    },
  });

  // Route aliases, nested pages and query-backed children keep their identity.
  for (const [pathname, label] of [['/controlli','Cosa controllare'], ['/territori/irpef','Territori'], ['/appalti','Cosa controllare'], ['/parlamento','Istituzioni'], ['/debito','Soldi'], ['/paper','Studi'], ['/report/2026-08','Report mensili']]) {
    for (const width of [390, 1280]) await runScenario(browser, {
      label:`Sidebar attiva ${pathname} ${width}px`, pathname, width, suite:'navigation',
      validate: async(page) => {
        if (width < 1100) await openMobile(page);
        const root = width < 1100 ? '#mobile-navigation-links' : '#desktop-navigation';
        assert.deepEqual(await page.$$eval(`${root} .nav-item > a[data-section-active="true"]`, (links) => links.map((link) => link.textContent.trim())), [label]);
        if (width < 1100) await page.keyboard.press('Escape');
        await assertFits(page);
      },
    });
  }

  for (const width of [390, 1280]) await runScenario(browser, {
    label:`Sidebar navigazione query ${width}px`, pathname:'/imprese?metric=employees', width, suite:'navigation',
    validate:async(page) => {
      if (width < 1100) await openMobile(page);
      const root = width < 1100 ? '#mobile-navigation-links' : '#desktop-navigation';
      await page.click(`${root} .nav-submenu a[href="/imprese?metric=active_local_units"]`);
      await page.waitForFunction(() => new URL(location.href).searchParams.get('metric') === 'active_local_units');
      if (width < 1100) {
        await page.waitForSelector('#mobile-navigation', {hidden:true});
        await openMobile(page);
      }
      await page.waitForFunction((selector) => document.querySelector(`${selector} .nav-submenu a[aria-current="page"]`)?.textContent.trim() === 'Localizzazioni attive', {}, root);
      if (width < 1100) await page.keyboard.press('Escape');
      else await page.click('.sidebar-collapse');
      await page.goBack();
      await page.waitForFunction(() => new URL(location.href).searchParams.get('metric') === 'employees');
      if (width >= 1100) assert.equal(await page.$eval('.desktop-sidebar', (node) => node.dataset.collapsed), 'true', 'La preferenza sopravvive alla navigazione');
      await assertFits(page);
    },
  });

  await runScenario(browser, {
    label:'Sidebar rotazione e focus', pathname:'/', width:390, suite:'navigation',
    validate:async(page) => {
      await openMobile(page);
      // Preserve device emulation: changing isMobile would reload the page.
      await page.setViewport({...page.viewport(),width:1280,height:900});
      await page.waitForSelector('#mobile-navigation',{hidden:true});
      assert.equal(await page.evaluate(()=> document.activeElement?.classList.contains('sidebar-collapse')),true);
      assert.notEqual(await page.evaluate(()=>getComputedStyle(document.body).overflowY),'hidden');
      await page.setViewport({...page.viewport(),width:768,height:900});
      await page.waitForSelector('.mobile-menu-trigger',{visible:true});
      assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('mobile-menu-trigger')),true);
      await openMobile(page);
      await page.keyboard.press('Escape');
    },
  });
} finally { await closeBrowser(browser); }
console.log(`PASS navigation: ${destinations.length} destinations, 9 widths, disclosures, focus, touch, route/query/history and resize`);
