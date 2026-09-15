import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const report=JSON.parse(readFileSync(new URL('../../src/content/reports/state-budget-reader.json',import.meta.url),'utf8'));

/** Called by the existing monthly-report production suite, in light/dark and all its viewports. */
export async function inspectStateBudgetReader(page,width){
  assert.equal(await page.$eval('main h1',n=>n.textContent),report.title);
  assert.equal(new URL(await page.$eval('link[rel="canonical"]',n=>n.href)).pathname,report.route);
  assert.equal(await page.$eval('meta[property="article:published_time"]',n=>n.content),report.publishedOn);
  assert.equal(await page.$eval('main a[download]',n=>n.getAttribute('href')),report.pdfPath);
  assert.deepEqual(await page.$$eval('nav[aria-label="Indice dei riscontri"] a',nodes=>nodes.map(n=>n.hash)),report.cases.map(c=>'#'+c.id));
  assert.equal(await page.$$eval('main section[data-kind]',nodes=>nodes.length),report.cases.length);
  assert.ok(await page.$$eval('main a[href^="#"]',nodes=>nodes.every(n=>document.getElementById(n.hash.slice(1)))),'Internal source/case anchor missing');
  const ids=await page.$$eval('main [id]',nodes=>nodes.map(n=>n.id));
  assert.equal(new Set(ids).size,ids.length,'Duplicate anchor');
  assert.ok(await page.$eval('main',n=>n.innerText.includes('1.109,15')));
  for(const c of report.cases){
    const section=await page.$('main section#'+c.id);assert.ok(section);
    assert.equal(await section.$eval('h3',n=>n.textContent),c.title);
    const text=await section.evaluate(n=>n.textContent);
    assert.ok(text.includes(c.conclusion),'Conclusion absent: '+c.id);
    const summary=await section.$('details > summary');await summary.focus();await page.keyboard.press('Enter');
    assert.equal(await section.$eval('details',n=>n.open),true,'Keyboard opening failed');
    for(const id of c.sourceIds){const url=report.sources.find(s=>s.id===id).url;assert.ok((await section.$$eval('details a',nodes=>nodes.map(n=>n.getAttribute('href')))).includes(url));}
    await page.keyboard.press('Space');assert.equal(await section.$eval('details',n=>n.open),false);
  }
  const rti=await page.$('main #rti details > summary');await rti.focus();await page.keyboard.press('Enter');
  const table=await page.$eval('#rti table',n=>n.textContent);
  for(const value of ['59.279.167,72','186.277.425,17','11.087.847,72','138.086.105,17','8,03'])assert.ok(table.includes(value));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Report ${width}px: open data cause horizontal overflow`);
  assert.ok(await page.$$eval('main figure',nodes=>nodes.every(n=>n.querySelector('figcaption')?.textContent?.trim())));
  // The compatibility entry is a redirect, not another edition. Tested by the runner.
}
