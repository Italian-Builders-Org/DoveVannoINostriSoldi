import assert from 'node:assert/strict';

/** Real HTTP/browser coverage shared by mandatory core and optional UI clarity. */
export async function inspectAnnouncements(page) {
  const homeUrl = new URL('/', page.url()).toString();
  const colorScheme = await page.evaluate(() => document.documentElement.dataset.theme ?? 'light');
  const active = () => page.$eval('[data-announcement] a[data-active="true"]', (node) => ({ text: node.textContent.trim(), href: node.getAttribute('href') }));
  const assertStationaryLink = async () => {
    const state = await page.$eval('[data-announcement] a[data-active="true"]', (node) => {
      const box = node.getBoundingClientRect();
      const banner = node.closest('[data-announcement]');
      const bannerBox = banner.getBoundingClientRect();
      const track = banner.querySelector('[class*="track"]');
      return {
        accessible: !node.closest('[aria-hidden="true"]') && node.tabIndex === 0,
        visible: box.width > 100 && box.height >= 44 && box.left >= -1 && box.right <= innerWidth + 1
          && box.top >= bannerBox.top - 1 && box.bottom <= bannerBox.bottom + 1,
        fullCopy: [...node.children].every((child) => {
          const copy = child.getBoundingClientRect();
          return copy.left >= box.left && copy.right <= box.right + 1
            && copy.top >= bannerBox.top && copy.bottom <= bannerBox.bottom + 1
            && child.scrollWidth <= child.clientWidth + 1;
        }),
        paused: getComputedStyle(track).animationPlayState === 'paused',
        static: banner.dataset.static === 'true',
      };
    });
    assert.deepEqual(state, { accessible: true, visible: true, fullCopy: true, paused: true, static: true }, 'Il link attivo deve essere accessibile, fermo e interamente visibile');
  };
  assert.equal((await active()).href, '/report/2026-08');
  await page.waitForFunction(() => document.querySelector('[data-announcement] a[data-active="true"]')?.getAttribute('href') === '/studi/dai-fondi-ai-posti', { timeout: 10_000 });
  await page.focus('[data-announcement] a[data-active="true"]');
  await page.waitForFunction(() => document.querySelector('[data-announcement]')?.dataset.static === 'true');
  await assertStationaryLink();
  await page.focus('[data-announcement] button[aria-pressed]'); await page.keyboard.press('Enter');
  await page.mouse.move(page.viewport().width - 2, page.viewport().height - 2);
  const paused = await active();
  await new Promise((resolve) => setTimeout(resolve, 7_200));
  assert.deepEqual(await active(), paused, 'Pausa mantiene articolo e URL');
  await page.focus('[data-announcement] button[aria-label^="Mostra:"]'); await page.keyboard.press('Enter');
  assert.equal((await active()).href, '/report/2026-08');
  assert.equal(await page.$eval('[data-announcement]', (node) => node.dataset.instant), 'true');
  assert.equal(await page.$$eval('[data-announcement] a:not([tabindex="-1"])', (nodes) => nodes.length), 1);
  await assertStationaryLink();
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: colorScheme },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ]);
  await page.reload({ waitUntil: 'networkidle2' });
  const reduced = await active();
  await new Promise((resolve) => setTimeout(resolve, 7_200));
  assert.deepEqual(await active(), reduced, 'Movimento ridotto ferma la rotazione');
  assert.ok(['none', 'blur(0px)'].includes(await page.$eval('[data-announcement] a[data-active="true"]', (node) => getComputedStyle(node).filter)));
  await assertStationaryLink();
  await page.focus('[data-announcement] button[aria-label^="Mostra:"]'); await page.keyboard.press('Enter');
  assert.equal((await active()).href, '/studi/dai-fondi-ai-posti', 'Prossimo annuncio cambia anche il link visibile con movimento ridotto');
  await assertStationaryLink();
  await page.focus('[data-announcement] a[data-active="true"]');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.keyboard.press('Enter')]);
  assert.equal(new URL(page.url()).pathname, '/studi/dai-fondi-ai-posti', 'Il link dell’annuncio si apre da tastiera');
  await page.goto(homeUrl, { waitUntil: 'networkidle2' });
}
