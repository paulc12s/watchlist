// ============================================================================
// Database Operations
// ============================================================================

const Database = {
  async init() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB not supported in this browser'));
        return;
      }

      const request = indexedDB.open(CONFIG.STORAGE.DB_NAME, CONFIG.STORAGE.DB_VERSION);

      request.onerror = () => {
        console.error('Database init error:', request.error);
        reject(request.error);
      };

      request.onblocked = () => {
        console.warn('Database upgrade blocked. Close other tabs with this app.');
      };

      request.onsuccess = () => {
        state.db = request.result;

        // Handle connection errors
        state.db.onerror = (event) => {
          console.error('Database error:', event.target.error);
        };

        // Handle unexpected close
        state.db.onversionchange = () => {
          state.db.close();
          console.warn('Database version changed. Please reload the page.');
        };

        resolve(state.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(CONFIG.STORAGE.STORE_NAME)) {
          db.createObjectStore(CONFIG.STORAGE.STORE_NAME);
        }
      };
    });
  },

  async save(key, value) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      try {
        const transaction = state.db.transaction([CONFIG.STORAGE.STORE_NAME], 'readwrite');

        transaction.onerror = () => {
          console.error('Transaction error:', transaction.error);
          reject(transaction.error);
        };

        transaction.onabort = () => {
          console.error('Transaction aborted');
          reject(new Error('Transaction aborted'));
        };

        const store = transaction.objectStore(CONFIG.STORAGE.STORE_NAME);
        const request = store.put(value, key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (error) {
        console.error('Save error:', error);
        reject(error);
      }
    });
  },

  async load(key) {
    if (!state.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      try {
        const transaction = state.db.transaction([CONFIG.STORAGE.STORE_NAME], 'readonly');

        transaction.onerror = () => {
          console.error('Transaction error:', transaction.error);
          reject(transaction.error);
        };

        const store = transaction.objectStore(CONFIG.STORAGE.STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (error) {
        console.error('Load error:', error);
        reject(error);
      }
    });
  }
};
