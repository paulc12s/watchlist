// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Titles from the old pages
// The separate Watchlist and Ratings pages are retired (their addresses now
// open this page), but each kept its titles in its own database on this
// device. Settings → "Bring in titles from the old pages" merges them in by
// the usual import rules (js/library.js): nothing is removed, and the newer
// version of each title wins. The old databases are only read, never changed.
// ============================================================================

const OldPages = {
  SOURCES: [CONFIG.STORAGE.WATCHLIST, CONFIG.STORAGE.RATINGS],

  // The titles one old page stored, as an array of records in any version's
  // shape, or [] if it never stored any. Opening a database that doesn't
  // exist would create it, so that's caught and called off.
  read({ name, storeName, legacyKey }) {
    return new Promise(resolve => {
      if (typeof indexedDB === 'undefined') return resolve([]);
      let created = false;
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => {
        created = true;
        request.transaction.abort();
      };
      request.onerror = () => resolve([]);
      request.onsuccess = () => {
        const db = request.result;
        if (created || !db.objectStoreNames.contains(storeName)) {
          db.close();
          return resolve([]);
        }
        const store = db.transaction([storeName], 'readonly').objectStore(storeName);
        const current = store.get(CONFIG.STORAGE.TITLES_KEY);
        const legacy = legacyKey ? store.get(legacyKey) : null;
        store.transaction.oncomplete = () => {
          db.close();
          let records = current.result !== undefined ? current.result : legacy && legacy.result;
          try {
            if (typeof records === 'string') records = JSON.parse(records);
          } catch (error) {
            records = [];
          }
          resolve(Array.isArray(records) ? records : []);
        };
        store.transaction.onerror = () => resolve([]);
      };
    });
  },

  // How many titles the old pages hold between them
  async count() {
    const lists = await Promise.all(this.SOURCES.map(source => this.read(source)));
    return lists.reduce((total, list) => total + list.length, 0);
  },

  // Merges both pages' titles in; returns { added, updated, unchanged }
  async bringIn() {
    const total = { added: 0, updated: 0, unchanged: 0 };
    for (const source of this.SOURCES) {
      const records = await this.read(source);
      if (!records.length) continue;
      const result = Library.import(records);
      for (const key of Object.keys(total)) total[key] += result[key];
    }
    return total;
  }
};
