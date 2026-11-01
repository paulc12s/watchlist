// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Store: a small key-value store in IndexedDB, shared by every page
// Each page opens its own database, so the pages never touch each other's
// data. Saves are batched, so a burst of changes writes once, and flush()
// writes anything pending before the page is hidden.
//
// Keeping your data safe:
// - A save that fails is kept and retried, sooner then later, reopening the
//   database first (Safari can drop the connection of a page left in the
//   background). Until a save succeeds, onProblem reports it, and the page
//   shows a banner that stays (js/save-banner.js).
// - One tab saves at a time. Each save writes a whole list, so two tabs of
//   the same page would overwrite each other's changes. The tab opened last
//   saves; older tabs stop saving and say so. They find out at once (the
//   storage event) or, if suspended, before their next save.
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
  // Why nothing can be saved this visit ('' while saving works)
  blocked: '',
  tabId: Math.random().toString(36).slice(2),
  // Waits between retries of a failed save, then the last one repeats
  RETRY_DELAYS_MS: [2000, 5000, 15000, 30000, 60000],
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
      const request = indexedDB.open(name, version);
      request.onerror = () => reject(request.error);
      request.onblocked = () => console.warn('Database upgrade blocked. Close other tabs with this app.');
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // A newer version of the app wants the database: step aside
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  },

  // A fresh connection after a failure; a failed reopen is left to the next retry
  async reopen() {
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
  },

  run(mode, action) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], mode);
      const request = action(transaction.objectStore(this.storeName));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
    });
  },

  load(key) {
    return this.run('readonly', store => store.get(key));
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
    const write = this.writers.get(key);
    if (!write || this.blocked) return;
    if (!this.isWriting()) return this.displaced();
    this.writers.delete(key);
    const change = this.changes.get(key);
    try {
      await this.run('readwrite', store => store.put(write(), key));
      this.attempts.delete(key);
      if (!this.attempts.size) this.onProblem(null);
    } catch (error) {
      this.onError(error);
      await this.reopen();
      // A newer change (saved or waiting) supersedes this one: it reports for itself
      if (this.changes.get(key) !== change) return;
      this.onProblem('Your latest changes aren’t saved yet. Retrying… Export a backup to be safe.');
      const attempt = (this.attempts.get(key) || 0) + 1;
      this.attempts.set(key, attempt);
      const delays = this.RETRY_DELAYS_MS;
      this.queue(key, write, delays[Math.min(attempt, delays.length) - 1]);
    }
  },

  // Write anything waiting, e.g. before the page is hidden or reloaded
  flush() {
    return Promise.all([...this.writers.keys()].map(key => this.save(key)));
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
