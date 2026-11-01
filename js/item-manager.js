// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Item Management: the watchlist's actions on your titles
// Storage, changes, imports and exports all go through the shared Library
// (js/library.js); this adds what the watchlist page needs on top: status
// messages, undo, and which titles each list shows.
//
// The watchlist shows titles that are on your list to watch (want) or that
// you've seen (a thumb). Titles only the ratings page cares about, such as
// skips, are kept but not shown.
// ============================================================================

const ItemManager = {
  async load(database = CONFIG.STORAGE.WATCHLIST) {
    Store.onSaving = () => UI.setStatus('saving...', false);
    Store.onSaved = () => UI.setStatus('saved', true);
    Store.onError = error => {
      console.error('Save error:', error);
      UI.setStatus('save failed', false);
    };

    try {
      await Library.open(database);
      // What's shown is what's stored. No save here: rewriting storage on every
      // launch would let an out-of-date copy of the app clobber newer data
      UI.setStatus('saved', true);
    } catch (error) {
      console.error('Load error:', error);
      Library.loadFailed();
      UI.setStatus('load failed', false);
    }

    UI.render();
  },

  // Adds to the list to watch, unless fields say otherwise (e.g. already seen: { verdict, want: false })
  add(fields) {
    const { title, duplicate } = Library.add({ want: true, ...fields });
    if (duplicate) {
      UI.setStatus('duplicate item', false);
      setTimeout(() => UI.setStatus('saved', true), 2000);
      return false;
    }
    if (!title) {
      UI.setStatus('invalid item data', false);
      return false;
    }
    return true;
  },

  update(id, updates) {
    const item = Library.get(id);
    if (!item) return false;
    const previous = { ...item };
    if (!Library.change(item, updates)) {
      UI.setStatus('invalid item data', false);
      return false;
    }
    UndoManager.push('Item updated', { type: 'edit', data: { id, previous } });
    return true;
  },

  // The 👍 / 👎 buttons on each card. Watched and rated are the same thing:
  // a thumb marks the title watched, and tapping the thumb a watched title
  // already shows puts it back on the list to watch, unrated.
  rate(id, thumb) {
    const item = Library.get(id);
    if (!item || (thumb !== 'up' && thumb !== 'down')) return;
    const previous = { ...item };
    const unrate = !item.want && Title.thumb(item) === thumb;
    Library.change(item, unrate ? { verdict: '', want: true } : { verdict: thumb, want: false });
    UI.render();
    UndoManager.push(unrate ? 'Back on the list to watch' : `Watched: ${thumb === 'up' ? '👍' : '👎'}`,
      { type: 'edit', data: { id, previous } });
  },

  // The ❤️ button: loved means watched, 👍 and five stars. Tapping it again
  // takes the stars away and leaves the 👍.
  love(id) {
    const item = Library.get(id);
    if (!item) return;
    const previous = { ...item };
    const unlove = Title.isLoved(item);
    Library.change(item, unlove ? { stars: 0 } : { verdict: 'up', want: false, stars: Title.LOVED_STARS });
    UI.render();
    UndoManager.push(unlove ? 'Watched: 👍' : 'Watched: ❤️', { type: 'edit', data: { id, previous } });
  },

  delete(id) {
    const item = Library.get(id);
    if (!item) return;
    const index = Library.remove(item);
    UI.render();
    UndoManager.push('Item deleted', { type: 'delete', data: { item, index } });
  },

  // Which list a title belongs to on this page
  LISTS: {
    queue: t => t.want,
    watched: t => !t.want && Title.isSeen(t),
    // Every title with that thumb, watched or still on the list
    up: t => Title.thumb(t) === 'up',
    down: t => Title.thumb(t) === 'down',
    loved: t => Title.isLoved(t),
    // Everything you've rated, watched or still on the list
    rated: t => Title.isSeen(t)
  },

  // Orders for every list but the queue (which groups by priority)
  SORTS: {
    recent: ['Recently rated', (a, b) => (b.reviewDate || b.updatedDate || '').localeCompare(a.reviewDate || a.updatedDate || '')],
    rating: ['Your rating', (a, b) => ItemManager.yourRating(b) - ItemManager.yourRating(a)],
    title: ['Title A–Z', (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true })],
    newest: ['Year, newest', (a, b) => (b.year || 0) - (a.year || 0)],
    oldest: ['Year, oldest', (a, b) => (a.year || 9999) - (b.year || 9999)],
    imdb: ['IMDb rating', (a, b) => (b.imdbRating || 0) - (a.imdbRating || 0)]
  },

  // Your verdict as one number for sorting: ❤️ (5★) 5, 4★ 4, 👍 3.5, 3★ 3,
  // 2★ 2, 👎 1.5, 1★ 1; a rewatch flag nudges up
  yourRating(t) {
    const thumb = Title.thumb(t);
    if (!thumb) return 0;
    const base = t.stars || (thumb === 'up' ? 3.5 : 1.5);
    return base + (t.rewatch ? 0.25 : 0);
  },

  // A list in the chosen order; ties stay most recently rated first
  sorted(titles, sort = state.sort) {
    const [, compare] = this.SORTS[sort] || this.SORTS.recent;
    const recent = this.SORTS.recent[1];
    return [...titles].sort((a, b) => compare(a, b) || recent(a, b));
  },

  getFiltered() {
    const { filter, list, quickSearch } = state;
    const query = quickSearch.toLowerCase();
    const inList = this.LISTS[list] || this.LISTS.queue;

    const matchesSearch = (i) => !query || i.title.toLowerCase().includes(query);
    // Rated narrows further by your verdict: ❤️, 👍 (includes ❤️) or 👎
    const byVerdict = list === 'rated' && ['loved', 'up', 'down'].includes(state.verdict) ? this.LISTS[state.verdict] : null;
    const matchesVerdict = (i) => !byVerdict || byVerdict(i);

    const matchesSecondaryFilter = (i) => {
      if (filter === 'all') return true;
      if (filter === 'rewatch') return i.rewatch;
      if (filter === 'movie' || filter === 'series' || filter === 'youtube') return i.type === filter;
      if (CONFIG.PRIORITIES.includes(filter)) return Title.displayPriority(i) === filter;
      return i.platform === filter || i.tag === filter;
    };

    return Library.all().filter(i => inList(i) && matchesVerdict(i) && matchesSecondaryFilter(i) && matchesSearch(i));
  },

  // Titles this page shows in any list
  shown() {
    return Library.all().filter(t => t.want || Title.isSeen(t));
  },

  export() {
    const blob = new Blob([Library.exportText('watchlist')], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = Library.fileName('watchlist');
    a.click();
    URL.revokeObjectURL(url);

    UI.setStatus('exported', true);
    setTimeout(() => UI.setStatus('saved', true), 2000);
  },

  import(fileData) {
    try {
      if (!fileData || fileData.length === 0) {
        throw new Error('Empty file');
      }
      if (fileData.length > CONFIG.LIMITS.MAX_FILE_SIZE) {
        throw new Error('File too large');
      }

      let data;
      try {
        data = JSON.parse(fileData);
      } catch (parseError) {
        throw new Error('Invalid JSON format');
      }

      const { added, updated, unchanged } = Library.import(data);
      UI.hideImportError();
      UI.render();

      const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
      if (added > 0 || updated > 0) {
        const parts = [
          added > 0 && `added ${plural(added, 'item')}`,
          updated > 0 && `updated ${updated}`,
          unchanged > 0 && `${unchanged} already up to date`
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
