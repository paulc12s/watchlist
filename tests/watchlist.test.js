// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Tests for the watchlist page: search, OMDb, lists, thumbs and status.
// Storing, merging, importing and exporting are shared with the ratings page
// and tested in tests/library.test.js. Run with: node --test tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWatchlist, plain } = require('./helpers');

const ids = results => plain(results.map(r => r.imdbID));
const titles = app => plain(app.ItemManager.getFiltered().map(i => i.title));

test('html escapes interpolated values but not nested html', () => {
  const { html } = loadWatchlist();
  const name = '<img src=x onerror=alert(1)>';
  assert.equal(String(html`<b title="${'"q"'}">${name}</b>`),
    '<b title="&quot;q&quot;">&lt;img src=x onerror=alert(1)&gt;</b>');
  assert.equal(String(html`<ul>${['a', '<b>'].map(x => html`<li>${x}</li>`)}</ul>`),
    '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
  assert.equal(String(html`${null}${undefined}${false}`), '');
});

// ---- Search -------------------------------------------------------------------

test('parseQuery recognises IMDb links, trailing years, and title-numbers', () => {
  const { MovieAPI } = loadWatchlist();
  assert.equal(MovieAPI.parseQuery('https://m.imdb.com/title/tt31450459/?ref_=x').imdbID, 'tt31450459');
  assert.equal(MovieAPI.parseQuery('dune 1984').year, '1984');
  assert.equal(MovieAPI.parseQuery('dune (1984)').title, 'dune');
  assert.equal(MovieAPI.parseQuery('Blade Runner 2049').year, undefined);
  assert.equal(MovieAPI.parseQuery('1917').title, '1917');
  assert.equal(MovieAPI.parseQuery('Death Race 2000').fullQuery, 'Death Race 2000');
});

test('rank puts exact titles first, then requested year, then recent releases', () => {
  const { MovieAPI } = loadWatchlist();
  const thisYear = String(new Date().getFullYear());
  const candidates = [
    { imdbID: '1', title: 'Gold Digger', year: thisYear },
    { imdbID: '2', title: 'Digger', year: '2020' },
    { imdbID: '3', title: 'Digger', year: '1993' },
    { imdbID: '4', title: 'Digger', year: thisYear },
    { imdbID: '2', title: 'Digger', year: '2020' }
  ];
  assert.deepEqual(ids(MovieAPI.rank(candidates, { title: 'digger' })), ['4', '2', '3', '1']);
  assert.equal(ids(MovieAPI.rank(candidates, { title: 'digger', year: '1993' }))[0], '3');
  assert.equal(MovieAPI.matchScore('the office', 'office'), 3);
  assert.equal(MovieAPI.normalizeTitle('Amélie & Co.'), 'amelie and co');
});

// ---- OMDb (shared by both pages) ---------------------------------------------------

// OMDb's responses are untrusted input
const hostileOmdb = {
  Response: 'True',
  imdbID: 'tt1234567',
  Title: '<img src=x onerror=alert(1)>',
  Type: 'movie',
  Year: { toString: () => '1999' },
  Genre: ['Drama'],
  imdbRating: '99',
  Plot: 'x'.repeat(100000),
  Poster: 'javascript:alert(1)',
  Director: null,
  Actors: 42
};

test('OMDb details: non-strings dropped, lengths capped, bad ratings and unsafe posters removed', () => {
  const { OMDb, Security, Title } = loadWatchlist();
  const details = OMDb.parseDetails(hostileOmdb);
  assert.deepEqual(plain([details.poster, details.year, details.genres, details.imdbRating, details.director, details.actors]),
    ['', null, [], null, '', '']);
  assert.equal(details.plot.length, 1000);
  // Markup in a title stays text once rendered and saved
  assert.equal(details.title, hostileOmdb.Title);
  assert.equal(Security.escapeHtml(details.title), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(Title.sanitize({ ...details, poster: 'data:text/html,x' }).poster, '');
  assert.equal(OMDb.parseDetails({ ...hostileOmdb, imdbRating: '7.0' }).imdbRating, 7);
  assert.equal(OMDb.parseDetails({ ...hostileOmdb, Type: 'episode' }).type, 'series');
});

test('OMDb details and search results without a real IMDb ID are dropped', async () => {
  const app = loadWatchlist();
  assert.equal(app.OMDb.parseDetails({ ...hostileOmdb, imdbID: '../../evil' }), null);
  assert.equal(app.OMDb.parseDetails({ ...hostileOmdb, Type: 'game' }), null);
  app.setFetch(async () => ({
    status: 200,
    json: async () => ({
      Response: 'True',
      totalResults: '3',
      Search: [
        { imdbID: 'tt7654321', Title: 'Fine', Type: 'movie', Year: '2001', Poster: 'https://m.media-amazon.com/p.jpg' },
        { imdbID: '"><script>', Title: 'Bad ID', Type: 'movie' },
        null,
        { imdbID: 'tt7654322', Title: { evil: true }, Type: 'movie', Poster: 'javascript:alert(1)' }
      ]
    })
  }));
  const { items } = await app.MovieAPI.searchPage('fine', '', '', 1);
  assert.deepEqual(plain(items.map(i => [i.imdbID, i.title, i.poster])), [
    ['tt7654321', 'Fine', 'https://m.media-amazon.com/p.jpg'],
    ['tt7654322', 'Unknown', '']
  ]);
});

// A fake OMDb that rejects the app's own key the way OMDb does
function fakeOmdb(app, rejection) {
  const keysUsed = [];
  app.setFetch(async url => {
    const key = new URL(url).searchParams.get('apikey');
    keysUsed.push(key);
    if (key === app.CONFIG.API.OMDB_KEY && rejection) return rejection;
    return { status: 200, json: async () => ({ Response: 'True', imdbID: new URL(url).searchParams.get('i'), Title: 'Shawshank', Type: 'movie' }) };
  });
  return keysUsed;
}
const invalidKey = { status: 401, json: async () => ({ Response: 'False', Error: 'Invalid API key!' }) };
const overLimit = { status: 200, json: async () => ({ Response: 'False', Error: 'Request limit reached!' }) };

test('OMDb uses the app key, and switches to the fallback key for the visit if it is rejected', async () => {
  for (const rejection of [invalidKey, overLimit]) {
    const app = loadWatchlist();
    const keysUsed = fakeOmdb(app, rejection);
    assert.equal((await app.MovieAPI.getDetails('tt0111161')).title, 'Shawshank');
    assert.equal((await app.MovieAPI.getDetails('tt0068646')).title, 'Shawshank');
    const { OMDB_KEY, OMDB_FALLBACK_KEY } = app.CONFIG.API;
    assert.deepEqual(plain(keysUsed), [OMDB_KEY, OMDB_FALLBACK_KEY, OMDB_FALLBACK_KEY]);
  }
});

test('OMDb with a working key never touches the fallback, and asks once per title', async () => {
  const app = loadWatchlist();
  const keysUsed = fakeOmdb(app, null);
  await app.MovieAPI.getDetails('tt0111161');
  await app.OMDb.details({ i: 'tt0111161' });
  assert.deepEqual(plain(keysUsed), [app.CONFIG.API.OMDB_KEY]);
});

test('OMDb reports a key problem when the fallback key fails too', async () => {
  const app = loadWatchlist();
  app.setFetch(async () => invalidKey);
  await assert.rejects(app.MovieAPI.getDetails('tt0111161'), /Invalid API key/);
});

// ---- Lists ------------------------------------------------------------------------

function withTitles(list) {
  const app = loadWatchlist();
  app.Library.load(list);
  return app;
}

test('getFiltered respects priority, type, the watched list and quick search', () => {
  const app = withTitles([
    { title: 'Now Playing', priority: 'watching', want: true },
    { title: 'Future', priority: 'someday', want: true },
    { title: 'Show', type: 'series', priority: 'high', want: true },
    { title: 'Seen', priority: 'high', verdict: 'up' },
    { title: 'Skipped on the ratings page', imdbID: 'tt0000009', verdict: 'skip' }
  ]);
  const { state } = app;
  state.filter = 'watching';
  assert.deepEqual(titles(app), ['Now Playing']);
  state.filter = 'medium';
  assert.deepEqual(titles(app), ['Future'], 'unknown priorities show as medium');
  state.filter = 'series';
  assert.deepEqual(titles(app), ['Show']);
  state.filter = 'all';
  state.list = 'watched';
  assert.deepEqual(titles(app), ['Seen'], 'titles only the ratings page cares about stay hidden');
  state.list = 'queue';
  state.quickSearch = 'now';
  assert.deepEqual(titles(app), ['Now Playing']);
});

test('rewatch filter applies to both the active and watched lists', () => {
  const app = withTitles([
    { title: 'Again Soon', rewatch: true, want: true },
    { title: 'Not Yet', want: true },
    { title: 'Loved It', rewatch: true, verdict: 'up' },
    { title: 'Once Was Enough', verdict: 'up' }
  ]);
  app.state.filter = 'rewatch';
  assert.deepEqual(titles(app), ['Again Soon']);
  app.state.list = 'watched';
  assert.deepEqual(titles(app), ['Loved It']);
});

test('👍 and 👎 lists show every title with that thumb, combined with other filters', () => {
  const app = withTitles([
    { title: 'Seen, unrated', watched: true },
    { title: 'Loved show', type: 'series', verdict: 'up' },
    { title: 'Disliked', verdict: 'down' },
    { title: 'Low stars', watched: true, stars: 1 },
    { title: 'Queued, rated elsewhere', want: true, verdict: 'up' },
    { title: 'Queued', want: true }
  ]);
  const { state } = app;
  state.list = 'up';
  assert.deepEqual(titles(app), ['Seen, unrated', 'Loved show', 'Queued, rated elsewhere']);
  state.list = 'down';
  assert.deepEqual(titles(app), ['Disliked', 'Low stars']);
  state.list = 'up';
  state.filter = 'series';
  assert.deepEqual(titles(app), ['Loved show']);
  state.filter = 'all';
  state.list = 'queue';
  assert.deepEqual(titles(app), ['Queued, rated elsewhere', 'Queued']);
});

test('Rated lists every rated title, narrows by verdict, and sorts', () => {
  const app = withTitles([
    { id: 'a', title: 'Alpha', year: 1990, want: false, verdict: 'up', imdbRating: 7, reviewDate: '2026-01-01T00:00:00.000Z' },
    { id: 'b', title: 'beta', year: 2010, want: false, verdict: 'up', stars: 5, imdbRating: 8, reviewDate: '2026-03-01T00:00:00.000Z' },
    { id: 'c', title: 'Gamma', year: 2001, want: true, verdict: 'down', imdbRating: 6, reviewDate: '2026-02-01T00:00:00.000Z' },
    { id: 'd', title: 'Delta', year: 2020, want: true },
    { id: 'e', title: 'Epsilon', year: 1985, want: false, verdict: 'skip' },
    { id: 'f', title: 'Zeta', year: 2005, want: false, verdict: 'up', stars: 3, reviewDate: '2026-04-01T00:00:00.000Z' }
  ]);
  const { state, ItemManager } = app;
  const sorted = sort => plain(ItemManager.sorted(ItemManager.getFiltered(), sort).map(t => t.title));
  state.list = 'rated';
  assert.deepEqual(sorted('recent'), ['Zeta', 'beta', 'Gamma', 'Alpha'], 'rated, even if still on the list; not skips or unrated');
  assert.deepEqual(sorted('rating'), ['beta', 'Alpha', 'Zeta', 'Gamma'], '❤️, 👍, 3★, 👎');
  assert.deepEqual(sorted('title'), ['Alpha', 'beta', 'Gamma', 'Zeta'], 'ignoring case');
  assert.deepEqual(sorted('newest'), ['beta', 'Zeta', 'Gamma', 'Alpha']);
  assert.deepEqual(sorted('oldest'), ['Alpha', 'Gamma', 'Zeta', 'beta']);
  assert.deepEqual(sorted('imdb'), ['beta', 'Alpha', 'Gamma', 'Zeta'], 'no IMDb rating last');
  state.verdict = 'loved';
  assert.deepEqual(sorted('recent'), ['beta']);
  state.verdict = 'up';
  assert.deepEqual(sorted('recent'), ['Zeta', 'beta', 'Alpha']);
  state.verdict = 'down';
  assert.deepEqual(sorted('recent'), ['Gamma']);
  state.list = 'watched';
  assert.deepEqual(sorted('recent'), ['Zeta', 'beta', 'Alpha'], 'the verdict filter only applies to Rated');
  state.verdict = 'all';

  // The Rated mode keeps its own view state: the watchlist's search and list don't touch it
  state.quickSearch = 'zeta';
  const rated = { list: 'rated', filter: 'all', quickSearch: '', verdict: 'down', sort: 'recent' };
  assert.deepEqual(plain(ItemManager.getFiltered(rated).map(t => t.title)), ['Gamma']);
  assert.deepEqual(plain(ItemManager.getFiltered().map(t => t.title)), ['Zeta'], 'and the watchlist keeps its own');
  state.quickSearch = '';
});

test('Not rated: watched titles with only the default 👍; rating one moves it to Rated', () => {
  const app = withTitles([
    { id: 'w', title: 'Watched long ago', watched: true },
    { id: 'r', title: 'Rated', want: false, verdict: 'up', reviewDate: '2026-01-01T00:00:00.000Z' },
    { id: 's', title: 'Starred, undated', want: false, verdict: 'up', stars: 4 }
  ]);
  const { ItemManager, UndoManager, Library, Title } = app;
  const list = name => plain(ItemManager.getFiltered({ list: name, filter: 'all', quickSearch: '', verdict: 'all' }).map(t => t.title));
  assert.deepEqual(list('unrated'), ['Watched long ago'], 'stars count as a rating even without a date');
  assert.deepEqual(list('rated'), ['Rated', 'Starred, undated']);

  ItemManager.rateWatched('w', 'up');
  const w = Library.get('w');
  assert.deepEqual(plain([w.verdict, w.want, Title.isUnrated(w)]), ['up', false, false], '👍 on the default 👍 still counts');
  assert.ok(w.reviewDate);
  assert.deepEqual(list('unrated'), []);
  UndoManager.undo();
  assert.deepEqual(list('unrated'), ['Watched long ago'], 'undo puts it back');

  ItemManager.rateWatched('w', 'love');
  assert.deepEqual(plain([w.verdict, w.stars]), ['up', 5]);
  ItemManager.rateWatched('w', 'down');
  assert.equal(w.verdict, 'down');
});

test('tags: one label however typed, a chip per name with its count', () => {
  const app = withTitles([
    { id: 'a', title: 'A', want: true, tag: 'art' },
    { id: 'b', title: 'B', want: true, tag: 'Art' },
    { id: 'c', title: 'C', want: true, tag: '#art' },
    { id: 'd', title: 'D', want: true, tag: 'britbox' },
    { id: 'e', title: 'E', want: true, type: 'youtube', platform: 'YouTube' },
    { id: 'f', title: 'F', want: true, type: 'youtube', tag: 'youtube' },
    { id: 'g', title: 'G', want: true, platform: 'netflix' }
  ]);
  const { ItemManager, Library, Title } = app;
  assert.equal(Library.get('c').tag, 'art', 'a leading # is dropped when stored');
  assert.equal(Title.cleanLabel('  #Sci   fi '), 'Sci fi');

  const chips = plain(ItemManager.chips(ItemManager.shown()).map(c => `${c.label} ${c.count}`));
  assert.deepEqual(chips, ['All 7', 'Films 5', 'YouTube 2', 'netflix 1', 'Art 3', 'britbox 1'],
    'YouTube once (type, platform and tag together); art in its capitalised spelling');
  const only = key => plain(ItemManager.getFiltered({ list: 'queue', filter: key, quickSearch: '' }).map(t => t.id));
  assert.deepEqual(only('label:art'), ['a', 'b', 'c']);
  assert.deepEqual(only('label:youtube'), ['e', 'f']);

  assert.equal(Library.labelName('tag', '#ART '), 'Art', 'typed tags take the spelling in use');
  assert.equal(Library.labelName('tag', 'new one'), 'new one', 'a new tag is kept as typed');
  assert.equal(Library.labelName('tag', 'BBC Four'), 'BBC Four', 'other capitals are kept');
  assert.equal(Library.labelName('platform', 'NETFLIX'), 'netflix');
  assert.equal(Library.labelName('platform', 'disney+'), 'Disney+', 'or the known platform');
});

test('tags are stored in one spelling on every add, edit and import', () => {
  const app = withTitles([
    { id: 'a', title: 'A', want: true, tag: 'Art' },
    { id: 'b', title: 'B', want: true, tag: 'art' },
    { id: 'c', title: 'C', want: true, tag: 'Britbox' }
  ]);
  const { ItemManager, Library } = app;
  ItemManager.add({ title: 'New', tag: '#ART' });
  assert.equal(Library.all()[0].tag, 'Art', 'add');
  ItemManager.update('b', { priority: 'high' });
  assert.equal(Library.get('b').tag, 'Art', 'editing anything tidies an old spelling');
  ItemManager.update('a', { tag: 'BRITBOX' });
  assert.equal(Library.get('a').tag, 'Britbox', 'edit: a tag others use keeps their spelling');
  ItemManager.update('c', { tag: 'BritBox' });
  assert.equal(Library.get('c').tag, 'Britbox', 'still used by A, so it stays');

  Library.import({ app: 'titles', version: 2, titles: [
    { title: 'D', tag: 'art', want: true }, { title: 'E', tag: 'family', want: true }, { title: 'F', tag: 'FAMILY', want: true },
    { title: 'G', platform: 'netflix', want: true }
  ] });
  const tag = name => Library.all().find(t => t.title === name);
  assert.deepEqual(plain(['D', 'E', 'F'].map(n => tag(n).tag)), ['Art', 'family', 'family'], 'import, within the file too');
  assert.equal(tag('G').platform, 'Netflix', 'a new platform matches the known list');
  const spellings = new Set(Library.all().map(t => t.tag).filter(Boolean));
  assert.deepEqual([...spellings].sort(), ['Art', 'Britbox', 'family']);
});

test('cleanup: one spelling per tag, repaired records, merged copies, unique IDs; dates kept', () => {
  const app = withTitles([
    { id: 'a', title: 'A', want: true, tag: 'art', updatedDate: '2026-01-01T00:00:00.000Z' },
    { id: 'b', title: 'B', want: true, tag: 'art' },
    { id: 'c', title: 'C', want: true, tag: 'Art' },
    { id: 'd', title: 'D', want: true, platform: 'netflix' },
    { id: 'e', title: 'E', want: true, platform: 'Netflix' }
  ]);
  const { Library, Store } = app;
  // What an older version or a hand-edited file could leave in memory
  Library.titles.push({ ...Library.get('a'), id: 'a', imdbID: 'tt0000099', title: 'A again', tag: '#ART' });
  Library.titles.push({ ...Library.get('c'), imdbRating: 99 });
  const report = plain(Library.cleanup());
  assert.equal(report.titles, 7);
  assert.equal(report.repaired, 2, 'the # and the impossible rating');
  assert.equal(report.merged, 1, 'the second copy of C');
  assert.equal(report.renumbered, 1, 'the second title with ID a');
  assert.deepEqual(report.renamed.map(r => `${r.change} (${r.count})`), ['art → Art (2)', 'ART → Art (1)', 'netflix → Netflix (1)']);
  assert.deepEqual(plain([...new Set(Library.all().map(t => t.tag).filter(Boolean))]), ['Art']);
  assert.equal(Library.get('a').updatedDate, '2026-01-01T00:00:00.000Z', 'tidying is not an edit');
  assert.equal(Store.saved.get('titles_v2').length, 6, 'saved once');
  assert.equal(Library.cleanup().changed, false, 'a second run finds nothing');
});

// ---- Thumbs and edits -------------------------------------------------------------

test('card thumbs: a thumb marks watched; tapping the shown thumb puts it back on the list', () => {
  const app = withTitles([{ id: 'a', title: 'A', want: true }]);
  const { ItemManager, UndoManager, Library } = app;
  const a = Library.get('a');

  ItemManager.rate('a', 'down');
  assert.deepEqual(plain([a.want, a.verdict]), [false, 'down']);
  assert.ok(a.reviewDate, 'rating it dates the review');
  ItemManager.rate('a', 'up');
  assert.deepEqual(plain([a.want, a.verdict]), [false, 'up']);
  ItemManager.rate('a', 'up');
  assert.deepEqual(plain([a.want, a.verdict]), [true, '']);
  UndoManager.undo();
  assert.deepEqual(plain([a.want, a.verdict]), [false, 'up']);
});

test('❤️ means watched, 👍 and five stars; tapping it again leaves just the 👍', () => {
  const app = withTitles([{ id: 'a', title: 'A', want: true, stars: 3 }, { id: 'b', title: 'B', want: false, verdict: 'up' }]);
  const { ItemManager, UndoManager, Library, state } = app;
  const a = Library.get('a');

  ItemManager.love('a');
  assert.deepEqual(plain([a.want, a.verdict, a.stars]), [false, 'up', 5]);
  assert.ok(a.reviewDate, 'loving it dates the review');
  state.list = 'loved';
  assert.deepEqual(titles(app), ['A']);

  ItemManager.love('a');
  assert.deepEqual(plain([a.want, a.verdict, a.stars]), [false, 'up', 0]);
  assert.deepEqual(titles(app), []);
  UndoManager.undo();
  assert.deepEqual(plain([a.want, a.verdict, a.stars]), [false, 'up', 5]);
  // Five stars given any other way count as loved too
  ItemManager.update('b', { stars: 5 });
  assert.deepEqual(titles(app), ['A', 'B']);
});

test('a title rated elsewhere and still on the list keeps its review date when you mark it watched', () => {
  const app = withTitles([{ id: 'a', title: 'A', want: true, verdict: 'up', reviewDate: '2026-01-01T00:00:00.000Z' }]);
  app.ItemManager.rate('a', 'up');
  const a = app.Library.get('a');
  assert.deepEqual(plain([a.want, a.reviewDate]), [false, '2026-01-01T00:00:00.000Z']);
});

test('edits date the review only when the review changes, and undo restores everything', () => {
  const app = withTitles([{ id: 'a', title: 'A', want: true }]);
  const { ItemManager, UndoManager, Library } = app;
  const a = Library.get('a');
  ItemManager.update('a', { tag: 'x', priority: 'high' });
  assert.equal(a.reviewDate, '', 'organising is not reviewing');
  ItemManager.update('a', { stars: 4 });
  assert.ok(a.reviewDate);
  UndoManager.undo();
  assert.deepEqual(plain([a.stars, a.reviewDate, a.tag]), [0, '', 'x']);
});

test('delete removes the title, and undo puts it back where it was', () => {
  const app = withTitles([{ id: 'a', title: 'A', want: true }, { id: 'b', title: 'B', want: true }]);
  app.ItemManager.delete('a');
  assert.deepEqual(plain(app.Library.all().map(t => t.id)), ['b']);
  app.UndoManager.undo();
  assert.deepEqual(plain(app.Library.all().map(t => t.id)), ['a', 'b']);
});

test('adding puts the title on the list and refuses duplicates', () => {
  const app = loadWatchlist();
  assert.equal(app.ItemManager.add({ title: 'Dune', imdbID: 'tt1160419', genres: 'Action, Sci-Fi', imdbRating: '8.0' }), true);
  const dune = app.Library.byImdb('tt1160419');
  assert.deepEqual(plain([dune.want, dune.genres, dune.imdbRating]), [true, ['Action', 'Sci-Fi'], 8]);
  assert.equal(app.ItemManager.add({ title: 'Dune', imdbID: 'tt1160419' }), false);
  assert.equal(app.statuses.at(-1), 'duplicate item');
});

// ---- Import, export and status -------------------------------------------------------

test('import reports what changed, and a failure stays on screen until the next good import', () => {
  const app = loadWatchlist();
  assert.equal(app.ItemManager.import(JSON.stringify({ something: 1 })), false);
  assert.match(app.errors.at(-1), /Import failed: Not a watchlist or ratings export/);
  assert.equal(app.ItemManager.import('not json'), false);
  assert.match(app.errors.at(-1), /Invalid JSON format/);
  assert.equal(app.ItemManager.import(JSON.stringify([{ title: 'A', imdbID: 'tt0000001' }])), true);
  assert.equal(app.errors.at(-1), null);
  assert.equal(app.statuses.at(-1), 'Added 1 item');
});

test('status shows saved once stored titles have loaded, including an empty list', async () => {
  for (const stored of [JSON.stringify([{ title: 'A' }]), '[]', undefined]) {
    const app = loadWatchlist();
    if (stored !== undefined) app.Store.saved.set('watchlist_v1', stored);
    await app.ItemManager.load();
    assert.equal(app.statuses.at(-1), 'saved', `stored: ${stored}`);
  }
  const broken = loadWatchlist();
  broken.Store.saved.set('watchlist_v1', '{not json');
  await broken.ItemManager.load();
  assert.equal(broken.statuses.at(-1), 'load failed');
});

test('titles that fail to load are never overwritten: nothing saves for the rest of the visit', async () => {
  const app = loadWatchlist();
  app.Store.saved.set('titles_v2', { not: 'a list' });
  await app.ItemManager.load();
  assert.equal(app.Library.all().length, 0, 'the page carries on empty');
  assert.ok(app.Store.blocked, 'with saving stopped');
  app.ItemManager.add({ title: 'New', want: true });
  assert.deepEqual(plain(app.Store.saved.get('titles_v2')), { not: 'a list' }, 'storage untouched');
});

test('a title can be added as already seen, with its thumb', () => {
  const app = loadWatchlist();
  assert.equal(app.ItemManager.add({ title: 'Arrival', imdbID: 'tt2543164', verdict: 'up', want: false }), true);
  const t = app.Library.byImdb('tt2543164');
  assert.deepEqual(plain([t.want, t.verdict]), [false, 'up']);
  assert.ok(t.reviewDate, 'adding it as seen dates the review');
  app.state.list = 'watched';
  assert.deepEqual(plain(app.ItemManager.getFiltered().map(i => i.title)), ['Arrival']);
});
