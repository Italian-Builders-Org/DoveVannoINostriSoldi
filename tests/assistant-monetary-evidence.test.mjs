import assert from 'node:assert/strict';
import test from 'node:test';
import './helpers/register-ts-alias.mjs';
const { centsToEuroEvidence } = await import('../src/lib/assistant/monetary-evidence.ts');
const { projectChatEvidence } = await import('../src/lib/assistant/evidence-projection.ts');
const { queryPublicDataset } = await import('../src/lib/mcp/datasets.ts');
const { AI_MAX_EVIDENCE_CHARS } = await import('../src/lib/assistant/byok-contracts.ts');
const { executeByokChat } = await import('../src/lib/assistant/byok-engine.ts');

test('monetary evidence preserves exact cents, sign and safe-integer boundaries', () => {
  for (const [cents, euros] of [[0, '0.00'], [-1, '-0.01'], [101, '1.01'], [14919584274769, '149195842747.69'], [Number.MAX_SAFE_INTEGER, '90071992547409.91']]) {
    assert.equal(centsToEuroEvidence(cents), euros);
  }
  for (const invalid of [null, undefined, '100', 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => centsToEuroEvidence(invalid), /Invalid monetary evidence/);
  }
});

test('SSN projects every accounting level and represents missing entity cells as null', async () => {
  for (const filters of [{}, { region: 'Lombardia' }, { code: '729242930477377001' }]) {
    const query = { dataset: 'openbdap_ssn_conto_economico', year: 2024, limit: 5, ...filters };
    const raw = await queryPublicDataset(query);
    const before = structuredClone(raw);
    const projected = projectChatEvidence(query, raw);
    assert.equal(projected.national.valuesEuros.productionCosts, '149195842747.69');
    assert.equal(projected.national.valuesEuros.personnelCost, '40378274916.49');
    assert.equal(projected.national.values, undefined);
    assert.equal(projected.selectedAggregate.level, raw.selectedAggregate.level);
    if (filters.region) assert.equal(projected.selectedAggregate.valuesEuros.productionCosts, '24755554751.00');
    if (filters.code) assert.equal(projected.selectedAggregate.valuesEuros, null);
    for (const key of ['coverage', 'provenance', 'pagination', 'observation', 'metrics']) assert.deepEqual(projected[key], raw[key]);
    for (const [index, region] of raw.regions.entries()) {
      for (const [metric, cents] of Object.entries(region.values)) {
        assert.equal(projected.regions[index].valuesEuros[metric], centsToEuroEvidence(cents));
      }
      assert.deepEqual(projected.regions[index].detailMissing, region.detailMissing);
    }
    for (const [index, entity] of raw.entities.entries()) {
      for (const [metric, cents] of Object.entries(entity.values)) {
        assert.equal(projected.entities[index].valuesEuros[metric], entity.missing[metric] ? null : centsToEuroEvidence(cents));
      }
      assert.deepEqual(projected.entities[index].missing, entity.missing);
    }
    assert.deepEqual(raw, before);
  }
});

test('COFOG euros, GDP percentages and reconciliation units match the official adapters', async () => {
  for (const query of [
    { dataset: 'istat_cofog', year: 2023, territory: 'IT', cofog: 'G070' },
    { dataset: 'eurostat_cofog', year: 2024, country: 'IT', cofog: 'GF07' },
  ]) {
    const raw = await queryPublicDataset(query);
    const before = structuredClone(raw);
    const projected = projectChatEvidence(query, raw);
    const row = projected.observations[0];
    assert.equal(row.amountEuros, query.dataset === 'istat_cofog' ? '131751000000.00' : '146075000000.00');
    assert.equal(row.amountCents, undefined);
    if (query.dataset === 'eurostat_cofog') {
      assert.equal(row.shareOfGdpPercent, '6.60');
      assert.equal(row.shareOfGdpHundredths, undefined);
      assert.deepEqual(projected.flags, raw.flags);
    } else assert.equal(projected.measure.unit, 'EUR');
    assert.equal(projected.reconciliation.toleranceEuros, centsToEuroEvidence(raw.reconciliation.toleranceCents));
    for (const key of ['source', 'period', 'caveats']) assert.deepEqual(projected[key], raw[key]);
    assert.deepEqual(raw, before);
  }
});

test('COFOG projection preserves provisional and break flags and observed zero', async () => {
  const query = { dataset: 'eurostat_cofog', year: 2024, country: 'IT', cofog: 'GF07' };
  const raw = await queryPublicDataset(query);
  raw.observations = [
    { geo: 'IT', year: 2024, function: 'GF07', amountCents: 0, shareOfGdpHundredths: 0, flag: 'p' },
    { geo: 'IT', year: 2023, function: 'GF07', amountCents: 101, shareOfGdpHundredths: 1, flag: 'b' },
  ];
  const rows = projectChatEvidence(query, raw).observations;
  assert.equal(rows[0].amountEuros, '0.00');
  assert.equal(rows[0].flag, 'p');
  assert.equal(rows[1].amountEuros, '1.01');
  assert.equal(rows[1].shareOfGdpPercent, '0.01');
  assert.equal(rows[1].flag, 'b');
});

test('national SSN history keeps years and provenance while converting the same metric contract', async () => {
  const { validateSsnNationalHistorySnapshot } = await import('../src/lib/ssn-national-history.ts');
  const raw = validateSsnNationalHistorySnapshot();
  const before = structuredClone(raw);
  const projected = projectChatEvidence({ dataset: 'openbdap_ssn_storico_nazionale' }, raw);
  assert.equal(projected.years.find(row => row.year === 2024).valuesEuros.personnelCost, '40378274916.49');
  assert.deepEqual(projected.years.map(row => row.year), raw.years.map(row => row.year));
  assert.deepEqual(projected.years.map(row => row.provenance), raw.years.map(row => row.provenance));
  assert.deepEqual(projected.source, raw.source);
  assert.equal(projected.dataMode, raw.dataMode);
  assert.deepEqual(raw, before);
});

test('a real SSN and COFOG comparison fits the evidence budget without removing accounting levels', async () => {
  const queries = [
    { dataset: 'openbdap_ssn_conto_economico', year: 2024, limit: 5 },
    { dataset: 'eurostat_cofog', year: 2024, country: 'IT', cofog: 'GF07' },
  ];
  let calls = 0;
  const answer = await executeByokChat(
    { provider: 'openai', model: 'test', apiKey: 'test-only-personal-key' },
    [{ role: 'user', content: 'Confronta i costi SSN e la spesa COFOG sanità nel 2024.' }],
    { signal: new AbortController().signal, fetcher: async (_url, init) => {
      calls++;
      if (calls === 1) return Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'query_dvns', arguments: JSON.stringify({ queries }) }] });
      const context = JSON.parse(init.body).input.at(-1).content;
      const evidence = context.slice(context.indexOf('\n') + 1);
      assert.ok(evidence.length <= AI_MAX_EVIDENCE_CHARS, evidence.length);
      const results = JSON.parse(evidence);
      assert.equal(results[0].data.regions.length, 21);
      assert.equal(results[0].data.national.valuesEuros.productionCosts, '149195842747.69');
      assert.equal(results[1].data.observations[0].amountEuros, '146075000000.00');
      assert.ok(results.every(result => result.source.sources.length > 0));
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Perimetri contabili distinti.' }] }] });
    } },
  );
  assert.equal(calls, 2);
  assert.equal(answer.evidence.length, 2);
});
