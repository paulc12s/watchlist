// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Library: the titles one page keeps, and the only way they change
//
// Both pages use this same code on their own database (see CONFIG.STORAGE):
// every add, change, removal, import and export goes through here, so the
// rules are the same everywhere. Records have the shape in js/title.js.
//
// Files: export() writes { app: 'titles', version: 2, titles: [...] }.
// import() also reads every format earlier versions wrote: watchlist exports
// ({ unwatched, watched }), ratings backups ({ app: 'ratings', ratings }),
// and plain arrays (Export for Watchlist, want-to-watch, batch upload).
// ============================================================================

const Library = {
  // Newest additions first
  titles: [],
  byKey: new Map(),
  byId: new Map(),
  // Called after every change, import and removal
  onChange() {},

  // Opens the app's database and loads its titles
  async open(database) {
    await Store.open(database);
    this.load(await Store.load(CONFIG.STORAGE.TITLES_KEY));
  },

  // Accepts an array of records in any version's shape (or nothing stored
  // yet). Throws if the data isn't a list at all.
  load(list) {
    if (list !== undefined && list !== null && !Array.isArray(list)) throw new Error('Stored titles are not a list');
    this.titles = [];
    this.index();
    for (const raw of list || []) {
      const title = Title.sanitize(raw);
      if (!title) continue;
      // Two stored copies of one title (shouldn't happen) are merged, not dropped
      const twin = this.find(title);
      if (twin) Object.assign(twin, Title.merge(twin, title, raw) || {});
      else this.insert(title, 'end');
    }
  },

  // ---- Reading ---------------------------------------------------------------

  all() {
    return this.titles;
  },

  get(id) {
    return this.byId.get(id);
  },

  find(t) {
    return this.byKey.get(Title.key(t));
  },

  byImdb(imdbID) {
    return imdbID ? this.byKey.get(`imdb:${imdbID}`) : undefined;
  },

  // ---- Changing --------------------------------------------------------------

  // Adds a new title from whichever fields are known. Returns { title }, or
  // { duplicate } with the copy already here, or {} if the fields are invalid.
  add(fields) {
    const now = new Date().toISOString();
    const title = Title.sanitize({ ...fields, id: Title.newId() });
    if (title) this.nameLabels(title);
    if (!title) return {};
    const duplicate = this.find(title);
    if (duplicate) return { duplicate };
    title.updatedDate = now;
    if (Title.isSeen(title) || title.stars || title.review || title.rewatch) title.reviewDate = now;
    this.insert(title, 'start');
    this.changed();
    return { title };
  },

  // Applies changes to a title in place (so references to it stay current)
  // and dates them. Returns the title, or null if the changes are invalid.
  change(t, changes) {
    const next = Title.changed(t, changes);
    if (!next) return null;
    this.nameLabels(next, t);
    const undated = r => JSON.stringify({ ...r, updatedDate: '', reviewDate: '' });
    if (undated(next) === undated(t)) return t;
    this.unindex(t);
    Object.assign(t, next);
    this.indexOne(t);
    this.changed();
    return t;
  },

  // Creates the title from looked-up details on first touch, then applies
  // changes. Fresh details win over the stored ones, but blanks don't erase them.
  upsert(details, changes = {}) {
    const fields = ['imdbID', 'title', 'year', 'genres', 'director', 'actors', 'plot', 'poster', 'imdbRating', 'type', 'tmdbId'];
    const fresh = Object.fromEntries(fields
      .filter(field => details[field] !== undefined && details[field] !== null && String(details[field]).length)
      .map(field => [field, details[field]]));
    const existing = this.find(fresh);
    if (existing) return this.change(existing, { ...fresh, ...changes });
    return this.add({ ...fresh, ...changes }).title || null;
  },

  // Deletes are local to this page: files never remove anything
  remove(t) {
    const index = this.titles.indexOf(t);
    if (index === -1) return -1;
    this.titles.splice(index, 1);
    this.unindex(t);
    this.changed();
    return index;
  },

  // Puts back a removed title, e.g. on undo
  restore(t, index) {
    if (this.find(t)) return;
    this.titles.splice(Math.min(index, this.titles.length), 0, t);
    this.indexOne(t);
    this.changed();
  },

  // When the stored titles couldn't be loaded: nothing is saved this visit,
  // so the titles in storage stay as they were, whatever happens on screen
  LOAD_FAILED: 'Your saved titles couldn’t be loaded, so changes on this page won’t be saved. Your saved titles are untouched. Reload to try again.',

  loadFailed() {
    this.load([]);
    Store.block(this.LOAD_FAILED);
  },

  // Saves and notifies after a change made outside the methods above (undo)
  changed() {
    // Counts changes, so anything built from the titles knows when to rebuild
    this.revision = (this.revision || 0) + 1;
    this.save();
    this.onChange();
  },

  save() {
    Store.scheduleSave(CONFIG.STORAGE.TITLES_KEY, () => this.titles);
  },

  // ---- Tags and platforms ------------------------------------------------------
  // Each tag and platform is stored in one spelling, whatever was typed or
  // imported: "art", "#Art " and "ART" are all stored as the spelling already
  // in use, so the same tag is never kept in several forms. A new label is
  // stored as typed, cleaned (no #, single spaces); a new platform also
  // matches the known list (CONFIG.PLATFORMS).

  // lower-case label -> { label, count } for 'tag' or 'platform', leaving out
  // one title if given (the one being edited, so it can rename a label only
  // it uses). Where older data holds several spellings, one with capitals
  // wins ("Art" over "art"), then the most used.
  labels(field, titles = this.titles, except = null) {
    const spellings = new Map();
    for (const t of titles) {
      const value = Title.cleanLabel(t[field]);
      if (!value || t === except) continue;
      const key = value.toLowerCase();
      if (!spellings.has(key)) spellings.set(key, new Map());
      const forms = spellings.get(key);
      forms.set(value, (forms.get(value) || 0) + 1);
    }
    const result = new Map();
    for (const [key, forms] of spellings) {
      const capitals = form => Number(form !== form.toLowerCase());
      const [best] = [...forms].sort((a, b) => capitals(b[0]) - capitals(a[0]) || b[1] - a[1]);
      result.set(key, { label: best[0], count: [...forms.values()].reduce((sum, n) => sum + n, 0) });
    }
    return result;
  },

  // The spelling to store for a typed or imported label ('' for none)
  labelName(field, value, known = this.labels(field)) {
    const clean = Title.cleanLabel(value);
    if (!clean) return '';
    const key = clean.toLowerCase();
    if (known.has(key)) return known.get(key).label;
    const platform = field === 'platform' && CONFIG.PLATFORMS.find(p => p.toLowerCase() === key);
    return platform || clean;
  },

  // Gives a record's tag and platform their stored spellings, in place.
  // except: the title being edited; known: label maps to use and extend
  nameLabels(t, except = null, known = null) {
    for (const field of ['tag', 'platform']) {
      if (!t[field]) continue;
      const labels = known ? known[field] : this.labels(field, this.titles, except);
      t[field] = this.labelName(field, t[field], labels);
      if (known) labels.set(t[field].toLowerCase(), { label: t[field], count: 1 });
    }
  },

  // ---- Cleanup (Settings → Run cleanup) ----------------------------------------
  // Repairs what's held in memory and saves once if anything changed:
  // - every title re-checked against the record rules (Title.sanitize), so a
  //   value an older version or a hand-edited file left behind is corrected
  // - two copies of one title merged, as an import would merge them
  // - IDs made unique
  // - each tag and platform rewritten in its one spelling (labels)
  // Dates stay as they are: tidying isn't an edit, so it can't make a title
  // win a merge it wouldn't otherwise. Returns what it did.
  cleanup() {
    const report = { titles: this.titles.length, repaired: 0, merged: 0, renumbered: 0, renamed: [] };

    // Record rules
    for (const t of this.titles) {
      const clean = Title.sanitize(t);
      if (clean && JSON.stringify(clean) !== JSON.stringify(t)) {
        Object.assign(t, clean);
        report.repaired++;
      }
    }

    // Duplicates and IDs: rebuild the list as loading does, merging copies
    const before = this.titles;
    this.load(JSON.parse(JSON.stringify(before)));
    report.merged = before.length - this.titles.length;
    const ids = new Set();
    for (const t of this.titles) {
      if (ids.has(t.id)) {
        t.id = Title.newId();
        report.renumbered++;
      }
      ids.add(t.id);
    }
    this.index();

    // One spelling per tag and platform
    for (const field of ['tag', 'platform']) {
      const labels = this.labels(field);
      const renamed = new Map();
      for (const t of this.titles) {
        if (!t[field]) continue;
        const label = labels.get(Title.cleanLabel(t[field]).toLowerCase()).label;
        if (t[field] === label) continue;
        const change = `${t[field]} → ${label}`;
        renamed.set(change, (renamed.get(change) || 0) + 1);
        t[field] = label;
      }
      for (const [change, count] of renamed) report.renamed.push({ field, change, count });
    }

    report.changed = Boolean(report.repaired || report.merged || report.renumbered || report.renamed.length);
    if (report.changed) this.changed();
    return report;
  },

  // ---- Files -----------------------------------------------------------------

  // Merges a file into this page's titles (see Title.merge for the rules).
  // Returns { added, updated, unchanged }; throws with a readable message if
  // the file isn't one the apps wrote.
  import(data) {
    const raws = this.recordsIn(data);
    if (raws.length > CONFIG.LIMITS.MAX_IMPORT) throw new Error(`Too many titles (max ${CONFIG.LIMITS.MAX_IMPORT.toLocaleString()})`);
    let updated = 0, unchanged = 0;
    const added = [];
    // Labels so far, so a file's spellings join the ones already here (and
    // each other) as it's read, without a search per title
    const known = { tag: this.labels('tag'), platform: this.labels('platform') };
    for (const raw of raws) {
      const incoming = Title.sanitize(raw);
      if (!incoming) continue;
      this.nameLabels(incoming, null, known);
      const local = this.find(incoming);
      if (!local) {
        // Keep the file's ID so a re-import finds it, unless it's taken
        if (this.byId.has(incoming.id)) incoming.id = Title.newId();
        this.indexOne(incoming);
        added.push(incoming);
        continue;
      }
      const merged = Title.merge(local, incoming, raw);
      if (!merged) {
        unchanged++;
        continue;
      }
      this.unindex(local);
      Object.assign(local, merged);
      this.indexOne(local);
      updated++;
    }
    if (!added.length && !updated && !unchanged) throw new Error('No titles found in this file');
    // New titles go to the top, in the file's order
    this.titles.unshift(...added);
    if (added.length || updated) this.changed();
    return { added: added.length, updated, unchanged };
  },

  // The raw records in any file format the apps have written
  recordsIn(data) {
    if (data && data.app === 'titles' && Array.isArray(data.titles)) return data.titles;
    if (data && data.app === 'ratings' && Array.isArray(data.ratings)) return data.ratings;
    if (Array.isArray(data)) return data;
    if (data && (data.unwatched !== undefined || data.watched !== undefined)) {
      const lists = [['unwatched', false], ['watched', true]];
      for (const [name] of lists) {
        if (data[name] !== undefined && !Array.isArray(data[name])) throw new Error(`Invalid ${name} list`);
      }
      // Which list a title is in says whether you'd watched it
      return lists.flatMap(([name, watched]) =>
        (data[name] || []).map(item => (item && typeof item === 'object' ? { ...item, watched } : item)));
    }
    throw new Error('Not a watchlist or ratings export');
  },

  exportText(from) {
    return Library.fileText(this.titles, from);
  },

  // The export file for any list of titles; also used by batch upload
  fileText(titles, from) {
    return JSON.stringify({ app: 'titles', version: 2, from, exportDate: new Date().toISOString(), titles }, null, 2);
  },

  // e.g. "watchlist-2026-10-31-1432.json": local date and time, so two
  // exports on the same day don't share a name
  fileName(prefix, extension = 'json', date = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${prefix}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-` +
      `${pad(date.getHours())}${pad(date.getMinutes())}.${extension}`;
  },

  // ---- Indexes -----------------------------------------------------------------

  insert(t, where) {
    if (where === 'start') this.titles.unshift(t);
    else this.titles.push(t);
    this.indexOne(t);
  },

  index() {
    this.byKey = new Map();
    this.byId = new Map();
    this.titles.forEach(t => this.indexOne(t));
  },

  indexOne(t) {
    this.byKey.set(Title.key(t), t);
    this.byId.set(t.id, t);
  },

  unindex(t) {
    if (this.byKey.get(Title.key(t)) === t) this.byKey.delete(Title.key(t));
    if (this.byId.get(t.id) === t) this.byId.delete(t.id);
  }
};
