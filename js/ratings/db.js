// ============================================================================
// Storage
// A small key-value store in its own IndexedDB database (RatingsDB), separate
// from the watchlist's. Saves are batched so a burst of swipes writes once.
// ============================================================================

const RatingsDB = {
  db: null,
  timers: new Map(),
  writers: new Map(),

  open() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB not supported in this browser'));
        return;
      }
      const { DB_NAME, DB_VERSION, STORE_NAME } = RATINGS.STORAGE;
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => this.db.close();
        resolve();
      };
    });
  },

  run(mode, action) {
    return new Promise((resolve, reject) => {
      const { STORE_NAME } = RATINGS.STORAGE;
      const transaction = this.db.transaction([STORE_NAME], mode);
      const request = action(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
    });
  },

  load(key) {
    return this.run('readonly', store => store.get(key));
  },

  // write() is called when the save happens, so it stores the latest state
  scheduleSave(key, write) {
    this.writers.set(key, write);
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.save(key), RATINGS.SAVE_DELAY_MS));
  },

  async save(key) {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    const write = this.writers.get(key);
    if (!write) return;
    this.writers.delete(key);
    try {
      await this.run('readwrite', store => store.put(write(), key));
    } catch (error) {
      console.error('Save failed:', error);
      RatingsUI.toast('Could not save. Export a backup to be safe.');
    }
  },

  // Write anything waiting, e.g. before the page is hidden or reloaded
  flush() {
    return Promise.all([...this.writers.keys()].map(key => this.save(key)));
  }
};
