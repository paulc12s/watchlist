// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Store: a small key-value store in IndexedDB, shared by every page
// Each page opens its own database, so the pages never touch each other's
// data. Saves are batched, so a burst of changes writes once, and flush()
// writes anything pending before the page is hidden.
// ============================================================================

const Store = {
  db: null,
  storeName: '',
  timers: new Map(),
  writers: new Map(),
  // Pages hook these to show what's happening
  onSaving() {},
  onSaved() {},
  onError(error) { console.error('Save failed:', error); },

  // { name, storeName, version } of the page's database (see CONFIG.STORAGE)
  open({ name, storeName, version = 1 }) {
    this.storeName = storeName;
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
        this.db = request.result;
        // A newer version of the app wants the database: step aside
        this.db.onversionchange = () => this.db.close();
        resolve();
      };
    });
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
  scheduleSave(key, write, delay = CONFIG.STORAGE.SAVE_DELAY_MS, retried = false) {
    this.writers.set(key, write);
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.save(key, retried), delay));
  },

  async save(key, retried = false) {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    const write = this.writers.get(key);
    if (!write) return;
    this.writers.delete(key);
    this.onSaving();
    try {
      await this.run('readwrite', store => store.put(write(), key));
      if (!this.writers.size) this.onSaved();
    } catch (error) {
      this.onError(error);
      // Try once more shortly, unless a newer change has already been queued
      if (!retried && !this.writers.has(key)) this.scheduleSave(key, write, CONFIG.STORAGE.RETRY_DELAY_MS, true);
    }
  },

  // Write anything waiting, e.g. before the page is hidden or reloaded
  flush() {
    return Promise.all([...this.writers.keys()].map(key => this.save(key)));
  }
};
