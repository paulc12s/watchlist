// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// A stand-in for IndexedDB, close enough to test js/store.js against: one
// object store per database, transactions that run one after another in the
// order they were made, hold what they write until they commit (all of it or
// none), can be aborted, and take time. Tests can make commits fail, make
// them fail after storing, and make opening hang.
//
//   const idb = fakeIndexedDB({ commitMs: 5 });
//   context: { indexedDB: idb.indexedDB, IDBKeyRange: idb.IDBKeyRange }
//   idb.data (Map), idb.failNext, idb.failAfterStoring, idb.hang, idb.opens, idb.connections
'use strict';

function fakeIndexedDB({ commitMs = 0 } = {}) {
  const state = {
    data: new Map(), failNext: 0, failAfterStoring: 0, hang: false, opens: 0, connections: new Set(), commits: 0,
    IDBKeyRange: { bound: (lower, upper) => ({ lower, upper }) }
  };
  // Transactions take turns: each starts when the one before it has finished
  let turn = Promise.resolve();
  const later = (fn, ms = 0) => setTimeout(fn, ms);
  const inRange = range => key => !range || (key >= range.lower && key <= range.upper);

  function transaction(db) {
    if (db.closed) throw new Error('InvalidStateError: the database connection is closing');
    const tx = { error: null };
    const staged = new Map(); // key -> { value } or { deleted: true }
    const queue = [];
    let finished = false;
    let done;
    const mine = turn;
    turn = new Promise(resolve => { done = resolve; });

    const read = key => (staged.has(key) ? staged.get(key).value : state.data.get(key));
    const keys = range => [...new Set([...state.data.keys(), ...staged.keys()])]
      .filter(key => !(staged.get(key) || {}).deleted).filter(inRange(range)).sort();
    const request = work => {
      const r = {};
      queue.push(() => {
        r.result = work();
        if (r.onsuccess) r.onsuccess();
      });
      return r;
    };
    const finish = (event, error) => {
      if (finished) return;
      finished = true;
      tx.error = error || null;
      if (error && tx.onerror) tx.onerror();
      if (tx[event]) tx[event]();
      done();
    };
    const step = () => {
      if (finished) return;
      if (queue.length) {
        queue.shift()();
        return later(step);
      }
      later(() => {
        if (finished) return;
        const fails = staged.size && state.failNext > 0;
        const storesThenFails = staged.size && !fails && state.failAfterStoring > 0;
        if (fails) state.failNext--;
        if (storesThenFails) state.failAfterStoring--;
        if (!fails) {
          for (const [key, entry] of staged) entry.deleted ? state.data.delete(key) : state.data.set(key, entry.value);
          if (staged.size) state.commits++;
        }
        if (fails || storesThenFails) finish('onabort', new Error('Connection to Indexed Database server lost'));
        else finish('oncomplete');
      }, commitMs);
    };

    tx.abort = () => finish('onabort');
    tx.objectStore = () => ({
      get: key => request(() => read(key)),
      getAll: range => request(() => keys(range).map(read)),
      getAllKeys: range => request(() => keys(range)),
      put: (value, key) => {
        // Copied when put is called, as structured cloning does
        const copy = JSON.parse(JSON.stringify(value));
        return request(() => { staged.set(key, { value: copy }); return key; });
      },
      delete: key => request(() => { staged.set(key, { deleted: true }); })
    });
    mine.then(() => later(step));
    return tx;
  }

  state.indexedDB = {
    open() {
      const request = {};
      state.opens++;
      if (state.hang) return request;
      later(() => {
        const db = {
          closed: false,
          objectStoreNames: { contains: () => true },
          close() { db.closed = true; state.connections.delete(db); },
          transaction: () => transaction(db)
        };
        state.connections.add(db);
        request.result = db;
        request.onsuccess();
      });
      return request;
    }
  };
  return state;
}

module.exports = { fakeIndexedDB };
