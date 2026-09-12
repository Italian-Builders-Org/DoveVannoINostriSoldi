import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const binaries = process.env.DVNS_POSTGRES_BIN;

test('Postgres quota: real transactions, concurrency, privileges and retention', { skip: !binaries, timeout: 120000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dvns-pgqa-'));
  const data = path.join(directory, 'data');
  const binary = (name) => path.join(binaries, name);
  let started = false;
  t.after(async () => {
    if (started) await run(binary('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']);
    await rm(directory, { recursive: true, force: true });
  });
  await run(binary('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8']);
  await run(binary('pg_ctl'), ['-D', data, '-l', path.join(directory, 'server.log'), '-o', `-F -k ${directory} -h ''`, '-w', 'start']);
  started = true;
  const sql = async (statement) => (await run(binary('psql'), ['-h', directory, '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', statement], { maxBuffer: 1024 * 1024 })).stdout.trim();
  await sql('create role anon; create role authenticated; create role service_role bypassrls;');
  const migration = await readFile(new URL('../../supabase/migrations/20260912124653_assistant_free_quota.sql', import.meta.url), 'utf8');
  await sql(migration);
  const day = await sql("select (clock_timestamp() at time zone 'Europe/Rome')::date");
  const hash = (n) => n.toString(16).padStart(64, '0');
  const lease = (n) => n.toString(16).padStart(32, '0');
  const parameters = (browser, network, token = 1, scope = 'local') => `'${scope}','${day}','${hash(browser)}','${hash(network)}','${lease(token)}'`;
  const quota = (browser, network, reserve = true, token = 1, scope = 'local') => sql(`set role service_role; select to_json(public.assistant_quota(${parameters(browser, network, token, scope)},${reserve}));`).then(output => JSON.parse(output.split('\n').at(-1)));
  const release = (browser, network, token = 1) => sql(`set role service_role; select public.assistant_quota_release(${parameters(browser, network, token)});`);

  await t.test('ten questions and independent browser/network limits', async () => {
    assert.deepEqual(await quota(1, 1, false), [1, 0]);
    for (let i = 0; i < 10; i++) {
      assert.deepEqual(await quota(1, 1), [1, i + 1]);
      await release(1, 1);
    }
    assert.deepEqual(await quota(1, 1), [0, 10]);
    assert.deepEqual(await quota(2, 1), [0, 10]);
    assert.deepEqual(await quota(1, 2), [0, 10]);
    assert.deepEqual(await quota(2, 2), [1, 1]);
    await release(2, 2);
    assert.deepEqual(await quota(1, 1, false, 1, 'preview'), [1, 0]);
  });
  await t.test('twenty simultaneous callers admit exactly one', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => quota(10, 10, true, i + 10)));
    assert.equal(results.filter(([code]) => code === 1).length, 1);
    assert.equal(results.filter(([code]) => code === -1).length, 19);
    assert.ok(results.every(([, used]) => used === 1));
    await release(10, 10, 999);
    assert.deepEqual(await quota(10, 10), [-1, 1]);
    await sql("update assistant_private.quota set lease_until = clock_timestamp() - interval '1 second' where subject = '" + hash(10) + "'");
    assert.deepEqual(await quota(10, 10, true, 500), [1, 2]);
    await release(10, 10, 10);
    assert.deepEqual(await quota(10, 10), [-1, 2]);
    await release(10, 10, 500);
    assert.deepEqual(await quota(10, 10), [1, 3]);
    await release(10, 10);
  });
  await t.test('shared browser on different networks still serializes; no deadlock', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => quota(20, 20 + i)));
    assert.equal(results.filter(([code]) => code === 1).length, 1);
    assert.equal(results.filter(([code]) => code === -1).length, 7);
  });
  await t.test('burst cap is bounded and blocks new browser rows', async () => {
    for (let i = 0; i < 60; i++) assert.deepEqual(await quota(100 + i, 100, false), [1, 0]);
    const count = await sql('select count(*) from assistant_private.quota');
    assert.deepEqual(await quota(999, 100, false), [-2, 0]);
    assert.equal(await sql('select count(*) from assistant_private.quota'), count);
    await sql("update assistant_private.quota set burst_until = clock_timestamp() - interval '1 second' where kind = 'network' and subject = '" + hash(100) + "'");
    assert.deepEqual(await quota(999, 100, false), [1, 0]);
  });
  await t.test('public roles cannot call RPCs or read counters, including with guessed identifiers', async () => {
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(sql(`set role ${role}; select public.assistant_quota(${parameters(1, 1)},true);`), /permission denied/);
      await assert.rejects(sql(`set role ${role}; select public.assistant_quota_release(${parameters(1, 1)});`), /permission denied/);
      await assert.rejects(sql(`set role ${role}; select * from assistant_private.quota;`), /permission denied/);
    }
    assert.equal(await sql("select relrowsecurity from pg_class where oid = 'assistant_private.quota'::regclass"), 't');
    assert.equal(await sql("select count(*) from pg_proc where proname in ('assistant_quota','assistant_quota_release') and prosecdef"), '0');
  });
  await t.test('invalid days and identifiers fail without changing state; transactions roll back together', async () => {
    const count = await sql('select count(*) from assistant_private.quota');
    await assert.rejects(sql(`select public.assistant_quota('local', '${day}'::date + 1, '${hash(300)}', '${hash(300)}', '${lease(300)}', true)`), /Invalid quota request/);
    await assert.rejects(sql(`select public.assistant_quota('local', '${day}', 'not-a-hash', '${hash(300)}', '${lease(300)}', true)`), /Invalid quota request/);
    assert.equal(await sql('select count(*) from assistant_private.quota'), count);
    await sql(`begin; set role service_role; select public.assistant_quota(${parameters(300, 300)}, true); rollback;`);
    assert.deepEqual(await quota(300, 300, false), [1, 0]);
  });
  await t.test('expiry reflects Rome midnight and cleanup removes only expired rows', async () => {
    assert.equal(await sql("select count(*) from assistant_private.quota where expires_at <> ((quota_day + 1)::timestamp at time zone 'Europe/Rome') + interval '2 minutes'"), '0');
    await sql("insert into assistant_private.quota(scope, quota_day, kind, subject, expires_at) values ('local', current_date - 2, 'browser', '" + hash(900) + "', clock_timestamp() - interval '1 second')");
    assert.equal(await sql('select assistant_private.expire_quota()'), '1');
    assert.equal(await sql('select assistant_private.expire_quota()'), '0');
    assert.deepEqual(await quota(1, 1, false), [1, 10]);
  });
});
