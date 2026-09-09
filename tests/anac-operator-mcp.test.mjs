import assert from 'node:assert/strict';
import test from 'node:test';
import './helpers/register-ts-alias.mjs';
const { queryPublicDataset } = await import('../src/lib/mcp/datasets.ts');
const { datasetCatalog } = await import('../src/lib/mcp/catalog.ts');
const { datasetQuerySchema } = await import('../src/lib/mcp/query-schema.ts');
const { getAnacOperatorByRef, loadAnacOperatorIndexMeta, loadAnacOperatorNationalSummaries } = await import('../src/lib/data/anac-operator-awards-index.ts');
const query = options => queryPublicDataset({ dataset: 'anac_operatori', ...options });

test('operator catalog exposes the shared bounded contract and all three source roles', () => {
  const entry = datasetCatalog.find(item => item.id === 'anac_operatori');
  assert.equal(entry.integration, 'active');
  assert.equal(entry.freshness, 'snapshot');
  assert.deepEqual(entry.filters, ['query', 'code', 'measure', 'limit']);
  assert.equal(entry.sources.length, 3);
  assert.equal(datasetQuerySchema.safeParse(entry.exampleQuery).success, true);
});

test('operator rankings reuse published summaries and preserve exact amounts and snapshot scope', async () => {
  const meta = loadAnacOperatorIndexMeta();
  const summary = loadAnacOperatorNationalSummaries();
  for (const [measure, expected] of [['awardCount', summary.topOperatorsByAwardCount], ['attributedValue', summary.topOperatorsByAttributedValue]]) {
    const result = await query({ measure, limit: 3 });
    assert.equal(result.mode, 'ranking');
    assert.equal(result.rows.length, 3);
    assert.deepEqual(result.rows.map(row => row.ref), expected.slice(0, 3).map(row => row.ref));
    assert.deepEqual(result.rows.map(row => row.attributedValue), expected.slice(0, 3).map(row => row.attributedValue));
    assert.equal(result.observedAt, meta.observedAt);
    assert.equal(result.monetaryUnit, 'EUR');
    assert.equal(result.monetaryNature, 'award-declared');
    assert.equal(result.scope.nationalPopulationClaim, 'not-asserted');
    assert.deepEqual(result.coverage, meta.coverage);
    assert.equal(result.provenance.sourceSpecSha256, meta.sourceSpecSha256);
    assert.equal(result.matched, meta.totals.operators);
    assert.equal(result.truncated, true);
    assert.equal(Object.hasOwn(result.rows[0], 'searchKey'), false);
  }
});

test('operator search and detail distinguish complete counts from the returned CIG sample', async () => {
  const result = await query({ query: 'autostrade', limit: 2 });
  assert.equal(result.mode, 'search');
  assert.equal(result.rows.length, 2);
  assert.ok(result.matched >= result.returned);
  const ref = result.rows[0].ref;
  const operator = getAnacOperatorByRef(ref);
  const detail = await query({ code: ref, limit: 2 });
  assert.equal(detail.rows[0].awardCount, operator.awardCount);
  assert.equal(detail.rows[0].attributedValue, operator.attributedValue);
  assert.deepEqual(detail.rows[0].awards, operator.awards.slice(0, 2));
  assert.equal(detail.rows[0].awardsOmittedFromPublished, operator.awards.length - 2);
  assert.equal(detail.rows[0].awardsPublished, operator.awardsPublished);
  assert.deepEqual((await query({ code: 'op-99999999' })).rows, []);
  assert.deepEqual((await query({ query: 'zzzzinesistentezzzz' })).rows, []);
  for (const forbidden of ['codice_fiscale', 'taxId', 'taxCode', 'searchKey']) {
    assert.equal(Object.keys(detail.rows[0]).includes(forbidden), false);
  }
});

test('operator filters reject widening, ambiguity, malformed refs and unsupported periods', async () => {
  for (const options of [
    { year: 2025 }, { region: 'Lazio' }, { offset: 10 }, { limit: 11 }, { limit: 1.5 },
    { query: 'ab' }, { query: '!!!' }, { query: 'a'.repeat(121) },
    { code: '12345678901' }, { code: '../meta.json' }, { measure: 'payments' },
    { query: 'autostrade', code: 'op-00000001' }, { query: 'autostrade', measure: 'awardCount' },
  ]) await assert.rejects(query(options));
  await assert.rejects(queryPublicDataset({ dataset: 'anac_operatori' }, { signal: AbortSignal.abort() }));
});

test('BYOK selects the registered operator adapter and passes current snapshot evidence to the provider', async () => {
  const { executeByokChat } = await import('../src/lib/assistant/byok-engine.ts');
  const meta = loadAnacOperatorIndexMeta();
  let calls = 0;
  const answer = await executeByokChat(
    { provider: 'openai', model: 'gpt-4.1-mini', apiKey: 'test-only-operator-key' },
    [{ role: 'user', content: 'Quali imprese hanno più aggiudicazioni nello snapshot ANAC?' }],
    { signal: new AbortController().signal, fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls++;
      if (calls === 1) {
        assert.ok(body.instructions.includes('anac_operatori'));
        return Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'query_dvns', arguments: JSON.stringify({ queries: [{ dataset: 'anac_operatori', measure: 'awardCount', limit: 3 }], clarification: '' }) }] });
      }
      const content = body.input.at(-1).content;
      const evidence = JSON.parse(content.slice(content.indexOf('\n') + 1))[0];
      assert.equal(evidence.data.observedAt, meta.observedAt);
      assert.equal(evidence.data.rows.length, 3);
      assert.equal(evidence.data.provenance.sourceSpecSha256, meta.sourceSpecSha256);
      assert.equal(evidence.data.monetaryNature, 'award-declared');
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Lo snapshot riporta aggiudicazioni dichiarate, non incassi.' }] }] });
    } },
  );
  assert.equal(calls, 2);
  assert.equal(answer.evidence[0].dataset, 'anac_operatori');
  assert.equal(answer.evidence[0].sources.length, 3);
});

test('chat detail projection declares omitted CIG and fits one query within the evidence budget', async () => {
  const { projectChatEvidence } = await import('../src/lib/assistant/evidence-projection.ts');
  const { AI_MAX_EVIDENCE_CHARS } = await import('../src/lib/assistant/byok-contracts.ts');
  const ref = loadAnacOperatorNationalSummaries().topOperatorsByAwardCount[0].ref;
  const detail = await query({ code: ref, limit: 10 });
  const projected = projectChatEvidence({ dataset: 'anac_operatori', code: ref }, detail);
  assert.equal(projected.rows[0].awards.length, 3);
  assert.equal(projected.rows[0].awardsReturned, 3);
  assert.equal(projected.rows[0].awardsOmittedFromPublished, detail.rows[0].awardsPublished - 3);
  assert.equal(projected.rows[0].attributedValue, detail.rows[0].attributedValue);
  assert.deepEqual(projected.provenance, detail.provenance);
  for (const award of projected.rows[0].awards) {
    award.procedure = { matched: true, oggetto: 'x'.repeat(2000), cpvCode: 'x'.repeat(40), cpvLabel: 'x'.repeat(500), contractingAuthority: 'x'.repeat(600), cigYear: 2025 };
  }
  assert.ok(JSON.stringify(projected).length < AI_MAX_EVIDENCE_CHARS);
});
