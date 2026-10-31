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
          UI.setStatus('saved', true); // What's shown is what's stored
        } catch (parseError) {
          console.error('Data parsing error:', parseError);
          // Corrupted data - start fresh
          state.items = [];
          UI.setStatus('data corrupted - starting fresh', false);
        }
      } else {
        state.items = [];
        UI.setStatus('saved', true);
      }
      // No save here: rewriting storage on every launch would let an
      // out-of-date copy of the app clobber data written by a newer one
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

  // Write any pending change now; used when the app is backgrounded or closed,
  // where iOS may suspend the page before the debounced save fires
  flush() {
    if (!this.saveTimer) return Promise.resolve();
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    return this.save(true);
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

  add(fields) {
    const newItem = ItemModel.create(fields);
    if (!newItem) {
      UI.setStatus('invalid item data', false);
      return false;
    }

    if (ItemModel.isDuplicate(newItem, ItemModel.keySet(state.items))) {
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
    if (sanitized && ItemModel.reviewChanged(item, sanitized)) {
      sanitized.reviewDate = new Date().toISOString();
    }
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

  // The 👍 / 👎 buttons on each card. Watched and rated are the same thing:
  // a thumb marks the title watched, and tapping the thumb it already shows
  // puts it back on the list to watch, unrated.
  rate(id, thumb) {
    const item = state.items.find(i => i.id === id);
    if (!item || (thumb !== 'up' && thumb !== 'down')) return;
    const previous = { watched: item.watched, thumb: item.thumb, reviewDate: item.reviewDate };

    const current = Exchange.thumbFor(item);
    let message;
    if (item.watched && current === thumb) {
      item.watched = false;
      item.thumb = '';
      message = 'Back on the list to watch';
    } else {
      // A new thumb dates the review; one it already had keeps its date
      if (current !== thumb || !item.reviewDate) item.reviewDate = new Date().toISOString();
      item.thumb = thumb;
      item.watched = true;
      message = thumb === 'up' ? 'Watched: 👍' : 'Watched: 👎';
    }
    this.scheduleSave();
    UI.render();
    UndoManager.push(message, { type: 'rate', data: { id, ...previous } });
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
    const { items, filter, list, quickSearch } = state;
    const query = quickSearch.toLowerCase();

    const matchesSearch = (i) => !query || i.title.toLowerCase().includes(query);

    const matchesSecondaryFilter = (i) => {
      if (filter === 'all') return true;
      if (filter === 'rewatch') return i.rewatch;
      if (filter === 'movie' || filter === 'series' || filter === 'youtube') return i.type === filter;
      if (CONFIG.PRIORITIES.includes(filter)) return ItemModel.displayPriority(i) === filter;
      return i.platform === filter || i.tag === filter;
    };

    const inList = {
      queue: i => !i.watched,
      watched: i => i.watched,
      // Every title with that thumb, watched or still on the list
      up: i => Exchange.thumbFor(i) === 'up',
      down: i => Exchange.thumbFor(i) === 'down'
    }[list] || (i => !i.watched);

    return items.filter(i => inList(i) && matchesSecondaryFilter(i) && matchesSearch(i));
  },

  // What Export writes. Watched titles always carry a thumb (thumbs up unless
  // rated otherwise), so the ratings page gets a verdict for each
  exportText() {
    const items = state.items.map(i => (i.watched ? { ...i, thumb: Exchange.thumbFor(i) } : i));
    return JSON.stringify({
      unwatched: items.filter(i => !i.watched),
      watched: items.filter(i => i.watched),
      exportDate: new Date().toISOString()
    }, null, 2);
  },

  export() {
    const blob = new Blob([this.exportText()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watchlist-${Exchange.fileStamp()}.json`;
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
      if (Exchange.isRatingsBackup(data)) {
        // A ratings backup ("Export ratings"): converted the same way as the
        // ratings page's "Export for Watchlist"
        importedItems = Exchange.watchlistItems(data.ratings);
        if (importedItems.length === 0) {
          throw new Error('This ratings backup has no rated or want-to-watch titles');
        }
      } else if (data.unwatched || data.watched) {
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
        throw new Error('Not a watchlist export or ratings backup');
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

      // Merge with existing items: titles already in the list (or earlier in
      // the file) are folded in field by field rather than added twice
      const byKey = new Map();
      state.items.forEach(item => {
        const key = ItemModel.key(item);
        if (key) byKey.set(key, item);
      });
      let addedCount = 0;
      let updatedCount = 0;
      let unchangedCount = 0;

      sanitized.forEach(newItem => {
        const key = ItemModel.key(newItem);
        const existing = key && byKey.get(key);
        if (existing) {
          if (ItemModel.mergeInto(existing, newItem)) updatedCount++;
          else unchangedCount++;
          return;
        }

        if (key) byKey.set(key, newItem);
        // Fresh ID so imported items can't collide with existing ones
        newItem.id = ItemModel.newId();
        state.items.unshift(newItem);
        addedCount++;
      });

      this.save(false);
      UI.hideImportError();
      UI.render();

      const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
      if (addedCount > 0 || updatedCount > 0) {
        const parts = [
          addedCount > 0 && `added ${plural(addedCount, 'item')}`,
          updatedCount > 0 && `updated ${updatedCount}`,
          unchangedCount > 0 && `${unchangedCount} already up to date`
        ].filter(Boolean);
        UI.setStatus(parts.join(', ').replace(/^./, c => c.toUpperCase()), true);
      } else {
        UI.setStatus('Nothing new to import (all up to date)', false);
      }

      setTimeout(() => UI.setStatus('saved', true), 3000);
      return true;
    } catch (error) {
      console.error('Import error:', error);
      // Stays on screen until dismissed, so a failed import can't go unnoticed
      UI.showImportError(`Import failed: ${error.message || 'Invalid data'}`);
      return false;
    }
  }
};
