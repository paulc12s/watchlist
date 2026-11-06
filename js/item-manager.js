// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Item Management: the app's actions on your titles in Watchlist and Rated
// Changes go through the shared Library (js/library.js); this adds status
// messages, undo, which titles each list shows, sorting and filter chips.
// Imports and exports are in Settings (js/review/ui.js).
//
// The lists show titles on your list to watch (want) or seen (a thumb).
// Titles only review mode cares about, such as skips, are kept but not shown.
// ============================================================================

const ItemManager = {
  async load(database = CONFIG.STORAGE.APP) {
    Store.onError = error => {
      console.error('Save error:', error);
      UI.setStatus('save failed', false);
    };

    try {
      // What's shown is what's stored. No save here: rewriting storage on every
      // launch would let an out-of-date copy of the app clobber newer data
      await Library.open(database);
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
      return false;
    }
    if (!title) {
      UI.setStatus('invalid item data', false);
      return false;
    }
    return true;
  },

  update(id, updates, message = 'Item updated') {
    const item = Library.get(id);
    if (!item) return false;
    const previous = { ...item };
    if (!Library.change(item, updates)) {
      UI.setStatus('invalid item data', false);
      return false;
    }
    UndoManager.push(message, { type: 'edit', data: { id, previous } });
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
    // Rated's verdict filter: every title with that thumb, watched or still on the list
    up: t => Title.thumb(t) === 'up',
    down: t => Title.thumb(t) === 'down',
    loved: t => Title.isLoved(t),
    // Everything you've rated, watched or still on the list, dated or not
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

  // The titles a view shows: view is { list, filter, quickSearch, verdict };
  // the watchlist's is the global state, the Rated view keeps its own
  getFiltered(view = state) {
    const { filter, list, quickSearch } = view;
    const inList = this.LISTS[list] || this.LISTS.queue;

    const matchesSearch = quickSearch ? this.searchTest(quickSearch) : () => true;
    // Rated narrows further by your verdict: ❤️, 👍 (includes ❤️) or 👎
    const byVerdict = list === 'rated' && ['loved', 'up', 'down'].includes(view.verdict) ? this.LISTS[view.verdict] : null;
    const matchesVerdict = (i) => !byVerdict || byVerdict(i);

    const matchesSecondaryFilter = this.chipTest(filter) || (() => true);

    return Library.all().filter(i => inList(i) && matchesVerdict(i) && matchesSecondaryFilter(i) && matchesSearch(i));
  },

  // ---- Searching your titles ------------------------------------------------
  // What's typed in a list's search matches a title's words in order,
  // ignoring case, accents and punctuation ("spiderman" finds Spider-Man),
  // with a year or an IMDb link narrowing it. Only if none of your titles
  // match that way are typos forgiven (TitleSearch's matching), so a near
  // miss never crowds out the title you meant.
  searchTest(query) {
    const parsed = MovieAPI.parseQuery(query);
    if (parsed.imdbID) return t => t.imdbID === parsed.imdbID;
    const year = parsed.year ? Number(parsed.year) : null;
    const text = MovieAPI.normalizeTitle(parsed.title || query);
    if (!text) return t => t.title.toLowerCase().includes(query.toLowerCase());
    const squashed = text.replace(/ /g, '');
    const strict = t => {
      if (year && Number(t.year) !== year) return false;
      const name = MovieAPI.normalizeTitle(t.title);
      return name.includes(text) || name.replace(/ /g, '').includes(squashed);
    };
    if (typeof TitleSearch === 'undefined' || Library.all().some(strict)) return strict;
    const typed = text.split(' ');
    return t => (!year || Number(t.year) === year) &&
      TitleSearch.score(typed, { words: MovieAPI.normalizeTitle(t.title).split(' ').filter(Boolean) }) > 0;
  },

  // Your titles matching a search that a view doesn't show (another list,
  // or hidden by its tabs, verdicts or chips), most recently rated first.
  // A title you skipped in review stays out, unless it's on your list to watch
  elsewhere(query, shown) {
    const test = this.searchTest(query);
    const inView = new Set(shown);
    const skipped = t => t.verdict === 'skip' && !t.want;
    return this.sorted(Library.all().filter(t => !inView.has(t) && !skipped(t) && test(t)), 'recent').slice(0, 20);
  },

  // ---- Chips ---------------------------------------------------------------------
  // Tags and platforms are stored in one spelling each (Library.labelName);
  // a type, platform or tag with the same name (YouTube the type, YouTube
  // the platform) is one chip.

  TYPE_LABELS: { movie: 'Films', series: 'TV', youtube: 'YouTube' },

  // The filter a chip key stands for, or null for an unknown key
  chipTest(key) {
    if (key === 'all') return () => true;
    if (key === 'rewatch') return t => t.rewatch;
    if (key === 'recent') {
      const recent = new Set(this.recentlyAdded());
      return t => recent.has(t);
    }
    if (key.startsWith('priority:')) return t => Title.displayPriority(t) === key.slice(9);
    if (key.startsWith('label:')) {
      const name = key.slice(6);
      return t => this.labelKeys(t).includes(name);
    }
    return null;
  },

  // Every name a title's label chips go by: its type, platform and tags
  labelKeys(t) {
    return [this.TYPE_LABELS[t.type], t.platform, ...t.tags].map(value => Title.cleanLabel(value).toLowerCase()).filter(Boolean);
  },

  // Chips for a list of titles: [{ key, label, count }], each label once.
  // Label counts come from one pass over the titles, so more tags don't mean
  // another pass per chip
  chips(titles, { priorities = false } = {}) {
    const labelCounts = new Map();
    for (const t of titles) {
      for (const name of new Set(this.labelKeys(t))) labelCounts.set(name, (labelCounts.get(name) || 0) + 1);
    }
    const chips = [{ key: 'all', label: 'All', count: titles.length }];
    const seen = new Set(['all']);
    const add = (key, label) => {
      if (seen.has(key)) return;
      seen.add(key);
      const count = key.startsWith('label:') ? labelCounts.get(key.slice(6)) || 0 : titles.filter(this.chipTest(key)).length;
      if (count) chips.push({ key, label, count });
    };
    if (priorities) {
      add('recent', 'Recently added');
      for (const p of CONFIG.PRIORITIES) add(`priority:${p}`, p === 'watching' ? 'Watching now' : CONFIG.PRIORITY_LABELS[p]);
    }
    for (const label of Object.values(this.TYPE_LABELS)) add(`label:${label.toLowerCase()}`, label);
    add('rewatch', 'Rewatch');
    const byName = (a, b) => a[1].label.localeCompare(b[1].label, undefined, { sensitivity: 'base' });
    for (const field of ['platform', 'tag']) {
      for (const [key, { label }] of [...Library.labels(field, titles)].sort(byName)) add(`label:${key}`, label);
    }
    return chips;
  },

  // The newest titles on your list to watch. The Library keeps titles newest
  // first (new ones go to the top, on adding and importing), and files keep that order
  RECENT_COUNT: 20,
  recentlyAdded() {
    return Library.all().filter(this.LISTS.queue).slice(0, this.RECENT_COUNT);
  },

  // Whether what's typed in a list's search is part of a chip's name
  chipMatches(chip, query) {
    const text = MovieAPI.normalizeTitle(query);
    return Boolean(text) && chip.key !== 'all' && MovieAPI.normalizeTitle(chip.label).includes(text);
  },

  // The chips to show for what's typed: the ones it matches, plus any filter
  // that's on, so you can see it and turn it off. If it matches none, it's only
  // a search for titles, and every chip stays
  narrowChips(chips, query, active) {
    if (!chips.some(chip => this.chipMatches(chip, query))) return chips;
    return chips.filter(chip => this.chipMatches(chip, query) || (chip.key === active && active !== 'all'));
  },

  // Titles this page shows in any list
  shown() {
    return Library.all().filter(t => t.want || Title.isSeen(t));
  }
};
