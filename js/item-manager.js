// ============================================================================
// Item Management
// ============================================================================

const ItemManager = {
  async load() {
    try {
      await Database.init();
      const data = await Database.load(CONFIG.STORAGE.KEY);

      if (data) {
        try {
          const items = JSON.parse(data);
          if (!Array.isArray(items)) {
            throw new Error('Invalid data format: not an array');
          }
          state.items = Security.sanitizeItems(items);
        } catch (parseError) {
          console.error('Data parsing error:', parseError);
          // Corrupted data - start fresh
          state.items = [];
          UI.setStatus('data corrupted - starting fresh', false);
        }
      } else {
        state.items = [];
      }

      await this.save(true);
    } catch (error) {
      console.error('Load error:', error);
      state.items = [];
      UI.setStatus('load failed', false);
    }

    UI.render();
  },

  async save(silent = false) {
    // Cancel any pending save
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    // Prevent concurrent saves
    if (this.saveInProgress) {
      this.pendingSave = true;
      return;
    }

    this.saveInProgress = true;

    if (!silent) {
      UI.setStatus('saving...', false);
    }

    try {
      const data = JSON.stringify(state.items);

      // Validate data size (IndexedDB can handle large data, but be reasonable)
      if (data.length > CONFIG.LIMITS.MAX_FILE_SIZE) {
        throw new Error('Data too large to save');
      }

      await Database.save(CONFIG.STORAGE.KEY, data);

      if (!silent) {
        UI.setStatus('saved', true);
      }
    } catch (error) {
      console.error('Save error:', error);
      UI.setStatus('save failed', false);

      // Retry once after a delay
      if (!this.saveRetried) {
        this.saveRetried = true;
        setTimeout(() => {
          this.saveRetried = false;
          this.save(silent);
        }, 2000);
      }
    } finally {
      this.saveInProgress = false;

      // If there was a pending save request, execute it now
      if (this.pendingSave) {
        this.pendingSave = false;
        this.save(silent);
      }
    }
  },

  scheduleSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save(false);
    }, 500);
  },

  add(itemData) {
    const newItem = Security.sanitizeItem(itemData);
    if (!newItem) {
      UI.setStatus('invalid item data', false);
      return false;
    }

    // Check for duplicates by unique identifier
    const isDuplicate = state.items.some(existingItem => {
      // For OMDb items: check by imdbID
      if (newItem.imdbID && existingItem.imdbID) {
        return newItem.imdbID === existingItem.imdbID;
      }
      // For YouTube videos: check by youtubeID
      if (newItem.youtubeID && existingItem.youtubeID) {
        return newItem.youtubeID === existingItem.youtubeID;
      }
      // No unique identifier to check
      return false;
    });

    if (isDuplicate) {
      UI.setStatus('duplicate item', false);
      setTimeout(() => UI.setStatus('saved', true), 2000);
      return false;
    }

    state.items.unshift(newItem);
    this.scheduleSave();
    return true;
  },

  update(id, updates) {
    const item = state.items.find(i => i.id === id);
    if (!item) return false;

    const previousItem = { ...item };
    const sanitized = Security.sanitizeItem({ ...item, ...updates });
    if (!sanitized) {
      UI.setStatus('invalid item data', false);
      return false;
    }

    Object.assign(item, sanitized);
    this.scheduleSave();

    UndoManager.push('Item updated', {
      type: 'edit',
      data: { id, previousItem }
    });

    return true;
  },

  toggle(id) {
    const item = state.items.find(i => i.id === id);
    if (item) {
      const previousWatched = item.watched;
      item.watched = !item.watched;
      this.scheduleSave();
      UI.render();

      const message = item.watched ? 'Marked as watched' : 'Marked as unwatched';
      UndoManager.push(message, {
        type: 'toggle',
        data: { id, previousWatched }
      });
    }
  },

  delete(id) {
    const index = state.items.findIndex(i => i.id === id);
    if (index === -1) return;

    const item = { ...state.items[index] };
    state.items = state.items.filter(i => i.id !== id);
    this.scheduleSave();
    UI.render();

    UndoManager.push('Item deleted', {
      type: 'delete',
      data: { item, index }
    });
  },

  getFiltered() {
    const { items, filter } = state;

    if (filter === 'watched') {
      return items.filter(i => i.watched);
    }

    if (filter === 'all') {
      return items.filter(i => !i.watched);
    }

    if (filter === 'movie' || filter === 'series' || filter === 'youtube') {
      return items.filter(i => i.type === filter && !i.watched);
    }

    if (CONFIG.PRIORITIES.includes(filter)) {
      return items.filter(i => i.priority === filter && !i.watched);
    }

    // Check if it's a platform or tag filter
    // This will match any platform or tag that exists
    return items.filter(i =>
      !i.watched && (i.platform === filter || i.tag === filter)
    );
  },

  export() {
    const unwatchedItems = state.items.filter(i => !i.watched);
    const watchedItems = state.items.filter(i => i.watched);

    const data = {
      unwatched: unwatchedItems,
      watched: watchedItems,
      exportDate: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watchlist-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    UI.setStatus('exported', true);
    setTimeout(() => UI.setStatus('saved', true), 2000);
  },

  import(fileData) {
    try {
      // Validate data size
      if (!fileData || fileData.length === 0) {
        throw new Error('Empty file');
      }

      if (fileData.length > CONFIG.LIMITS.MAX_FILE_SIZE) {
        throw new Error('File too large');
      }

      // Parse JSON
      let data;
      try {
        data = JSON.parse(fileData);
      } catch (parseError) {
        throw new Error('Invalid JSON format');
      }

      // Extract items
      let importedItems = [];
      if (data.unwatched || data.watched) {
        // Validate arrays
        if (data.unwatched && !Array.isArray(data.unwatched)) {
          throw new Error('Invalid unwatched format');
        }
        if (data.watched && !Array.isArray(data.watched)) {
          throw new Error('Invalid watched format');
        }
        importedItems = [...(data.unwatched || []), ...(data.watched || [])];
      } else if (Array.isArray(data)) {
        importedItems = data;
      } else {
        throw new Error('Invalid file format - expected array or object with unwatched/watched');
      }

      // Validate item count
      if (importedItems.length === 0) {
        throw new Error('No items found in file');
      }

      if (importedItems.length > 10000) {
        throw new Error('Too many items (max 10,000)');
      }

      // Sanitize items
      const sanitized = Security.sanitizeItems(importedItems);
      if (sanitized.length === 0) {
        throw new Error('No valid items found - all items failed validation');
      }

      // Merge with existing items, avoiding duplicates
      let addedCount = 0;
      let skippedCount = 0;
      const addedIds = new Set();

      sanitized.forEach(newItem => {
        // Check for duplicates by unique identifier
        const isDuplicate = state.items.some(existingItem => {
          // For OMDb items: check by imdbID
          if (newItem.imdbID && existingItem.imdbID) {
            return newItem.imdbID === existingItem.imdbID;
          }
          // For YouTube videos: check by youtubeID
          if (newItem.youtubeID && existingItem.youtubeID) {
            return newItem.youtubeID === existingItem.youtubeID;
          }
          return false;
        });

        // Also check for duplicates within the imported batch
        const batchDuplicate = addedIds.has(newItem.imdbID || newItem.youtubeID || newItem.title);

        if (!isDuplicate && !batchDuplicate) {
          // Ensure unique ID for new items
          newItem.id = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          state.items.unshift(newItem);
          addedCount++;

          // Track added items to prevent duplicates in the same import
          if (newItem.imdbID) addedIds.add(newItem.imdbID);
          if (newItem.youtubeID) addedIds.add(newItem.youtubeID);
        } else {
          skippedCount++;
        }
      });

      this.save(false);
      UI.render();

      if (addedCount > 0) {
        const message = `Added ${addedCount} item${addedCount === 1 ? '' : 's'}${skippedCount > 0 ? `, skipped ${skippedCount} duplicate${skippedCount === 1 ? '' : 's'}` : ''}`;
        UI.setStatus(message, true);
      } else {
        UI.setStatus('No new items added (all duplicates)', false);
      }

      setTimeout(() => UI.setStatus('saved', true), 3000);
      return true;
    } catch (error) {
      console.error('Import error:', error);
      const errorMsg = error.message || 'Invalid data';
      UI.setStatus(`Import failed: ${errorMsg}`, false);
      setTimeout(() => UI.setStatus('saved', true), 3000);
      return false;
    }
  }
};
