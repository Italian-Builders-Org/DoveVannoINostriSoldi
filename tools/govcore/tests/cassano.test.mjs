import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import '../../../tests/helpers/register-ts-alias.mjs';
import { GovCoreClient } from '@gov-core/client';
import { enrichDvnsIdentityLinks } from '../links.ts';
const { getMunicipalitySearchEntities, getSiopeMunicipalityDetailByIpaCode } = await import('../../../src/lib/siope-municipality-detail.ts');
const cassano = getMunicipalitySearchEntities().find(row => row.codiceIpa === 'c_c002');
assert.ok(cassano);
assert.equal(cassano.codiceFiscale, '88000230784');
const id = 'gov_' + 'e'.repeat(32);
const evidence = () => ({ source_id: 'synthetic-ipa', source_url: 'https://www.indicepa.gov.it/synthetic-only', retrieved_at: '2026-10-03T00:00:00Z', verified_at: '2026-10-03T01:00:00Z', content_sha256: 'a'.repeat(64), verification_status: 'verified', valid_from: null, valid_to: null, scope: 'institutional', competences: [] });
const publicEntity = () => ({ id, kind: 'municipality', name: "Cassano all'Ionio", status: 'active', aliases: [], facts: [], provenance: [evidence()], identifiers: [{ scheme: 'ipa', value: 'c_c002', valid_from: null, valid_to: null, provenance: [evidence()] }, { scheme: 'tax_code', value: '88000230784', valid_from: null, valid_to: null, provenance: [evidence()] }] });
async function service(t, handler) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    const payload = handler(req, res);
    if (payload) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(payload)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests };
}
const result = entity => ({ schema_version: '1', status: 'resolved', entity, candidates: [] });

test('Cassano and local labels share explicit authority codes without exporting locality or financial overlays', async t => {
  const svc = await service(t, () => result(publicEntity()));
  const accounting = getSiopeMunicipalityDetailByIpaCode('c_c002'), before = JSON.stringify(accounting);
  const records = ['Cassano Allo Ionio', 'Lauropoli', 'Sibari'].map(locality => ({ ...cassano, locality, accounting, privateNotes: 'LOCAL_ONLY' }));
  const originals = JSON.stringify(records);
  const output = await enrichDvnsIdentityLinks(new GovCoreClient({ baseUrl: svc.baseUrl }), records);
  assert.deepEqual(output.links.map(row => row.govCoreEntityId), [id, id, id]);
  assert.equal(output.stats.uniqueRequests, 1);
  assert.equal(svc.requests.length, 1);
  assert.deepEqual(Object.fromEntries(new URL(svc.requests[0], svc.baseUrl).searchParams), { ipa_code: 'c_c002', tax_code: '88000230784' });
  assert.equal(JSON.stringify(records), originals);
  assert.equal(JSON.stringify(accounting), before);
  assert.ok(!JSON.stringify(output).includes('Lauropoli') && !JSON.stringify(output).includes('totalCents'));
});

for (const mode of ['wrong_ipa', 'wrong_tax', 'observed', 'expired', 'retired', 'unavailable']) {
  test(`Cassano overlay withholds ID on ${mode} and retains local accounting`, async t => {
    const svc = await service(t, (_req, res) => {
      const entity = publicEntity();
      if (mode === 'unavailable') { res.writeHead(503); res.end('LOCAL_ONLY'); return null; }
      if (mode === 'wrong_ipa') entity.identifiers[0].value = 'c_wrong';
      if (mode === 'wrong_tax') entity.identifiers[1].value = '00000000001';
      if (mode === 'retired') entity.status = 'retired';
      for (const identifier of entity.identifiers) {
        if (mode === 'observed') { identifier.provenance[0].verification_status = 'observed'; identifier.provenance[0].verified_at = null; }
        if (mode === 'expired') identifier.provenance[0].valid_to = '2026-10-03T02:00:00Z';
      }
      return result(entity);
    });
    const before = JSON.stringify(cassano);
    const output = await enrichDvnsIdentityLinks(new GovCoreClient({ baseUrl: svc.baseUrl }), [cassano]);
    assert.equal(output.links[0].govCoreEntityId, null);
    assert.equal(output.links[0].link.ok, false);
    assert.equal(output.links[0].link.error, mode === 'unavailable' ? 'unavailable' : 'invalid_response');
    assert.equal(JSON.stringify(cassano), before);
    assert.ok(!JSON.stringify(output).includes('LOCAL_ONLY'));
  });
}

test('same selected codes are rechecked on the next call after proof expiry', async t => {
  let fresh = true;
  const svc = await service(t, () => {
    const entity = publicEntity();
    if (!fresh) entity.identifiers[0].provenance[0].valid_to = '2026-10-03T02:00:00Z';
    return result(entity);
  });
  const client = new GovCoreClient({ baseUrl: svc.baseUrl });
  assert.equal((await enrichDvnsIdentityLinks(client, [cassano])).links[0].govCoreEntityId, id);
  fresh = false;
  assert.equal((await enrichDvnsIdentityLinks(client, [cassano])).links[0].govCoreEntityId, null);
  assert.equal(svc.requests.length, 2);
});

for (const locality of ['Lauropoli', 'Sibari']) {
  test(`CLI rejects name-based ${locality} lookup before HTTP`, async t => {
    const svc = await service(t, () => result(publicEntity()));
    await assert.rejects(promisify(execFile)(process.execPath, ['--experimental-strip-types', '--import', '../../scripts/ci/node-test-setup.mjs', 'link-public-entities.mjs', '--name', locality], { cwd: new URL('..', import.meta.url), env: { ...process.env, GOVCORE_URL: svc.baseUrl } }), error => error.code === 2);
    assert.equal(svc.requests.length, 0);
  });
}

test('CLI Cassano case variants use the committed public identity and its corroborating tax code', async t => {
  const svc = await service(t, () => result(publicEntity()));
  const { stdout } = await promisify(execFile)(process.execPath, ['--experimental-strip-types', '--import', '../../scripts/ci/node-test-setup.mjs', 'link-public-entities.mjs', '--ipa', 'c_c002', '--ipa', 'C_C002'], { cwd: new URL('..', import.meta.url), env: { ...process.env, GOVCORE_URL: svc.baseUrl } });
  const output = JSON.parse(stdout);
  assert.deepEqual(output.links.map(row => row.govCoreEntityId), [id, id]);
  assert.equal(svc.requests.length, 1);
  assert.deepEqual(Object.fromEntries(new URL(svc.requests[0], svc.baseUrl).searchParams), { ipa_code: 'c_c002', tax_code: '88000230784' });
});
