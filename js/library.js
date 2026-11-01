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

  // Opens the page's database and loads its titles, migrating what an
  // earlier version stored if this version hasn't saved yet
  async open(database) {
    await Store.open(database);
    const stored = await Store.load(CONFIG.STORAGE.TITLES_KEY);
    this.load(stored !== undefined || !database.legacyKey ? stored : await Store.load(database.legacyKey));
  },

  // Accepts an array of records in any version's shape, or the JSON string
  // the watchlist used to store. Throws if the data can't be read at all.
  load(data) {
    const list = typeof data === 'string' ? JSON.parse(data) : data;
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

  // Saves and notifies after a change made outside the methods above (undo)
  changed() {
    this.save();
    this.onChange();
  },

  save() {
    Store.scheduleSave(CONFIG.STORAGE.TITLES_KEY, () => this.titles);
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
    for (const raw of raws) {
      const incoming = Title.sanitize(raw);
      if (!incoming) continue;
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
