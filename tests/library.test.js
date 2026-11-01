// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Tests for the shared record model (js/title.js) and library (js/library.js):
// the one code path for storing, merging, importing and exporting titles.
// Some tests load two copies of it, standing in for two browsers or the
// retired pages, whose files and databases the app still reads.
// Run with: node --test tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { read, loadLists, loadReview, film, plain } = require('./helpers');

const OLD = '2026-01-01T00:00:00.000Z';
const MID = '2026-06-01T00:00:00.000Z';
const NEW = '2026-09-01T00:00:00.000Z';

// ---- The record ---------------------------------------------------------------

test('sanitize reads the watchlist’s old field names', () => {
  const { Title } = loadLists();
  const t = Title.sanitize({
    id: 'a', title: 'Dune', imdbID: 'tt1160419', watched: true, thumb: 'down', genre: 'Action, Sci-Fi', rating: '8.0',
    priority: 'high', tag: 'family', platform: 'Max', stars: 2, review: 'Long', rewatch: true, reviewDate: OLD
  });
  assert.deepEqual(plain({ want: t.want, verdict: t.verdict, genres: t.genres, imdbRating: t.imdbRating }),
    { want: false, verdict: 'down', genres: ['Action', 'Sci-Fi'], imdbRating: 8 });
  assert.equal(t.id, 'a');
  assert.equal(t.updatedDate, '', 'an old record has no change date');
  assert.equal(t.reviewDate, OLD);
  assert.equal(Title.formatRating(t.imdbRating), '8.0');
});

test('sanitize reads the retired ratings page’s old field names', () => {
  const { Title } = loadLists();
  const t = Title.sanitize({ ...film(1), verdict: 'skip', want: false, ratedAt: OLD, updatedAt: MID });
  assert.deepEqual(plain([t.verdict, t.reviewDate, t.updatedDate]), ['skip', OLD, MID]);
});

test('seen means rated: a watched title or a review without a thumb gets one', () => {
  const { Title } = loadLists();
  const verdict = fields => Title.sanitize({ title: 'A', ...fields }).verdict;
  assert.equal(verdict({ watched: true }), 'up');
  assert.equal(verdict({ watched: true, stars: 2 }), 'down');
  assert.equal(verdict({ watched: false, stars: 5 }), 'up');
  assert.equal(verdict({ review: 'notes' }), 'up');
  assert.equal(verdict({ watched: true, thumb: 'down', stars: 5 }), 'down', 'a given thumb wins');
  assert.equal(verdict({ watched: false }), '');
  assert.equal(verdict({ verdict: 'skip' }), 'skip');
  const queuedButRated = Title.sanitize({ title: 'A', watched: false, thumb: 'up' });
  assert.deepEqual(plain([queuedButRated.want, queuedButRated.verdict]), [true, 'up'], 'rated and still on the list');
});

test('sanitize rejects bad values and keeps what newer versions might write', () => {
  const { Title } = loadLists();
  assert.equal(Title.sanitize({ title: '' }), null);
  assert.equal(Title.sanitize(null), null);
  const t = Title.sanitize({
    title: 'A', imdbID: 'bad', stars: 9, verdict: 'meh', year: 'soon', imdbRating: 99, poster: 'javascript:alert(1)',
    priority: 'someday', type: 'podcast', youtubeID: 'abc12345678', plot: 'https://www.youtube.com/watch?v=abc12345678'
  });
  assert.deepEqual(plain([t.imdbID, t.stars, t.verdict, t.year, t.imdbRating, t.poster, t.type]), ['', 0, '', null, null, '', 'movie']);
  assert.equal(t.priority, 'someday', 'unknown priorities survive an out-of-date copy of the app');
  assert.equal(Title.displayPriority(t), 'medium');
  assert.equal(t.plot, '', 'older versions stored the video URL in plot');
});

test('titles match by IMDb ID, then YouTube ID, then their own ID', () => {
  const { Title } = loadLists();
  assert.equal(Title.key({ id: 'x', imdbID: 'tt1234567', youtubeID: 'y' }), 'imdb:tt1234567');
  assert.equal(Title.key({ id: 'x', youtubeID: 'y' }), 'yt:y');
  assert.equal(Title.key({ id: 'x' }), 'id:x');
});

// ---- Changing ---------------------------------------------------------------------

test('add refuses duplicates and dates new titles', () => {
  const { Library } = loadLists();
  const { title } = Library.add({ title: 'Dune', imdbID: 'tt1160419', want: true });
  assert.ok(title.updatedDate);
  assert.equal(title.reviewDate, '', 'adding to the list is not a review');
  assert.equal(Library.add({ title: 'Dune again', imdbID: 'tt1160419' }).duplicate, title);
  assert.ok(Library.add({ title: 'Home movie' }).title);
  assert.ok(Library.add({ title: 'Home movie' }).title, 'manual entries are never duplicates');
  assert.deepEqual(plain(Library.add({ title: '' })), {});
  assert.equal(Library.all()[0].title, 'Home movie', 'newest first');
});

test('change dates every change, and the review date only when the review changes', () => {
  const { Library } = loadLists();
  const { title } = Library.add({ title: 'A' });
  title.updatedDate = OLD;
  Library.change(title, { tag: 'x' });
  assert.ok(title.updatedDate > OLD);
  assert.equal(title.reviewDate, '', 'organising is not reviewing');
  Library.change(title, { stars: 4 });
  const reviewed = title.reviewDate;
  assert.ok(reviewed);
  title.updatedDate = OLD;
  Library.change(title, { stars: 4 });
  assert.equal(title.updatedDate, OLD, 'no change, no date');
  assert.equal(Library.change(title, { title: '' }), null, 'invalid changes are refused');
  assert.equal(title.title, 'A');
});

// ---- Merging ----------------------------------------------------------------------

function merged(local, incoming) {
  const { Title } = loadLists();
  const a = Title.sanitize(local);
  const b = Title.sanitize(incoming);
  return plain(Title.merge(a, b, incoming) || a);
}

test('merge: the more recently reviewed copy’s review wins', () => {
  const result = merged(
    { title: 'A', imdbID: 'tt0000001', verdict: 'up', stars: 4, review: 'old', reviewDate: OLD, updatedDate: OLD },
    { title: 'A', imdbID: 'tt0000001', verdict: 'down', stars: 0, review: '', reviewDate: NEW, updatedDate: NEW }
  );
  assert.deepEqual([result.verdict, result.stars, result.review, result.reviewDate], ['down', 0, '', NEW]);
});

test('merge: the more recently changed copy’s other fields win; the older copy changes nothing', () => {
  const local = { title: 'A', imdbID: 'tt0000001', tag: 'old', want: true, priority: 'low', reviewDate: OLD, updatedDate: MID };
  const newer = merged(local, { ...local, tag: 'new', want: false, priority: 'high', updatedDate: NEW });
  assert.deepEqual([newer.tag, newer.want, newer.priority, newer.updatedDate], ['new', false, 'high', NEW]);
  const older = merged(local, { ...local, tag: 'older', updatedDate: OLD });
  assert.deepEqual([older.tag, older.updatedDate], ['old', MID]);
});

test('merge: a copy without dates (an old file) only fills blanks', () => {
  const result = merged(
    { title: 'A', imdbID: 'tt0000001', verdict: 'up', tag: 'mine', stars: 0, review: '', updatedDate: MID, reviewDate: MID },
    { title: 'A', imdbID: 'tt0000001', watched: true, thumb: 'down', tag: 'theirs', platform: 'Netflix', stars: 2, review: 'meh' }
  );
  assert.deepEqual([result.verdict, result.tag, result.platform, result.review], ['up', 'mine', 'Netflix', 'meh']);
  assert.equal(result.stars, 2);
  assert.equal(result.updatedDate, MID, 'merging is not an edit');
});

test('merge: fields a file doesn’t carry are kept, even when it is newer', () => {
  // Early ratings backups had no tag, platform or priority
  const result = merged(
    { title: 'A', imdbID: 'tt0000001', tag: 'family', platform: 'Max', priority: 'high', updatedDate: OLD },
    { title: 'A', imdbID: 'tt0000001', verdict: 'up', want: false, updatedAt: NEW, ratedAt: NEW }
  );
  assert.deepEqual([result.tag, result.platform, result.priority, result.verdict], ['family', 'Max', 'high', 'up']);
});

test('merge: a thumb settles a skip; "want" only fills in for titles you haven’t seen', () => {
  const skip = merged(
    { title: 'A', imdbID: 'tt0000001', verdict: 'skip', updatedDate: MID },
    { title: 'A', imdbID: 'tt0000001', watched: true, thumb: 'up' }
  );
  assert.equal(skip.verdict, 'up');
  const seen = merged(
    { title: 'A', imdbID: 'tt0000001', verdict: 'down', want: false, updatedDate: MID },
    { title: 'A', imdbID: 'tt0000001', watched: false }
  );
  assert.equal(seen.want, false, 'an old file can’t put a seen title back on the list');
  const unseen = merged({ title: 'A', imdbID: 'tt0000001', updatedDate: MID }, { title: 'A', imdbID: 'tt0000001', watched: false });
  assert.equal(unseen.want, true);
});

test('merge: not interested carries like a skip, and a thumb from either copy settles it', () => {
  const newer = merged(
    { title: 'A', imdbID: 'tt0000001', verdict: 'skip', updatedDate: OLD },
    { title: 'A', imdbID: 'tt0000001', verdict: 'pass', updatedDate: NEW }
  );
  assert.equal(newer.verdict, 'pass');
  const seen = merged(
    { title: 'A', imdbID: 'tt0000001', verdict: 'pass', updatedDate: NEW },
    { title: 'A', imdbID: 'tt0000001', verdict: 'up', reviewDate: OLD, updatedDate: OLD }
  );
  assert.equal(seen.verdict, 'up', 'having seen it outranks not being interested');
});

test('merge: a newer skip carries, though a skip isn’t a review', () => {
  const result = merged(
    { title: 'A', imdbID: 'tt0000001', verdict: '', updatedDate: OLD },
    { title: 'A', imdbID: 'tt0000001', verdict: 'skip', updatedDate: NEW }
  );
  assert.equal(result.verdict, 'skip');
});

test('merge: a review date comes with the review it belongs to', () => {
  const blank = merged({ title: 'A', imdbID: 'tt0000001', updatedDate: OLD }, { title: 'A', imdbID: 'tt0000001', stars: 5, reviewDate: MID });
  assert.equal(blank.reviewDate, MID);
  const kept = merged(
    { title: 'A', imdbID: 'tt0000001', stars: 5, reviewDate: MID, updatedDate: MID },
    { title: 'A', imdbID: 'tt0000001', tag: 'x' }
  );
  assert.deepEqual([kept.stars, kept.reviewDate, kept.tag], [5, MID, 'x'], 'an undated file leaves the review and its date');
  const newer = merged(
    { title: 'A', imdbID: 'tt0000001', stars: 5, reviewDate: MID, updatedDate: MID },
    { title: 'A', imdbID: 'tt0000001', stars: 3, reviewDate: NEW }
  );
  assert.deepEqual([newer.stars, newer.reviewDate], [3, NEW], 'a newer review brings its date');
});

// ---- Importing and exporting ------------------------------------------------------

test('import reads every format and reports what changed', () => {
  const { Library } = loadLists();
  const formats = [
    { app: 'titles', version: 2, titles: [{ title: 'A', imdbID: 'tt0000001' }] },
    { app: 'ratings', version: 1, ratings: [{ ...film(2), verdict: 'up', want: false, updatedAt: MID }] },
    { unwatched: [{ title: 'C', imdbID: 'tt0000003' }], watched: [{ title: 'D', imdbID: 'tt0000004' }] },
    [{ title: 'E', imdbID: 'tt0000005', watched: false }]
  ];
  for (const file of formats) assert.equal(Library.import(plain(file)).added, file.titles ? 1 : file.ratings ? 1 : file.watched ? 2 : 1);
  assert.equal(Library.byImdb('tt0000004').want, false, 'the list a title came in says whether it was watched');
  assert.equal(Library.byImdb('tt0000004').verdict, 'up');
  assert.deepEqual(plain(Library.import(formats[0])), { added: 0, updated: 0, unchanged: 1 });
  assert.throws(() => Library.import({ something: 1 }), /Not a watchlist or ratings export/);
  assert.throws(() => Library.import({ unwatched: 'nope' }), /Invalid unwatched list/);
  assert.throws(() => Library.import([]), /No titles found/);
});

test('import keeps a file’s IDs, so re-importing a manual entry doesn’t duplicate it', () => {
  const { Library } = loadLists();
  const file = { app: 'titles', version: 2, titles: [{ id: 'm1', title: 'Home movie' }] };
  Library.import(file);
  assert.deepEqual(plain(Library.import(file)), { added: 0, updated: 0, unchanged: 1 });
  assert.equal(Library.all().length, 1);
});

test('export writes every title, and the file imports back unchanged', () => {
  const { Library } = loadLists();
  Library.add({ title: 'A', imdbID: 'tt0000001', want: true, tag: 'x' });
  Library.add({ title: 'B', imdbID: 'tt0000002', verdict: 'skip' });
  const file = JSON.parse(Library.exportText('watchlist'));
  assert.deepEqual([file.app, file.version, file.from, file.titles.length], ['titles', 2, 'watchlist', 2]);
  const other = loadReview().Library;
  other.import(file);
  assert.deepEqual(plain(other.all()), plain(Library.all()));
});

test('deletes stay on the page where you make them', () => {
  const a = loadLists().Library;
  const b = loadReview().Library;
  a.add({ title: 'A', imdbID: 'tt0000001', want: true });
  b.import(JSON.parse(a.exportText()));
  a.remove(a.byImdb('tt0000001'));
  b.import(JSON.parse(a.exportText().replace('"titles": []', '"titles": [{"title": "Other"}]')));
  assert.ok(b.byImdb('tt0000001'), 'the other page keeps its copy');
  a.import(JSON.parse(b.exportText()));
  assert.ok(a.byImdb('tt0000001'), 'and importing from it brings the title back');
});

test('a change on one page carries to the other through a file, in both directions', () => {
  const watchlist = loadLists();
  const ratings = loadReview();
  watchlist.Library.add({ title: 'Film 1', imdbID: 'tt0000001', want: true, tag: 'family' });
  ratings.Library.import(JSON.parse(watchlist.Library.exportText()));
  ratings.Ratings.update(film(1), { verdict: 'up' });
  // Make sure the rating is later than the watchlist's copy, even within one millisecond
  Object.assign(ratings.Ratings.get('tt0000001'), { updatedDate: '2999-01-01T00:00:00.000Z', reviewDate: '2999-01-01T00:00:00.000Z' });
  watchlist.Library.import(JSON.parse(ratings.Library.exportText()));
  const item = watchlist.Library.byImdb('tt0000001');
  assert.deepEqual([item.verdict, item.want, item.tag], ['up', false, 'family']);

  ratings.Ratings.update(film(1), { verdict: 'down' });
  Object.assign(ratings.Ratings.get('tt0000001'), { updatedDate: '2999-02-01T00:00:00.000Z', reviewDate: '2999-02-01T00:00:00.000Z' });
  watchlist.Library.import(JSON.parse(ratings.Library.exportText()));
  assert.equal(item.verdict, 'down', 'changing your mind carries over too');
});

test('export file names carry the local date and time', () => {
  const { Library } = loadLists();
  assert.equal(Library.fileName('ratings', 'json', new Date(2026, 9, 31, 21, 5)), 'ratings-2026-10-31-2105.json');
});

// ---- Loading and migrating ----------------------------------------------------------

test('the retired pages\u2019 stored formats convert as they come in (watched, genre, ratedAt, updatedAt)', () => {
  const { Library } = loadLists();
  Library.import([{ id: 'a', title: 'A', imdbID: 'tt0000001', watched: true, genre: 'Drama' }]);
  const a = Library.byImdb('tt0000001');
  assert.deepEqual(plain([a.verdict, a.want, a.genres]), ['up', false, ['Drama']]);
  Library.import([{ ...film(2), verdict: 'up', want: false, ratedAt: OLD, updatedAt: MID }]);
  assert.deepEqual(plain([Library.byImdb('tt0000002').reviewDate, Library.byImdb('tt0000002').updatedDate]), [OLD, MID]);
});

test('a new database starts empty', async () => {
  const { Library, CONFIG } = loadLists();
  await Library.open(CONFIG.STORAGE.APP);
  assert.equal(Library.all().length, 0);
  Library.add({ title: 'A' });
  assert.equal(Library.all().length, 1);
});

test('two stored copies of one title are merged, not dropped', () => {
  const { Library } = loadLists();
  Library.load([{ title: 'A', imdbID: 'tt0000001', tag: 'x' }, { title: 'A', imdbID: 'tt0000001', platform: 'Max' }]);
  assert.equal(Library.all().length, 1);
  assert.deepEqual(plain([Library.all()[0].tag, Library.all()[0].platform]), ['x', 'Max']);
});

// ---- Files written by earlier versions ------------------------------------------------
// tests/fixtures holds one file per export format the apps have ever written,
// made by running that commit's own code (named after the commit). Each must
// still import into both pages with every field intact.

const fixtures = fs.readdirSync(path.join(__dirname, 'fixtures')).filter(f => f.endsWith('.json'));
const fixture = name => JSON.parse(read(`tests/fixtures/${name}`));

// Each old field, and where today's record keeps it
const FIELD_NOW = {
  thumb: (old, t) => !old || t.verdict === old,
  watched: (old, t) => t.want === !old,
  genre: (old, t) => t.genres.join(', ') === old,
  rating: (old, t) => (old ? t.imdbRating === Number(old) : t.imdbRating === null),
  ratedAt: (old, t) => t.reviewDate === old,
  updatedAt: (old, t) => t.updatedDate === old,
  imdbRating: (old, t) => t.imdbRating === (old ? Number(old) : null)
};

function assertKeeps(old, now, label) {
  assert.ok(now, `${label}: missing`);
  for (const [field, value] of Object.entries(old)) {
    const ok = FIELD_NOW[field] ? FIELD_NOW[field](value, now) : JSON.stringify(now[field]) === JSON.stringify(value);
    assert.ok(ok, `${label}: ${field} was ${JSON.stringify(value)}, now ${JSON.stringify(now[FIELD_NOW[field] ? '' : field])}`);
  }
}

function recordsOf(file) {
  if (file.ratings) return file.ratings;
  if (Array.isArray(file)) return file;
  return [...file.unwatched.map(i => ({ ...i, watched: false })), ...file.watched.map(i => ({ ...i, watched: true }))];
}

test('every old export imports into both pages with nothing lost', () => {
  assert.ok(fixtures.length >= 8);
  for (const name of fixtures) {
    for (const page of [loadLists(), loadReview()]) {
      const file = fixture(name);
      const result = page.Library.import(file);
      const records = recordsOf(file);
      assert.equal(result.added, records.length, name);
      for (const old of records) {
        const now = page.Library.find(page.Title.sanitize(old));
        assertKeeps(old, now, `${name} ${old.title}`);
      }
    }
  }
});

test('every old stored list loads the same way its exports import', () => {
  for (const name of fixtures) {
    const imported = loadLists().Library;
    imported.import(fixture(name));
    const loaded = loadLists().Library;
    loaded.load(recordsOf(fixture(name)));
    const shape = lib => JSON.stringify(plain(lib.all()).map(({ id, ...t }) => t).sort((a, b) => a.title.localeCompare(b.title)));
    assert.equal(shape(loaded), shape(imported), name);
  }
});

test('titles from the retired pages: read from their databases and merged in; a missing one is never created', async () => {
  const vm = require('node:vm');
  const databases = {
    WatchlistDB: { items: { watchlist_v1: JSON.stringify([{ title: 'Old watchlist film', imdbID: 'tt0000001', watched: false }]) } },
    RatingsDB: { kv: { titles_v2: [{ title: 'Rated film', imdbID: 'tt0000002', verdict: 'up', want: false }] } }
  };
  const created = [];
  const indexedDB = {
    open(name) {
      const request = {};
      setTimeout(() => {
        const stores = databases[name];
        if (!stores) {
          let aborted = false;
          request.transaction = { abort() { aborted = true; } };
          request.onupgradeneeded();
          if (!aborted) created.push(name);
          request.result = { objectStoreNames: { contains: () => false }, close() {} };
          return request.onsuccess();
        }
        request.result = {
          objectStoreNames: { contains: store => store in stores },
          close() {},
          transaction([store]) {
            const tx = {};
            const objectStore = { transaction: tx, get(key) { const r = { result: stores[store][key] }; return r; } };
            setTimeout(() => tx.oncomplete(), 0);
            return { objectStore: () => objectStore };
          }
        };
        request.onsuccess();
      }, 0);
      return request;
    }
  };
  const context = vm.createContext({ console, crypto, setTimeout, clearTimeout, indexedDB });
  const files = ['js/config.js', 'js/security.js', 'js/title.js', 'js/store.js', 'js/library.js', 'js/app/old-pages.js'];
  vm.runInContext(`${files.map(read).join('\n')}\nthis.app = { Library, OldPages, Store };`, context);
  const { Library, OldPages, Store } = context.app;
  Store.scheduleSave = () => {};
  Library.load([{ title: 'Already here', imdbID: 'tt0000003', want: true }]);

  assert.equal(await OldPages.count(), 2, 'the old watchlist format and the newer one are both read');
  const result = await OldPages.bringIn();
  assert.deepEqual({ ...result }, { added: 2, updated: 0, unchanged: 0 });
  assert.equal(Library.all().length, 3);
  assert.equal((await OldPages.bringIn()).unchanged, 2, 'bringing them in again changes nothing');

  databases.WatchlistDB = undefined;
  delete databases.WatchlistDB;
  assert.equal(await OldPages.count(), 1);
  assert.deepEqual(created, [], 'reading a database that was never made does not make it');
});
