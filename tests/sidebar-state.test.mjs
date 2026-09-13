import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { SIDEBAR_INIT_SCRIPT, getSidebarState, readStoredSidebarState, setSidebarState } from '../src/lib/sidebar.ts';

test('sidebar prepaint restores pinning and falls back when storage is denied', () => {
  for (const saved of ['pinned', 'rail', 'invalid', null]) {
    const document = { documentElement: { dataset: {} } };
    vm.runInNewContext(SIDEBAR_INIT_SCRIPT, { document, localStorage: { getItem: () => saved } });
    assert.equal(document.documentElement.dataset.sidebar, saved === 'pinned' ? 'pinned' : 'rail');
  }
  const document = { documentElement: { dataset: {} } };
  vm.runInNewContext(SIDEBAR_INIT_SCRIPT, { document, localStorage: { getItem() { throw new Error('denied'); } } });
  assert.equal(document.documentElement.dataset.sidebar, 'rail');
});

test('sidebar retains the painted and session choices when storage becomes unavailable', (t) => {
  for (const key of ['document', 'localStorage']) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    });
  }
  globalThis.document = { documentElement: { dataset: { sidebar: 'pinned' } } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  } });
  assert.equal(readStoredSidebarState(), 'pinned');
  setSidebarState('rail');
  assert.equal(getSidebarState(), 'rail');
  assert.equal(readStoredSidebarState(), 'rail');
  setSidebarState('pinned');
  assert.equal(getSidebarState(), 'pinned');
  assert.equal(readStoredSidebarState(), 'pinned');
});
