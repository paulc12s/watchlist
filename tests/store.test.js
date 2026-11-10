// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Tests for js/store.js on a stand-in IndexedDB (tests/fixtures/fake-indexeddb.js):
// failed saves are kept and retried on a fresh connection, problems are
// reported until a save works, only one tab saves, and a tab holding an older
// copy can never overwrite a newer one. Run with: node --test tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read } = require('./helpers');
const { fakeIndexedDB } = require('./fixtures/fake-indexeddb');

function sharedLocalStorage() {
  const items = new Map();
  return { getItem: k => (items.has(k) ? items.get(k) : null), setItem: (k, v) => items.set(k, String(v)) };
}

// Private browsing: every use throws
const NO_LOCAL_STORAGE = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

function loadStore(idb, localStorage) {
  const quiet = { ...console, error() {}, warn() {} };
  const context = vm.createContext({
    console: quiet, setTimeout, clearTimeout, indexedDB: idb.indexedDB, IDBKeyRange: idb.IDBKeyRange, localStorage
  });
  vm.runInContext(`${read('js/config.js')}\n${read('js/store.js')}\nthis.app = { Store, CONFIG };`, context);
  const { Store } = context.app;
  Store.RETRY_DELAYS_MS = [5, 5];
  Store.problems = [];
  Store.errors = 0;
  Store.onProblem = message => Store.problems.push(message);
  Store.onError = () => { Store.errors++; };
  return Store;
}

const DB = { name: 'TestDB', storeName: 'kv' };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Waits for something to become true rather than for a fixed time, so a slow
// machine makes a test slower, not wrong
async function until(condition, what) {
  for (let waited = 0; waited < 2000; waited += 2) {
    if (condition()) return;
    await wait(2);
  }
  assert.fail(`timed out waiting for ${what}`);
}

// Nothing waiting, nothing under way, no retry queued
const settled = Store => until(() => !Store.writers.size && !Store.inFlight.size && !Store.timers.size, 'saves to settle');

async function open(idb, localStorage = sharedLocalStorage()) {
  const Store = loadStore(idb, localStorage);
  await Store.open(DB);
  return Store;
}

test('a failed save is kept, retried on a fresh connection, and the problem clears once it works', async () => {
  const idb = fakeIndexedDB();
  const Store = await open(idb);
  idb.failNext = 2;
  Store.scheduleSave('titles', () => ['A'], 0);
  await until(() => idb.data.has('titles'), 'the save');
  await settled(Store);
  assert.deepEqual(idb.data.get('titles'), ['A'], 'saved in the end');
  assert.equal(idb.opens, 3, 'reopened after each failure');
  assert.equal(idb.connections.size, 1, 'and the old connections closed');
  assert.match(Store.problems[0], /aren’t saved yet/);
  assert.equal(Store.problems.at(-1), null, 'banner cleared');
});

test('a newer change replaces a failed one rather than being overwritten by its retry', async () => {
  const idb = fakeIndexedDB({ commitMs: 5 });
  const Store = await open(idb);
  idb.failNext = 1;
  Store.scheduleSave('titles', () => ['old'], 0);
  await until(() => Store.inFlight.size, 'the first save to start');
  Store.scheduleSave('titles', () => ['new'], 0);
  await until(() => idb.data.has('titles'), 'the save');
  await settled(Store);
  assert.deepEqual(idb.data.get('titles'), ['new']);
  assert.equal(Store.errors, 0, 'the replaced save’s failure isn’t reported: nothing was lost');
  assert.equal(idb.commits, 1, 'and it was never written');
});

test('a change made while the database is reopening is saved once it has, on one connection', async () => {
  const idb = fakeIndexedDB();
  const Store = await open(idb);
  idb.failNext = 1;
  // The change arrives just as the reopen starts, with the old connection closed
  const reopen = Store.reopen.bind(Store);
  let reopens = 0;
  Store.reopen = () => {
    const reopening = reopen();
    if (!reopens++) Store.scheduleSave('titles', () => ['new'], 0);
    return reopening;
  };
  Store.scheduleSave('titles', () => ['old'], 0);
  await until(() => idb.data.has('titles'), 'the save');
  await settled(Store);
  assert.deepEqual(idb.data.get('titles'), ['new']);
  assert.equal(idb.opens, 2, 'one reopen, shared');
  assert.equal(idb.connections.size, 1);
  assert.equal(Store.problems.at(-1) || null, null);
});

test('flush writes what’s waiting and waits for a save already under way', async () => {
  const idb = fakeIndexedDB({ commitMs: 20 });
  const Store = await open(idb);
  Store.scheduleSave('titles', () => ['v1'], 0);
  Store.scheduleSave('prefs', () => ({ order: 'ranked' }), 5000);
  await until(() => Store.inFlight.has('titles'), 'the first save to start');
  assert.equal(idb.data.has('titles'), false, 'under way, not stored yet');
  await Store.flush();
  assert.deepEqual(idb.data.get('titles'), ['v1'], 'stored by the time flush returns');
  assert.deepEqual(idb.data.get('prefs'), { order: 'ranked' }, 'along with what was only waiting');

  // And a change made while a save of the same key is under way follows it
  let list = ['v2'];
  Store.scheduleSave('titles', () => list, 0);
  await until(() => Store.inFlight.has('titles'), 'the second save to start');
  list = ['v3'];
  Store.scheduleSave('titles', () => list, 5000);
  await Store.flush();
  assert.deepEqual(idb.data.get('titles'), ['v3']);
});

test('only the newest tab saves; the older one stops and says so', async () => {
  const idb = fakeIndexedDB();
  const storage = sharedLocalStorage();
  const older = await open(idb, storage);
  const newer = await open(idb, storage);

  newer.scheduleSave('titles', () => ['from the newer tab'], 0);
  await newer.flush();
  older.scheduleSave('titles', () => ['stale list'], 0);
  await older.flush();
  assert.deepEqual(idb.data.get('titles'), ['from the newer tab']);
  assert.match(older.blocked, /open in another tab/);
  assert.match(older.problems.at(-1), /open in another tab/);
  assert.equal(newer.blocked, '');
});

test('a tab holding an older copy can’t overwrite a newer one, even with no localStorage to warn it', async () => {
  const idb = fakeIndexedDB();
  idb.data.set('titles', ['base']);
  const first = await open(idb, NO_LOCAL_STORAGE);
  const second = await open(idb, NO_LOCAL_STORAGE);
  const [inFirst, inSecond] = [await first.load('titles'), await second.load('titles')];

  first.scheduleSave('titles', () => [...inFirst, 'first tab’s edit'], 0);
  await first.flush();
  second.scheduleSave('titles', () => [...inSecond, 'second tab’s edit'], 0);
  await second.flush();
  assert.deepEqual(idb.data.get('titles'), ['base', 'first tab’s edit'], 'the stale write stored nothing');
  assert.match(second.blocked, /open in another tab/);
  assert.match(second.problems.at(-1), /open in another tab/);

  // The tab that is up to date carries on
  first.scheduleSave('titles', () => ['base', 'first tab’s edit', 'and another'], 0);
  await first.flush();
  assert.deepEqual(idb.data.get('titles'), ['base', 'first tab’s edit', 'and another']);
  assert.equal(first.blocked, '');
});

test('a save that was stored but reported as failed is retried, not mistaken for another tab’s', async () => {
  const idb = fakeIndexedDB();
  const Store = await open(idb);
  await Store.load('titles');
  idb.failAfterStoring = 1;
  Store.scheduleSave('titles', () => ['A'], 0);
  await until(() => Store.problems.at(-1) === null, 'the retry to work');
  await settled(Store);
  assert.deepEqual(idb.data.get('titles'), ['A']);
  assert.equal(Store.blocked, '');
  assert.equal(idb.commits, 2);
});

test('a value saved before this version, with no revision beside it, loads and saves', async () => {
  const idb = fakeIndexedDB();
  idb.data.set('titles', ['from an older version']);
  const Store = await open(idb);
  assert.deepEqual(await Store.load('titles'), ['from an older version']);
  Store.scheduleSave('titles', () => ['changed'], 0);
  await Store.flush();
  assert.deepEqual(idb.data.get('titles'), ['changed']);
  assert.equal(typeof idb.data.get('rev:titles'), 'string', 'and has a revision from now on');
});

test('block() drops pending saves and refuses new ones', async () => {
  const idb = fakeIndexedDB();
  const Store = await open(idb);
  Store.scheduleSave('titles', () => ['pending'], 10);
  Store.block('Could not load');
  Store.scheduleSave('titles', () => ['later'], 0);
  await Store.flush();
  await wait(20);
  assert.equal(idb.data.has('titles'), false);
  assert.equal(Store.problems.at(-1), 'Could not load');
  assert.equal(await Store.batch({ put: [['info:a', 1]] }), false, 'batches too');
});

test('a save finishing after the tab was stopped doesn’t take the banner down', async () => {
  const idb = fakeIndexedDB({ commitMs: 10 });
  const Store = await open(idb);
  Store.scheduleSave('titles', () => ['A'], 0);
  await until(() => Store.inFlight.size, 'the save to start');
  Store.block('Stopped');
  await until(() => !Store.inFlight.size, 'the save to finish');
  assert.equal(Store.problems.at(-1), 'Stopped');
});

test('a database that never answers is a failure, not an endless wait', async () => {
  const idb = fakeIndexedDB();
  idb.hang = true;
  const Store = loadStore(idb, sharedLocalStorage());
  Store.OPEN_TIMEOUT_MS = 10;
  await assert.rejects(Store.open(DB), /did not open/);
});

test('small records: each saved under its own key, read back by prefix, moved and removed together', async () => {
  const idb = fakeIndexedDB();
  const Store = await open(idb);
  Store.scheduleSave('info:tt0000002', () => ({ title: 'Two' }), 0);
  Store.scheduleSave('info:tt0000001', () => ({ title: 'One' }), 0);
  Store.scheduleSave('infinity', () => 'another key entirely', 0);
  await Store.flush();
  // (Copied: values made in the page's context aren't deepEqual to local ones)
  assert.deepEqual(JSON.parse(JSON.stringify(await Store.loadAll('info:'))), [['info:tt0000001', { title: 'One' }], ['info:tt0000002', { title: 'Two' }]]);
  assert.equal(idb.data.has('rev:info:tt0000001'), false, 'no revision kept for a key that was never loaded on its own');

  assert.equal(await Store.batch({ put: [['info:tt0000003', { title: 'Three' }]], remove: ['info:tt0000001', 'infinity'] }), true);
  assert.deepEqual((await Store.loadAll('info:')).map(([key]) => key), ['info:tt0000002', 'info:tt0000003']);
  assert.equal(idb.data.has('infinity'), false);

  idb.failNext = 1;
  assert.equal(await Store.batch({ put: [['info:tt0000004', {}]], remove: ['info:tt0000002'] }), false, 'a failed batch stores none of it');
  assert.deepEqual((await Store.loadAll('info:')).map(([key]) => key), ['info:tt0000002', 'info:tt0000003']);
});
