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

test('seen means rated: a watched title, stars or rewatch without a thumb get one; notes alone don\'t', () => {
  const { Title } = loadLists();
  const verdict = fields => Title.sanitize({ title: 'A', ...fields }).verdict;
  assert.equal(verdict({ watched: true }), 'up');
  assert.equal(verdict({ watched: true, stars: 2 }), 'down');
  assert.equal(verdict({ watched: false, stars: 5 }), 'up');
  assert.equal(verdict({ review: 'notes' }), '', 'a note can be about a title still to watch');
  assert.equal(verdict({ want: true, review: 'Recommended by a friend' }), '');
  assert.equal(verdict({ rewatch: true }), 'up');
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
  Library.change(title, { tags: ['x'] });
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
  assert.deepEqual([newer.tags, newer.want, newer.priority, newer.updatedDate], [['new'], false, 'high', NEW]);
  const older = merged(local, { ...local, tag: 'older', updatedDate: OLD });
  assert.deepEqual([older.tags, older.updatedDate], [['old'], MID]);
});

test('merge: a copy without dates (an old file) only fills blanks', () => {
  const result = merged(
    { title: 'A', imdbID: 'tt0000001', verdict: 'up', tag: 'mine', stars: 0, review: '', updatedDate: MID, reviewDate: MID },
    { title: 'A', imdbID: 'tt0000001', watched: true, thumb: 'down', tag: 'theirs', platform: 'Netflix', stars: 2, review: 'meh' }
  );
  assert.deepEqual([result.verdict, result.tags, result.platform, result.review], ['up', ['mine'], 'Netflix', 'meh']);
  assert.equal(result.stars, 2);
  assert.equal(result.updatedDate, MID, 'merging is not an edit');
});

test('merge: fields a file doesn’t carry are kept, even when it is newer', () => {
  // Early ratings backups had no tag, platform or priority
  const result = merged(
    { title: 'A', imdbID: 'tt0000001', tag: 'family', platform: 'Max', priority: 'high', updatedDate: OLD },
    { title: 'A', imdbID: 'tt0000001', verdict: 'up', want: false, updatedAt: NEW, ratedAt: NEW }
  );
  assert.deepEqual([result.tags, result.platform, result.priority, result.verdict], [['family'], 'Max', 'high', 'up']);
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
  assert.deepEqual([kept.stars, kept.reviewDate, kept.tags], [5, MID, ['x']], 'an undated file leaves the review and its date');
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
  const file = JSON.parse(Library.exportText('app'));
  assert.deepEqual([file.app, file.version, file.from, file.titles.length], ['watchlist', 3, 'app', 2]);
  assert.deepEqual([file.count, file.appVersion], [2, 'dev'], 'how many it holds, and the code that wrote it (unstamped here)');
  assert.deepEqual(Object.keys(file.browser), ['name', 'userAgent']);
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
  b.import(JSON.parse(a.exportText().replace('"count": 0', '"count": 1').replace('"titles": []', '"titles": [{"title": "Other"}]')));
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
  Object.assign(watchlist.Library.byImdb('tt0000001'), { updatedDate: OLD });
  Object.assign(ratings.Ratings.get('tt0000001'), { updatedDate: MID, reviewDate: MID });
  watchlist.Library.import(JSON.parse(ratings.Library.exportText()));
  const item = watchlist.Library.byImdb('tt0000001');
  assert.deepEqual(plain([item.verdict, item.want, item.tags]), ['up', false, ['family']]);

  ratings.Ratings.update(film(1), { verdict: 'down' });
  Object.assign(ratings.Ratings.get('tt0000001'), { updatedDate: NEW, reviewDate: NEW });
  watchlist.Library.import(JSON.parse(ratings.Library.exportText()));
  assert.equal(item.verdict, 'down', 'changing your mind carries over too');
});

test('an export says which browser wrote it, from what the browser reports', () => {
  const { Library } = loadLists();
  const named = userAgent => Library.browserInfo(userAgent).name;
  const webkit = 'AppleWebKit/605.1.15 (KHTML, like Gecko)';
  assert.equal(named(`Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) ${webkit} Version/18.0 Mobile/15E148 Safari/604.1`), 'Safari on iPhone');
  assert.equal(named(`Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) ${webkit} Version/18.0 Mobile/15E148 Safari/604.1`), 'Safari on iPad');
  assert.equal(named(`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${webkit} Version/18.0 Safari/605.1.15`), 'Safari on Mac');
  assert.equal(named('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'), 'Chrome on Mac');
  assert.equal(named(`Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) ${webkit} CriOS/130.0 Mobile/15E148 Safari/604.1`), 'Chrome on iPhone');
  assert.equal(named('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'), 'Edge on Windows');
  assert.equal(named('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'), 'Chrome on Android');
  assert.equal(named('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'), 'Firefox on Linux');
  assert.equal(named(''), 'Unknown');
  assert.equal(Library.browserInfo('x'.repeat(1000)).userAgent.length, 300, 'capped');
  assert.deepEqual(plain(Library.browserInfo()), { name: 'Unknown', userAgent: '' }, 'no browser (the tools)');
});

test('import reads this version’s files and the last one’s, and refuses a file that lost titles on the way', () => {
  const { Library } = loadLists();
  assert.equal(Library.import({ app: 'watchlist', version: 3, count: 1, titles: [film(1)] }).added, 1);
  assert.equal(Library.import({ app: 'titles', version: 2, titles: [film(2)] }).added, 1, 'version 2, headed "titles", with no count');
  assert.throws(() => Library.import({ app: 'watchlist', version: 3, count: 3, titles: [film(3)] }), /incomplete: it should hold 3 titles and holds 1/);
  assert.equal(Library.byImdb('tt0000003'), undefined, 'nothing taken from it');
  assert.throws(() => Library.import({ app: 'something-else', titles: [film(4)] }), /Not a watchlist or ratings export/);
});

test('export file names carry the local date and time', () => {
  const { Library } = loadLists();
  assert.equal(Library.fileName('watchlist', 'json', new Date(2026, 9, 31, 21, 5)), 'watchlist-2026-10-31-2105.json');
});

// ---- Loading and migrating ----------------------------------------------------------

test('two stored copies of one title are merged, not dropped', () => {
  const { Library } = loadLists();
  Library.load([{ title: 'A', imdbID: 'tt0000001', tag: 'x' }, { title: 'A', imdbID: 'tt0000001', platform: 'Max' }]);
  assert.equal(Library.all().length, 1);
  assert.deepEqual(plain([Library.all()[0].tags, Library.all()[0].platform]), [['x'], 'Max']);
});

test('dates are kept in one form, so they compare rightly whatever form a file used', () => {
  const { Title } = loadLists();
  const dated = value => Title.sanitize({ title: 'A', updatedDate: value, reviewDate: value });
  assert.equal(dated('2026-03-01T00:00:00Z').updatedDate, '2026-03-01T00:00:00.000Z');
  assert.equal(dated('2026-03-01T01:00:00+02:00').reviewDate, '2026-02-28T23:00:00.000Z', 'an offset becomes UTC');
  assert.equal(dated('2026-03-01').updatedDate, '2026-03-01T00:00:00.000Z', 'a day alone');
  assert.equal(dated(OLD).updatedDate, OLD, 'what the app writes is unchanged');
  for (const bad of ['soon', '', 42, null, '2026-13-45', 'x'.repeat(41)]) assert.equal(dated(bad).updatedDate, '', String(bad));

  // An older copy written another way doesn't win for sorting later as text
  const local = Title.sanitize({ ...film(1), platform: 'Netflix', updatedDate: MID });
  for (const older of ['2026-06-01T00:30:00+01:00', 'May 5, 2026', '2026-06-01T01:00:00+02:00']) {
    const raw = { ...film(1), platform: 'Hulu', updatedDate: older };
    assert.equal(Title.merge(local, Title.sanitize(raw), raw), null, older);
  }
  const raw = { ...film(1), platform: 'Hulu', updatedDate: '2026-05-31T23:30:00-01:00' };
  assert.equal(Title.merge(local, Title.sanitize(raw), raw).platform, 'Hulu', 'and a newer one does');
});

test('a date from the future is dropped, so no file can win every merge from then on', () => {
  const { Title, Library } = loadLists();
  const day = 24 * 60 * 60 * 1000;
  const ahead = ms => new Date(Date.now() + ms).toISOString();
  assert.equal(Title.sanitize({ title: 'A', updatedDate: '9999-12-31' }).updatedDate, '');
  assert.equal(Title.sanitize({ title: 'A', reviewDate: ahead(3 * day) }).reviewDate, '');
  const soon = ahead(day / 2);
  assert.equal(Title.sanitize({ title: 'A', updatedDate: soon }).updatedDate, soon, 'another device’s clock, a little fast, is kept');

  Library.load([{ ...film(1), platform: 'Netflix', verdict: 'up', stars: 4, updatedDate: MID, reviewDate: MID }]);
  Library.import([{ ...film(1), platform: 'Elsewhere', verdict: 'down', stars: 1, updatedDate: '9999-12-31', reviewDate: '9999-12-31' }]);
  const kept = Library.byImdb('tt0000001');
  assert.deepEqual(plain([kept.platform, kept.verdict, kept.stars, kept.updatedDate]), ['Netflix', 'up', 4, MID], 'undated, it only fills blanks');
});

test('an import can be undone: the titles as they were are kept, and put back; so can the undo', async () => {
  const { Library, Store } = loadLists();
  Library.load([{ ...film(1), platform: 'Netflix', updatedDate: OLD }, { id: 'm', title: 'Manual entry', want: true }]);
  assert.equal(await Library.snapshot(), null, 'nothing to restore yet');

  Library.import([{ ...film(1), platform: 'Hulu', updatedDate: NEW }, film(2)]);
  assert.equal(Library.all().length, 3);
  assert.equal(Library.byImdb('tt0000001').platform, 'Hulu');
  const snapshot = await Library.snapshot();
  assert.deepEqual([snapshot.reason, snapshot.count], ['import', 2]);
  assert.ok(!isNaN(Date.parse(snapshot.date)));

  assert.equal(await Library.restoreSnapshot(), 2);
  assert.deepEqual(plain(Library.all().map(t => [t.title, t.platform])), [['Film 1', 'Netflix'], ['Manual entry', '']]);
  assert.equal(Library.byImdb('tt0000002'), undefined, 'and the indexes follow');
  assert.equal(Library.get('m').title, 'Manual entry');
  assert.deepEqual(plain(Store.saved.get('titles_v2')).map(t => t.title), ['Film 1', 'Manual entry'], 'saved');

  assert.equal((await Library.snapshot()).reason, 'restore');
  assert.equal(await Library.restoreSnapshot(), 3, 'undoing the undo brings the import back');
  assert.equal(Library.byImdb('tt0000001').platform, 'Hulu');
});

test('snapshots: an import that changes nothing keeps none; cleanup keeps one; nothing is restored while saving is stopped', async () => {
  const { Library, Store } = loadLists();
  Library.load([{ ...film(1), tags: ['art'], updatedDate: MID }, { ...film(2), tags: ['Art'], updatedDate: MID }]);
  Library.import([{ ...film(1), updatedDate: OLD }]);
  assert.equal(await Library.snapshot(), null, 'unchanged');
  assert.throws(() => Library.import({ nothing: 'here' }));
  assert.equal(await Library.snapshot(), null, 'failed');

  assert.equal(Library.cleanup().changed, true);
  assert.equal((await Library.snapshot()).reason, 'cleanup');
  Store.saved.set('titles_snapshot', { reason: 'import', date: 'x', titles: 'not a list' });
  assert.equal(await Library.snapshot(), null, 'a snapshot that isn’t one is ignored');
  await assert.rejects(Library.restoreSnapshot(), /Nothing to restore/);

  Store.saved.set('titles_snapshot', { reason: 'import', date: OLD, titles: [] });
  Store.block('Open in another tab');
  await assert.rejects(Library.restoreSnapshot(), /another tab/);
  assert.equal(Library.all().length, 2, 'left as they are');
});

test('titles saved by a newer version of the app are shown but never changed by this one', async () => {
  const app = loadLists();
  app.Store.saved.set('titles_v2', [{ id: 'a', title: 'A', type: 'podcast', somethingNew: { kept: true } }]);
  app.Store.saved.set('schema', app.CONFIG.STORAGE.SCHEMA + 1);
  await app.ItemManager.load();
  assert.equal(app.Library.all().length, 1, 'shown');
  assert.match(app.Store.blocked, /newer version/);
  app.Library.change(app.Library.get('a'), { stars: 5 });
  assert.deepEqual(plain(app.Store.saved.get('titles_v2')), [{ id: 'a', title: 'A', type: 'podcast', somethingNew: { kept: true } }], 'storage untouched');
});

test('the stored shape’s version is written with the first save, not on opening', async () => {
  const app = loadLists();
  app.Store.saved.set('titles_v2', [{ id: 'a', title: 'A' }]);
  await app.ItemManager.load();
  assert.equal(app.Store.blocked, '');
  assert.deepEqual([...app.Store.saved.keys()], ['titles_v2'], 'opening writes nothing');
  app.Library.change(app.Library.get('a'), { stars: 5 });
  assert.equal(app.Store.saved.get('schema'), app.CONFIG.STORAGE.SCHEMA);
});

test('a stored record that can’t be read as a title is set aside, not lost without a word', async () => {
  const app = loadLists();
  const odd = { id: 'odd', title: '', imdbID: 'tt0000009', review: 'my notes', verdict: 'up' };
  app.Store.saved.set('titles_v2', [{ id: 'a', title: 'A' }, odd, 'not a record']);
  const warn = console.warn;
  console.warn = () => {};
  try {
    await app.ItemManager.load();
  } finally {
    console.warn = warn;
  }
  assert.equal(app.Library.all().length, 1);
  assert.deepEqual(plain(app.Library.unreadable), [odd, 'not a record']);
  const [asideKey] = [...app.Store.saved.keys()].filter(key => key.startsWith('titles_unreadable:'));
  assert.deepEqual(plain(app.Store.saved.get(asideKey)), [odd, 'not a record'], 'kept in the database, under its own key');
  assert.deepEqual(plain(app.Store.saved.get('titles_v2')).length, 3, 'and the titles are only rewritten by a change');
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
  tag: (old, t) => t.tags.join(', ') === old,
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
  if (file.titles) return file.titles;
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

test('tags: from a list, comma-separated text or an old single tag; cleaned, each once', () => {
  const { Title } = loadLists();
  const tags = raw => plain(Title.sanitize({ title: 'A', ...raw }).tags);
  assert.deepEqual(tags({ tags: ['art', 'Family'] }), ['art', 'Family']);
  assert.deepEqual(tags({ tags: ' #art,  sci   fi ,ART,, ' }), ['art', 'sci fi'], 'text is split and cleaned');
  assert.deepEqual(tags({ tags: ['a, b', 'c', 7, null, {}] }), ['a', 'b', 'c', '7'], 'no tag holds a comma; non-text is dropped');
  assert.deepEqual(tags({ tag: 'family, friends' }), ['family', 'friends'], 'an old tag');
  assert.deepEqual(tags({ tag: 'old', tags: ['new'] }), ['new'], 'tags wins over an old tag');
  assert.deepEqual(tags({}), []);
  const many = Array.from({ length: 50 }, (_, i) => `t${i}`);
  assert.equal(tags({ tags: many }).length, 30, 'kept to the limit');
  assert.equal(tags({ tags: ['x'.repeat(500)] })[0].length, 100, 'each to its length');
});

test('tags round-trip through a file; a newer copy replaces them, so removing one sticks', () => {
  const { Library } = loadLists();
  Library.load([{ id: 'a', title: 'A', imdbID: 'tt0000001', want: true, tags: ['art', 'family'], updatedDate: MID }]);
  const file = JSON.parse(Library.exportText('test'));
  assert.deepEqual(plain(file.titles[0].tags), ['art', 'family']);
  assert.equal('tag' in file.titles[0], false, 'one field, not two');
  const other = loadLists().Library;
  other.import(file);
  assert.deepEqual(plain(other.all()[0].tags), ['art', 'family']);

  file.titles[0].tags = ['art'];
  file.titles[0].updatedDate = NEW;
  other.import(file);
  assert.deepEqual(plain(other.all()[0].tags), ['art'], 'newer file wins, whole');
  file.titles[0].tags = ['stale'];
  file.titles[0].updatedDate = OLD;
  assert.equal(other.import(file).unchanged, 1, 'an older file changes nothing');
  assert.deepEqual(plain(other.all()[0].tags), ['art']);
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
