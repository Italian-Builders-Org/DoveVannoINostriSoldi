import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server.js';
import './helpers/register-ts-alias.mjs';
const { proxy } = await import('../src/proxy.ts');
const request = path => new NextRequest(`https://example.test${path}`);

test('canonical public snapshots rewrite to ISR without losing RSC parameters', () => {
  const response = proxy(request('/enti/c_e897/appalti?_rsc=abc'));
  assert.equal(response.headers.get('x-middleware-rewrite'), 'https://example.test/snapshot-pages/enti/c_e897/summary?_rsc=abc');
  assert.equal(proxy(request('/appalti/operatori/op-00000001')).headers.get('x-middleware-rewrite'), 'https://example.test/snapshot-pages/operatori/op-00000001');
});

test('filters and duplicate parameters never receive an unfiltered cached page', () => {
  for (const path of [
    '/enti/c_e897/appalti?cpv=12345678',
    '/enti/c_e897/appalti?awardYear=2024',
    '/enti/c_e897/appalti?view=concentration&metric=count&selection=top1',
    '/enti/c_e897/appalti?view=summary&view=awards',
    '/appalti/operatori/op-00000001?year=2024',
    '/appalti/operatori/op-00000001?page=2',
    '/comuni?q=Roma',
  ]) assert.equal(proxy(request(path)).headers.get('x-middleware-rewrite'), null, path);
});

test('default pages and tracking parameters do not create uncached rendering variants', () => {
  assert.ok(proxy(request('/enti/c_e897/appalti?view=summary&page=1&pageSize=25&metric=count&utm_source=share')).headers.get('x-middleware-rewrite')?.includes('/snapshot-pages/enti/c_e897/summary'));
  assert.ok(proxy(request('/appalti/operatori/op-00000001?page=1&fbclid=tracking')).headers.get('x-middleware-rewrite')?.includes('/snapshot-pages/operatori/op-00000001'));
  assert.equal(proxy(request('/appalti/operatori/op-00000001?minAmount=100')).headers.get('x-middleware-rewrite'), null);
});

test('empty operator form fields share the first-page snapshot while actual and repeated filters stay dynamic', () => {
  const path = '/appalti/operatori/op-00000001';
  const fields = ['year', 'authority', 'procedure', 'minAmount', 'maxAmount'];
  const blankForm = fields.map(key => `${key}=`).join('&');
  for (const query of [blankForm, `page=1&${blankForm}`, 'page=', ...fields.map(key => `${key}=`)]) {
    assert.equal(proxy(request(`${path}?${query}`)).headers.get('x-middleware-rewrite'), `https://example.test/snapshot-pages/operatori/op-00000001?${query}`, query);
  }
  const rscQuery = `${blankForm}&_rsc=operator-cache-proof&fbclid=tracking`;
  const rsc = new NextRequest(`https://example.test${path}?${rscQuery}`, { headers: { rsc: '1', 'next-router-prefetch': '1' } });
  assert.equal(proxy(rsc).headers.get('x-middleware-rewrite'), `https://example.test/snapshot-pages/operatori/op-00000001?${rscQuery}`);
  assert.equal(proxy(request(`/snapshot-pages/operatori/op-00000001?${blankForm}`)).headers.get('x-middleware-next'), '1');
  for (const query of ['page=2', 'page=&page=', ...fields.flatMap(key => [`${key}=&${key}=`, `${key}=&${key}=invalid`, `${blankForm}&${key}=invalid`, `${key}=invalid`])]) {
    assert.equal(proxy(request(`${path}?${query}`)).headers.get('x-middleware-rewrite'), null, query);
  }
  const internalFiltered = proxy(request('/snapshot-pages/operatori/op-00000001?year=2024'));
  assert.equal(internalFiltered.status, 307);
  assert.equal(internalFiltered.headers.get('location'), `https://example.test${path}?year=2024`);
});

test('declared crawlers share limits across expensive pages and host rewrites; browser and user agents remain usable', t => {
  let now = Date.now() + 600_000;
  t.mock.method(Date, 'now', () => now);
  const bot = (path, agent = 'Amazonbot/0.1', host = 'example.test') => new NextRequest(`https://${host}${path}`, { headers: { 'user-agent': agent, 'x-forwarded-for': '192.0.2.92' } });
  const paths = ['/comuni', '/dati/parti-atti', '/progetti/C12345678901234', '/appalti/operatori/op-00000001'];
  for (let hit = 0; hit < 30; hit++) assert.equal(proxy(bot(paths[hit % paths.length])).status, 200);
  assert.equal(proxy(bot('/', 'Amazonbot/0.1', 'comuni.dovevannoinostrisoldi.com')).status, 429);
  for (const agent of ['Claude-User/1.0', 'Claude-SearchBot/1.0', 'Googlebot/2.1', 'Mozilla/5.0', 'NotClaudeBot/1.0']) assert.equal(proxy(bot('/comuni', agent)).status, 200);
  now += 60_000;
  assert.equal(proxy(bot('/comuni')).status, 200);
});

test('Comuni selection and subdomain share a cache key while search stays dynamic', () => {
  assert.equal(proxy(request('/comuni?ente=c_f205')).headers.get('x-middleware-rewrite'), 'https://example.test/snapshot-pages/comuni/c_f205?ente=c_f205');
  const response = proxy(new NextRequest('https://comuni.dovevannoinostrisoldi.com/'));
  assert.equal(response.headers.get('x-middleware-rewrite'), 'https://comuni.dovevannoinostrisoldi.com/snapshot-pages/comuni/c_e897');
});

test('direct internal cache aliases redirect to the public URL and preserve filters', () => {
  const response = proxy(request('/snapshot-pages/enti/c_e897/summary?cpv=12345678'));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'https://example.test/enti/c_e897/appalti?cpv=12345678&view=summary');
});

// The on-demand renderer also traverses the proxy for its internal URL.
test('default internal snapshots render without redirect loops or bypassing crawler limits', () => {
  assert.equal(proxy(request('/snapshot-pages/enti/c_e897/summary')).status, 200);
  assert.equal(proxy(request('/snapshot-pages/operatori/op-00000001')).status, 200);
  assert.equal(proxy(request('/snapshot-pages/comuni/c_f205?ente=c_f205')).status, 200);
  const filtered = proxy(request('/snapshot-pages/comuni/c_f205?q=Roma'));
  assert.equal(filtered.status, 307);
  assert.equal(new URL(filtered.headers.get('location')).pathname, '/comuni');
  assert.equal(proxy(request('/snapshot-pages/enti/c_e897/unknown')).status, 404);
});
