import assert from 'node:assert/strict';
import test from 'node:test';
import './helpers/register-ts-alias.mjs';
const { executeByokChat } = await import('../src/lib/assistant/byok-engine.ts');
const { FREE_MODEL, FREE_FALLBACK_MODEL } = await import('../src/lib/assistant/free-contracts.ts');
const connection = { provider: 'regolo', model: FREE_MODEL, apiKey: 'test-only-fallback-key' };
const messages = [{ role: 'user', content: 'Quali dati avete?' }];
const plan = () => Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'query_dvns', arguments: JSON.stringify({ queries: [], clarification: 'Quale anno?' }) } }] } }] });

for (const status of [500, 503, 404, "incomplete"]) {
  test(`Regolo recovers ${status} once with the same signal, credential and token cap`, async () => {
    const signal = new AbortController().signal;
    const calls = [];
    const result = await executeByokChat(connection, messages, { signal, regoloFallback: true, fetcher: async (url, init) => {
      assert.equal(url, 'https://api.regolo.ai/v1/chat/completions');
      assert.equal(init.signal, signal);
      assert.equal(init.headers.Authorization, `Bearer ${connection.apiKey}`);
      calls.push(JSON.parse(init.body));
      if (calls.length > 1) return plan();
      return status === "incomplete"
        ? Response.json({ choices: [{ finish_reason: 'length', message: { content: '' } }] })
        : new Response(null, { status });
    } });
    assert.deepEqual(calls.map(call => call.model), [FREE_MODEL, FREE_FALLBACK_MODEL]);
    assert.equal(calls[0].max_tokens, calls[1].max_tokens);
    assert.ok(calls.every(call => call.disable_fallbacks === true));
    assert.deepEqual(calls[0].messages, calls[1].messages);
    assert.equal(result.model, FREE_FALLBACK_MODEL);
    assert.equal(result.text, 'Quale anno?');
  });
}

for (const status of [401, 402, 403, 429]) {
  test(`Regolo does not retry definitive HTTP ${status}`, async () => {
    let calls = 0;
    await assert.rejects(executeByokChat(connection, messages, { signal: new AbortController().signal, regoloFallback: true, fetcher: async () => { calls++; return new Response(null, { status }); } }));
    assert.equal(calls, 1);
  });
}

test('failed fallback stops after two attempts; personal mode does not retry', async () => {
  for (const regoloFallback of [true, false]) {
    let calls = 0;
    await assert.rejects(executeByokChat(connection, messages, { signal: new AbortController().signal, regoloFallback, fetcher: async () => { calls++; throw new TypeError('network failure'); } }));
    assert.equal(calls, regoloFallback ? 2 : 1);
  }
});

test('abort never starts a fallback', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(executeByokChat(connection, messages, { signal: controller.signal, regoloFallback: true, fetcher: async () => { calls++; controller.abort(); throw new TypeError('cancelled'); } }));
  assert.equal(calls, 1);
});

test('partial answer is not replaced with another model', async () => {
  let calls = 0;
  const chunks = [];
  const file = { kind: 'text', name: 'note.txt', mime: 'text/plain', text: 'Dati di prova', note: '' };
  await assert.rejects(executeByokChat(connection, [{ role: 'user', content: 'Leggi', attachments: [file] }], {
    signal: new AbortController().signal, regoloFallback: true, onDelta: text => chunks.push(text),
    fetcher: async () => {
      calls++;
      if (calls === 1) return plan();
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Risposta parziale '.repeat(10) }, finish_reason: null }] })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    },
  }));
  assert.equal(calls, 2);
  assert.ok(chunks.join('').length > 0);
});

test('fallback is shared across planning and answering, not renewed per call', async () => {
  const models = [];
  const file = { kind: 'text', name: 'note.txt', mime: 'text/plain', text: 'Dati di prova', note: '' };
  await assert.rejects(executeByokChat(connection, [{ role: 'user', content: 'Leggi', attachments: [file] }], {
    signal: new AbortController().signal, regoloFallback: true,
    fetcher: async (_url, init) => {
      models.push(JSON.parse(init.body).model);
      return models.length === 2 ? plan() : new Response(null, { status: 503 });
    },
  }));
  assert.deepEqual(models, [FREE_MODEL, FREE_FALLBACK_MODEL, FREE_FALLBACK_MODEL]);
});

test('answering can recover after successful GLM planning', async () => {
  const models = [];
  const file = { kind: 'text', name: 'note.txt', mime: 'text/plain', text: 'Dati di prova', note: '' };
  const result = await executeByokChat(connection, [{ role: 'user', content: 'Leggi', attachments: [file] }], {
    signal: new AbortController().signal, regoloFallback: true,
    fetcher: async (_url, init) => {
      models.push(JSON.parse(init.body).model);
      if (models.length === 1) return plan();
      if (models.length === 2) return new Response(null, { status: 503 });
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Dati di prova.' } }] });
    },
  });
  assert.deepEqual(models, [FREE_MODEL, FREE_MODEL, FREE_FALLBACK_MODEL]);
  assert.equal(result.model, FREE_FALLBACK_MODEL);
  assert.equal(result.text, 'Dati di prova.');
});
