// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Tests for js/store.js on a stand-in IndexedDB: failed saves are kept and
// retried on a fresh connection, problems are reported until a save works,
// and only the newest tab saves. Run with: node --test tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read } = require('./helpers');

// A tiny IndexedDB: one store, saves that can be made to fail, and a count of opens
function fakeIndexedDB() {
  const state = { data: new Map(), failNext: 0, opens: 0 };
  state.indexedDB = {
    open() {
      const request = {};
      state.opens++;
      setTimeout(() => {
        const db = {
          closed: false,
          objectStoreNames: { contains: () => true },
          close() { db.closed = true; },
          transaction() {
            if (db.closed) throw new Error('The database connection is closing.');
            const tx = {};
            const finish = (fn) => setTimeout(fn, 0);
            tx.objectStore = () => ({
              put(value, key) {
                const r = {};
                finish(() => {
                  if (state.failNext > 0) {
                    state.failNext--;
                    tx.error = new Error('Connection to Indexed Database server lost');
                    tx.onerror();
                  } else {
                    state.data.set(key, JSON.parse(JSON.stringify(value)));
                    r.result = key;
                    tx.oncomplete();
                  }
                });
                return r;
              },
              get(key) {
                const r = {};
                finish(() => { r.result = state.data.get(key); tx.oncomplete(); });
                return r;
              }
            });
            return tx;
          }
        };
        request.result = db;
        request.onsuccess();
      }, 0);
      return request;
    }
  };
  return state;
}

function sharedLocalStorage() {
  const items = new Map();
  return { getItem: k => (items.has(k) ? items.get(k) : null), setItem: (k, v) => items.set(k, String(v)) };
}

function loadStore(idb, localStorage) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, indexedDB: idb.indexedDB, localStorage });
  vm.runInContext(`${read('js/config.js')}\n${read('js/store.js')}\nthis.app = { Store, CONFIG };`, context);
  const { Store } = context.app;
  Store.RETRY_DELAYS_MS = [5, 5];
  Store.problems = [];
  Store.onProblem = message => Store.problems.push(message);
  Store.onError = () => {};
  return Store;
}

const DB = { name: 'TestDB', storeName: 'kv' };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a failed save is kept, retried on a fresh connection, and the problem clears once it works', async () => {
  const idb = fakeIndexedDB();
  const Store = loadStore(idb, sharedLocalStorage());
  await Store.open(DB);
  idb.failNext = 2;
  Store.scheduleSave('titles', () => ['A'], 0);
  await wait(80);
  assert.deepEqual(idb.data.get('titles'), ['A'], 'saved in the end');
  assert.ok(idb.opens >= 3, 'reopened after each failure');
  assert.match(Store.problems[0], /aren’t saved yet/);
  assert.equal(Store.problems.at(-1), null, 'banner cleared');
});

test('a newer change replaces a failed one rather than being overwritten by its retry', async () => {
  const idb = fakeIndexedDB();
  const Store = loadStore(idb, sharedLocalStorage());
  await Store.open(DB);
  idb.failNext = 1;
  Store.scheduleSave('titles', () => ['old'], 0);
  await wait(2);
  Store.scheduleSave('titles', () => ['new'], 0);
  await wait(80);
  assert.deepEqual(idb.data.get('titles'), ['new']);
});

test('only the newest tab saves; the older one stops and says so', async () => {
  const idb = fakeIndexedDB();
  const storage = sharedLocalStorage();
  const older = loadStore(idb, storage);
  await older.open(DB);
  const newer = loadStore(idb, storage);
  await newer.open(DB);

  newer.scheduleSave('titles', () => ['from the newer tab'], 0);
  await wait(20);
  older.scheduleSave('titles', () => ['stale list'], 0);
  await wait(20);
  assert.deepEqual(idb.data.get('titles'), ['from the newer tab']);
  assert.match(older.blocked, /open in another tab/);
  assert.match(older.problems.at(-1), /open in another tab/);
  assert.equal(newer.blocked, '');
});

test('block() drops pending saves and refuses new ones', async () => {
  const idb = fakeIndexedDB();
  const Store = loadStore(idb, sharedLocalStorage());
  await Store.open(DB);
  Store.scheduleSave('titles', () => ['pending'], 10);
  Store.block('Could not load');
  Store.scheduleSave('titles', () => ['later'], 0);
  await Store.flush();
  await wait(30);
  assert.equal(idb.data.has('titles'), false);
  assert.equal(Store.problems.at(-1), 'Could not load');
});
