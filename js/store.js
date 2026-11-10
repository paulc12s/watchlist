// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Store: a small key-value store in IndexedDB (the app's one database, see
// CONFIG.STORAGE). Saves are batched, so a burst of changes writes once, and
// flush() writes anything pending before the page is hidden.
//
// Keeping your data safe:
// - A save that fails is kept and retried, sooner then later, reopening the
//   database first (Safari can drop the connection of a page left in the
//   background). Until a save succeeds, onProblem reports it, and the page
//   shows a banner that stays (js/save-banner.js).
// - One tab saves at a time. Each save writes a whole list, so two tabs of
//   the same page would overwrite each other's changes. The tab opened last
//   saves; older tabs stop saving and say so. They find out at once (the
//   storage event) or, if suspended, before their next save. That check is
//   only a prompt warning. What makes it certain is the revision kept beside
//   each value that was loaded: a save reads it in the same transaction and
//   only writes if it's the one this tab last read or wrote, so a tab holding
//   an older copy can never overwrite a newer one, with or without localStorage.
// - block() stops all saving for the visit, e.g. when the titles couldn't be
//   loaded, so a near-empty list can never overwrite what's stored.
// ============================================================================

const Store = {
  db: null,
  database: null,
  storeName: '',
  timers: new Map(),
  writers: new Map(),
  attempts: new Map(),
  // Counts changes per key, so a retry never overwrites a newer change
  changes: new Map(),
  // Saves under way, by key: one at a time per key, and flush() waits for them
  inFlight: new Map(),
  // The revision of each loaded key, as this tab last read or wrote it, and
  // the one a failed save was writing (it may have been stored all the same)
  revisions: new Map(),
  attempted: new Map(),
  writes: 0,
  reopening: null,
  // Why nothing can be saved this visit ('' while saving works)
  blocked: '',
  tabId: Math.random().toString(36).slice(2),
  // Waits between retries of a failed save, then the last one repeats
  RETRY_DELAYS_MS: [2000, 5000, 15000, 30000, 60000],
  // A database that never answers (WebKit has done this) counts as a failure
  OPEN_TIMEOUT_MS: 10000,
  // The app hooks these to show problems
  onError(error) { console.error('Save failed:', error); },
  // A message for a banner that stays until the problem is gone, or null
  onProblem() {},

  // { name, storeName, version } of the page's database (see CONFIG.STORAGE)
  async open(database) {
    this.database = database;
    this.storeName = database.storeName;
    this.claimWriting();
    this.db = await this.connect();
  },

  connect() {
    const { name, storeName, version = 1 } = this.database;
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB not supported in this browser'));
        return;
      }
      let gaveUp = false;
      const timer = setTimeout(() => {
        gaveUp = true;
        reject(new Error('The database did not open'));
      }, this.OPEN_TIMEOUT_MS);
      const request = indexedDB.open(name, version);
      request.onerror = () => {
        clearTimeout(timer);
        reject(request.error);
      };
      request.onblocked = () => console.warn('Database upgrade blocked. Close other tabs with this app.');
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        const db = request.result;
        // Answered after all, too late to be used
        if (gaveUp) return db.close();
        // A newer version of the app wants the database: step aside
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  },

  // A fresh connection after a failure; a failed reopen is left to the next
  // retry. Saves that fail together share one reopen
  reopen() {
    if (!this.reopening) {
      this.reopening = (async () => {
        try {
          if (this.db) this.db.close();
        } catch (error) {
          // Already closed
        }
        try {
          this.db = await this.connect();
        } catch (error) {
          console.error('Could not reopen the database:', error);
        }
        this.reopening = null;
      })();
    }
    return this.reopening;
  },

  // One transaction. action returns its request, or a list of them; resolves
  // to the result, or the list of results, once everything is stored
  run(mode, action) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], mode);
      const requests = action(transaction.objectStore(this.storeName));
      transaction.oncomplete = () => resolve(Array.isArray(requests) ? requests.map(request => request.result) : requests.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
    });
  },

  // A value, and its revision with it, so a later save knows what it replaces
  async load(key) {
    const [value, revision] = await this.run('readonly', store => [store.get(key), store.get(this.revisionKey(key))]);
    this.revisions.set(key, typeof revision === 'string' ? revision : '');
    return value;
  },

  // Every record whose key starts with prefix, as [[key, value]]. For data
  // kept as one small record each (saved with scheduleSave under its own key)
  async loadAll(prefix) {
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    const [keys, values] = await this.run('readonly', store => [store.getAllKeys(range), store.getAll(range)]);
    return keys.map((key, at) => [key, values[at]]);
  },

  // Writes and removes several records at once: all of them, or none. Not
  // retried: resolves to whether it worked, for tidying that can wait
  async batch({ put = [], remove = [] }) {
    if (this.blocked || !this.isWriting() || !(put.length || remove.length)) return false;
    try {
      await this.run('readwrite', store => [...put.map(([key, value]) => store.put(value, key)), ...remove.map(key => store.delete(key))]);
      return true;
    } catch (error) {
      console.error('Could not store a batch:', error);
      return false;
    }
  },

  // write() is called when the save happens, so it stores the latest state
  scheduleSave(key, write, delay = CONFIG.STORAGE.SAVE_DELAY_MS) {
    this.changes.set(key, (this.changes.get(key) || 0) + 1);
    this.queue(key, write, delay);
  },

  queue(key, write, delay) {
    if (this.blocked) return;
    this.writers.set(key, write);
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.save(key), delay));
  },

  async save(key) {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    // One save per key at a time: this one follows the save under way
    if (this.inFlight.has(key)) {
      await this.inFlight.get(key);
      return this.save(key);
    }
    const write = this.writers.get(key);
    if (!write || this.blocked) return;
    if (!this.isWriting()) return this.displaced();
    this.writers.delete(key);
    const saving = this.attempt(key, write, this.changes.get(key));
    this.inFlight.set(key, saving);
    await saving;
    if (this.inFlight.get(key) === saving) this.inFlight.delete(key);
  },

  // Never rejects: a failure is reported and the save queued again
  async attempt(key, write, change) {
    // A newer change (saved or waiting) supersedes this one: it reports for itself
    const superseded = () => this.changes.get(key) !== change;
    try {
      if (this.reopening) await this.reopening;
      if (!await this.put(key, write)) return this.displaced();
      this.attempts.delete(key);
      if (!this.attempts.size && !this.blocked) this.onProblem(null);
    } catch (error) {
      if (superseded()) console.error('A save failed; a newer one replaces it:', error);
      else this.onError(error);
      await this.reopen();
      if (superseded() || this.blocked) return;
      this.onProblem('Your latest changes aren’t saved yet. Retrying… Export a backup to be safe.');
      const attempt = (this.attempts.get(key) || 0) + 1;
      this.attempts.set(key, attempt);
      const delays = this.RETRY_DELAYS_MS;
      this.queue(key, write, delays[Math.min(attempt, delays.length) - 1]);
    }
  },

  revisionKey(key) {
    return `rev:${key}`;
  },

  // Stores write()'s value. A key that was loaded is only replaced if what's
  // stored is still the copy this tab last read or wrote; resolves to false,
  // storing nothing, if something else has written it since. The check and the
  // write are one transaction, so nothing can come between them
  put(key, write) {
    const known = this.revisions.get(key);
    if (known === undefined) return this.run('readwrite', store => store.put(write(), key)).then(() => true);
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const revisionKey = this.revisionKey(key);
      const next = `${this.tabId}:${++this.writes}`;
      let conflict = false;
      const check = store.get(revisionKey);
      check.onsuccess = () => {
        const stored = typeof check.result === 'string' ? check.result : '';
        // A save that reported failure may have been stored after all
        if (stored !== known && stored !== this.attempted.get(key)) {
          conflict = true;
          transaction.abort();
          return;
        }
        this.attempted.set(key, next);
        store.put(write(), key);
        store.put(next, revisionKey);
      };
      transaction.oncomplete = () => {
        this.revisions.set(key, next);
        this.attempted.delete(key);
        resolve(true);
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => (conflict ? resolve(false) : reject(transaction.error || new Error('Transaction aborted')));
    });
  },

  // Write anything waiting, e.g. before the page is hidden or reloaded, and
  // wait for saves already under way
  flush() {
    const keys = new Set([...this.writers.keys(), ...this.inFlight.keys()]);
    return Promise.all([...keys].map(key => this.save(key)));
  },

  // Stops all saving for this visit and says why
  block(message) {
    this.blocked = message;
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
    this.writers.clear();
    this.onProblem(message);
  },

  // ---- One saving tab ----------------------------------------------------------

  writerKey() {
    return `writer:${this.database.name}`;
  },

  // This tab is the newest, so it saves from now on
  claimWriting() {
    try {
      localStorage.setItem(this.writerKey(), this.tabId);
    } catch (error) {
      return; // No localStorage (private browsing): no tab check
    }
    if (typeof addEventListener === 'function') {
      addEventListener('storage', event => {
        if (event.key === this.writerKey() && event.newValue && event.newValue !== this.tabId) this.displaced();
      });
    }
  },

  isWriting() {
    try {
      const writer = localStorage.getItem(this.writerKey());
      return !writer || writer === this.tabId;
    } catch (error) {
      return true;
    }
  },

  displaced() {
    if (this.blocked) return;
    this.block('This page is open in another tab or window, which now saves your changes. Changes made here won’t be saved. Reload to use this one instead.');
  }
};
