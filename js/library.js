// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Library: your titles, and the only way they change
//
// Every add, change, removal, import and export goes through here, so the
// rules are the same in every mode. Records have the shape in js/title.js,
// and are stored as one list in the app's database (see CONFIG.STORAGE).
//
// Before an import, cleanup or restore changes anything, the titles as they
// were are kept as a snapshot (one, the latest), which restoreSnapshot puts back.
//
// Files: export() writes { app: 'watchlist', version: 3, titles: [...] }, with
// what wrote it (appVersion, browser) and how many titles it holds (count).
// import() also reads every format earlier versions wrote: version 2, the
// same but headed { app: 'titles' } and without those; watchlist exports
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

  // Stored records that couldn't be read as titles this visit (see open)
  unreadable: [],
  NEWER_VERSION: 'Your titles were saved by a newer version of the app, so this older copy won’t change them. Reload to get the latest version.',

  // Opens the app's database and loads its titles
  async open(database) {
    const { TITLES_KEY, SCHEMA_KEY, SCHEMA, UNREADABLE_PREFIX } = CONFIG.STORAGE;
    await Store.open(database);
    const [list, schema] = await Promise.all([Store.load(TITLES_KEY), Store.load(SCHEMA_KEY)]);
    this.unreadable = this.load(list);
    this.storedSchema = Number.isInteger(schema) ? schema : 0;
    // A newer version may store what this one would strip: change nothing
    if (this.storedSchema > SCHEMA) return Store.block(this.NEWER_VERSION);
    // The next save of the titles leaves these out, so they're kept aside
    // rather than lost without a word
    if (this.unreadable.length) {
      console.warn(`${this.unreadable.length} stored records couldn’t be read as titles; kept aside`);
      const kept = this.unreadable;
      Store.scheduleSave(`${UNREADABLE_PREFIX}${new Date().toISOString()}`, () => kept);
    }
  },

  // Accepts an array of records in any version's shape (or nothing stored
  // yet). Throws if the data isn't a list at all. Returns the records it
  // couldn't read as titles, which are left out.
  load(list) {
    if (list !== undefined && list !== null && !Array.isArray(list)) throw new Error('Stored titles are not a list');
    this.titles = [];
    this.index();
    const unreadable = [];
    for (const raw of list || []) {
      const title = Title.sanitize(raw);
      if (!title) {
        unreadable.push(raw);
        continue;
      }
      // Two stored copies of one title (shouldn't happen) are merged, not dropped
      const twin = this.find(title);
      if (twin) Object.assign(twin, Title.merge(twin, title, raw) || {});
      else this.insert(title, 'end');
    }
    return unreadable;
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
    const fields = ['imdbID', 'title', 'year', 'genres', 'director', 'actors', 'plot', 'poster', 'imdbRating', 'rated', 'rottenTomatoes', 'type', 'tmdbId'];
    const fresh = Object.fromEntries(fields
      .filter(field => details[field] !== undefined && details[field] !== null && String(details[field]).length)
      .map(field => [field, details[field]]));
    const existing = this.find(fresh);
    if (existing) return this.change(existing, { ...fresh, ...changes });
    return this.add({ ...fresh, ...changes }).title || null;
  },

  // Fills in the certificate and Rotten Tomatoes score of a title saved
  // before they were kept, from details looked up for it. Only blanks are
  // filled, and it isn't an edit: dates stay, so it can't win a merge.
  // Returns whether anything changed.
  fillDetails(t, details) {
    if (!details || this.get(t.id) !== t) return false;
    const filled = Title.sanitize({ ...t, rated: details.rated, rottenTomatoes: details.rottenTomatoes });
    const changes = {};
    if (!t.rated && filled.rated) changes.rated = filled.rated;
    if (t.rottenTomatoes === null && filled.rottenTomatoes !== null) changes.rottenTomatoes = filled.rottenTomatoes;
    if (!Object.keys(changes).length) return false;
    Object.assign(t, changes);
    this.changed();
    return true;
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
    const { TITLES_KEY, SCHEMA_KEY, SCHEMA } = CONFIG.STORAGE;
    Store.scheduleSave(TITLES_KEY, () => this.titles);
    // With the first save, not on opening: opening writes nothing
    if (this.storedSchema !== SCHEMA) {
      this.storedSchema = SCHEMA;
      Store.scheduleSave(SCHEMA_KEY, () => SCHEMA);
    }
  },

  // ---- Snapshot: the titles before the last import, cleanup or restore --------
  // One is kept, in the same database. Restoring keeps a snapshot too, so a
  // restore can itself be undone.

  // before: the titles as JSON text, taken before the change
  keepSnapshot(reason, before) {
    const snapshot = { reason, date: new Date().toISOString(), titles: JSON.parse(before) };
    Store.scheduleSave(CONFIG.STORAGE.SNAPSHOT_KEY, () => snapshot, 0);
  },

  async readSnapshot() {
    const saved = await Store.load(CONFIG.STORAGE.SNAPSHOT_KEY);
    return saved && Array.isArray(saved.titles) && typeof saved.reason === 'string' && typeof saved.date === 'string' ? saved : null;
  },

  // What there is to restore: { reason, date, count }, or null
  async snapshot() {
    const saved = await this.readSnapshot();
    return saved ? { reason: saved.reason, date: saved.date, count: saved.titles.length } : null;
  },

  // Puts the titles back as the snapshot has them; returns how many
  async restoreSnapshot() {
    if (Store.blocked) throw new Error(Store.blocked);
    await Store.flush();
    const saved = await this.readSnapshot();
    if (!saved) throw new Error('Nothing to restore');
    const before = JSON.stringify(this.titles);
    this.load(saved.titles);
    this.keepSnapshot('restore', before);
    this.changed();
    return this.titles.length;
  },

  // ---- Tags and platforms ------------------------------------------------------
  // A title has any number of tags and one platform. Each label is stored in
  // one spelling, whatever was typed or imported: "art", "#Art " and "ART" are
  // all stored as the spelling already
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
      if (t === except) continue;
      for (const raw of Title.labelsOf(t, field)) {
        const value = Title.cleanLabel(raw);
        if (!value) continue;
        const key = value.toLowerCase();
        if (!spellings.has(key)) spellings.set(key, new Map());
        const forms = spellings.get(key);
        forms.set(value, (forms.get(value) || 0) + 1);
      }
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

  // Gives a record's tags and platform their stored spellings, in place.
  // except: the title being edited; known: label maps to use and extend
  nameLabels(t, except = null, known = null) {
    const spell = (field, value, labels) => {
      const name = this.labelName(field, value, labels);
      if (known) labels.set(name.toLowerCase(), { label: name, count: 1 });
      return name;
    };
    if (t.tags.length) {
      const labels = known ? known.tag : this.labels('tag', this.titles, except);
      t.tags = Title.parseTags(t.tags.map(tag => spell('tag', tag, labels)));
    }
    if (t.platform) {
      const labels = known ? known.platform : this.labels('platform', this.titles, except);
      t.platform = spell('platform', t.platform, labels);
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
    const asWas = JSON.stringify(this.titles);

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
      const spelled = value => {
        const label = labels.get(Title.cleanLabel(value).toLowerCase()).label;
        if (value !== label) {
          const change = `${value} → ${label}`;
          renamed.set(change, (renamed.get(change) || 0) + 1);
        }
        return label;
      };
      for (const t of this.titles) {
        if (field === 'tag') t.tags = t.tags.map(spelled);
        else if (t.platform) t.platform = spelled(t.platform);
      }
      for (const [change, count] of renamed) report.renamed.push({ field, change, count });
    }

    report.changed = Boolean(report.repaired || report.merged || report.renumbered || report.renamed.length);
    if (report.changed) {
      this.keepSnapshot('cleanup', asWas);
      this.changed();
    }
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
    const asWas = JSON.stringify(this.titles);
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
    if (added.length || updated) {
      this.keepSnapshot('import', asWas);
      this.changed();
    }
    return { added: added.length, updated, unchanged };
  },

  // The raw records in any file format the apps have written
  recordsIn(data) {
    if (this.isExport(data)) {
      // A file cut short in copying is still JSON only by chance, but check
      if (Number.isInteger(data.count) && data.count !== data.titles.length) {
        throw new Error(`This file is incomplete: it should hold ${data.count} titles and holds ${data.titles.length}`);
      }
      return data.titles;
    }
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

  // Whether data is a file this app exported: headed 'watchlist' (version 3
  // on) or 'titles' (version 2)
  FILE_APPS: ['watchlist', 'titles'],
  isExport(data) {
    return Boolean(data) && this.FILE_APPS.includes(data.app) && Array.isArray(data.titles);
  },

  // extra: more top-level fields for the file, such as the app's settings
  exportText(from, extra = {}) {
    return Library.fileText(this.titles, from, extra);
  },

  // The export file for any list of titles; also used by batch upload
  fileText(titles, from, extra = {}) {
    return JSON.stringify({
      app: 'watchlist', version: 3, from, exportDate: new Date().toISOString(),
      // Which code wrote the file (the deployed commit; 'dev' when run from
      // the branch), and on what, to tell files apart and trace a bad one
      appVersion: CONFIG.APP_VERSION.startsWith('__') ? 'dev' : CONFIG.APP_VERSION,
      browser: this.browserInfo(),
      count: titles.length,
      ...extra, titles
    }, null, 2);
  },

  // What the browser says it is: { name: 'Safari on iPhone', userAgent }.
  // Nothing is asked of the device beyond what every web request already sends
  browserInfo(userAgent = typeof navigator === 'undefined' ? '' : String(navigator.userAgent || '')) {
    const first = pairs => (pairs.find(([pattern]) => pattern.test(userAgent)) || [])[1] || '';
    // Order matters: Edge and Chrome also say Safari, and iPads say Mac
    const browser = first([[/Edg(e|A|iOS)?\//, 'Edge'], [/OPR\//, 'Opera'], [/Firefox\/|FxiOS\//, 'Firefox'],
      [/Chrome\/|CriOS\//, 'Chrome'], [/Safari\//, 'Safari']]);
    const device = first([[/iPhone/, 'iPhone'], [/iPad/, 'iPad'], [/Android/, 'Android'], [/Macintosh|Mac OS X/, 'Mac'],
      [/Windows/, 'Windows'], [/CrOS/, 'ChromeOS'], [/Linux/, 'Linux']]);
    return { name: [browser, device].filter(Boolean).join(' on ') || 'Unknown', userAgent: userAgent.substring(0, 300) };
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
