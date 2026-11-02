// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Tests for Watchlist and Rated modes: search, OMDb, lists, thumbs, tags and status.
// Storing, merging, importing and exporting are tested in tests/library.test.js. Run with: node --test tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, SHARED, loadLists, plain } = require('./helpers');

const ids = results => plain(results.map(r => r.imdbID));
const titles = app => plain(app.ItemManager.getFiltered().map(i => i.title));

test('html escapes interpolated values but not nested html', () => {
  const { html } = loadLists();
  const name = '<img src=x onerror=alert(1)>';
  assert.equal(String(html`<b title="${'"q"'}">${name}</b>`),
    '<b title="&quot;q&quot;">&lt;img src=x onerror=alert(1)&gt;</b>');
  assert.equal(String(html`<ul>${['a', '<b>'].map(x => html`<li>${x}</li>`)}</ul>`),
    '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
  assert.equal(String(html`${null}${undefined}${false}`), '');
});

// ---- Search -------------------------------------------------------------------

test('parseQuery recognises IMDb links, trailing years, and title-numbers', () => {
  const { MovieAPI } = loadLists();
  assert.equal(MovieAPI.parseQuery('https://m.imdb.com/title/tt31450459/?ref_=x').imdbID, 'tt31450459');
  assert.equal(MovieAPI.parseQuery('dune 1984').year, '1984');
  assert.equal(MovieAPI.parseQuery('dune (1984)').title, 'dune');
  assert.equal(MovieAPI.parseQuery('Blade Runner 2049').year, undefined);
  assert.equal(MovieAPI.parseQuery('1917').title, '1917');
  assert.equal(MovieAPI.parseQuery('Death Race 2000').fullQuery, 'Death Race 2000');
});

test('rank puts exact titles first, then requested year, then recent releases', () => {
  const { MovieAPI } = loadLists();
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
  const { OMDb, Security, Title } = loadLists();
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
  const app = loadLists();
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
    const app = loadLists();
    const keysUsed = fakeOmdb(app, rejection);
    assert.equal((await app.MovieAPI.getDetails('tt0111161')).title, 'Shawshank');
    assert.equal((await app.MovieAPI.getDetails('tt0068646')).title, 'Shawshank');
    const { OMDB_KEY, OMDB_FALLBACK_KEY } = app.CONFIG.API;
    assert.deepEqual(plain(keysUsed), [OMDB_KEY, OMDB_FALLBACK_KEY, OMDB_FALLBACK_KEY]);
  }
});

test('OMDb with a working key never touches the fallback, and asks once per title', async () => {
  const app = loadLists();
  const keysUsed = fakeOmdb(app, null);
  await app.MovieAPI.getDetails('tt0111161');
  await app.OMDb.details({ i: 'tt0111161' });
  assert.deepEqual(plain(keysUsed), [app.CONFIG.API.OMDB_KEY]);
});

test('OMDb reports a key problem when the fallback key fails too', async () => {
  const app = loadLists();
  app.setFetch(async () => invalidKey);
  await assert.rejects(app.MovieAPI.getDetails('tt0111161'), /Invalid API key/);
});

// localStorage as the browser has it, for the personal key
function memoryLocalStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  };
}

test('OMDb uses your own key instead of the app’s, from this device, falling back to the demo key', async () => {
  const localStorage = memoryLocalStorage({ omdb_key: 'aaaabbbb' });
  const app = load([...SHARED, 'js/movie-api.js'], 'CONFIG, Store, OMDb, MovieAPI', { localStorage });
  assert.equal(app.OMDb.personalKey, 'aaaabbbb');
  const keysUsed = [];
  app.setFetch(async url => {
    const key = new URL(url).searchParams.get('apikey');
    keysUsed.push(key);
    return key === 'aaaabbbb' ? overLimit : { status: 200, json: async () => ({ Response: 'True', imdbID: 'tt0111161', Title: 'Shawshank', Type: 'movie' }) };
  });
  await app.OMDb.details({ i: 'tt0111161' });
  assert.deepEqual(plain(keysUsed), ['aaaabbbb', app.CONFIG.API.OMDB_FALLBACK_KEY], 'never the app’s key');

  app.OMDb.setPersonalKey('');
  assert.equal(localStorage.data.has('omdb_key'), false);
  assert.deepEqual(plain(app.OMDb.keys), [app.CONFIG.API.OMDB_KEY, app.CONFIG.API.OMDB_FALLBACK_KEY]);
  app.OMDb.setPersonalKey('ccccdddd');
  assert.equal(localStorage.data.get('omdb_key'), 'ccccdddd');
});

test('OMDb ignores a stored key of the wrong shape', () => {
  const app = load(SHARED, 'CONFIG, Store, OMDb', { localStorage: memoryLocalStorage({ omdb_key: 'x&apikey=y' }) });
  assert.equal(app.OMDb.personalKey, '');
  assert.equal(app.OMDb.keys[0], app.CONFIG.API.OMDB_KEY);
});

test('OMDb checks a key on its own: accepted, over its quota, or rejected', async () => {
  const app = loadLists();
  const used = [];
  for (const [answer, expected] of [
    [{ status: 200, json: async () => ({ Response: 'True', imdbID: 'tt0111161' }) }, 'ok'],
    [overLimit, 'limit'],
    [invalidKey, 'rejected']
  ]) {
    app.setFetch(async url => { used.push(new URL(url).searchParams.get('apikey')); return answer; });
    assert.equal(await app.OMDb.checkKey('aaaabbbb'), expected);
  }
  assert.deepEqual(plain(used), ['aaaabbbb', 'aaaabbbb', 'aaaabbbb'], 'no fallback while checking');
  app.setFetch(async () => { throw new TypeError('offline'); });
  await assert.rejects(app.OMDb.checkKey('aaaabbbb'), /Could not reach OMDb/);
});

// ---- Lists ------------------------------------------------------------------------

function withTitles(list) {
  const app = loadLists();
  app.Library.load(list);
  return app;
}

test('getFiltered: priority and type chips, quick search, and titles only review mode cares about stay hidden', () => {
  const app = withTitles([
    { title: 'Now Playing', priority: 'watching', want: true },
    { title: 'Future', priority: 'someday', want: true },
    { title: 'Show', type: 'series', priority: 'high', want: true, rewatch: true },
    { title: 'Seen', priority: 'high', verdict: 'up' },
    { title: 'Skipped in review', imdbID: 'tt0000009', verdict: 'skip' }
  ]);
  const { state } = app;
  state.filter = 'priority:watching';
  assert.deepEqual(titles(app), ['Now Playing']);
  state.filter = 'priority:medium';
  assert.deepEqual(titles(app), ['Future'], 'unknown priorities show as medium');
  state.filter = 'label:tv';
  assert.deepEqual(titles(app), ['Show']);
  state.filter = 'rewatch';
  assert.deepEqual(titles(app), ['Show']);
  state.filter = 'all';
  state.list = 'rated';
  assert.ok(titles(app).includes('Seen'), 'marked watched in an old file: a 👍 like any other');
  state.list = 'queue';
  state.quickSearch = 'now';
  assert.deepEqual(titles(app), ['Now Playing']);
  state.quickSearch = '';
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
  assert.deepEqual(sorted('recent'), ['Zeta', 'beta', 'Gamma', 'Alpha'], 'rated, even if still on the list; not skips');
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
  state.list = 'queue';
  assert.deepEqual(sorted('recent'), ['Gamma', 'Delta'], 'the verdict filter only applies to Rated');
  state.verdict = 'all';

  // The Rated mode keeps its own view state: the watchlist's search and list don't touch it
  state.list = 'rated';
  state.quickSearch = 'zeta';
  const rated = { list: 'rated', filter: 'all', quickSearch: '', verdict: 'down', sort: 'recent' };
  assert.deepEqual(plain(ItemManager.getFiltered(rated).map(t => t.title)), ['Gamma']);
  assert.deepEqual(plain(ItemManager.getFiltered().map(t => t.title)), ['Zeta'], 'and the watchlist keeps its own');
  state.quickSearch = '';
});

test('a 👍 counts the same with or without a review date', () => {
  const app = withTitles([
    { id: 'w', title: 'Watched long ago', watched: true },
    { id: 'r', title: 'Rated', want: false, verdict: 'up', reviewDate: '2026-01-01T00:00:00.000Z' },
    { id: 's', title: 'Starred, undated', want: false, verdict: 'up', stars: 4 }
  ]);
  const { ItemManager, Library, Title } = app;
  const list = verdict => plain(ItemManager.getFiltered({ list: 'rated', filter: 'all', quickSearch: '', verdict }).map(t => t.title));
  assert.deepEqual(list('all'), ['Watched long ago', 'Rated', 'Starred, undated']);
  assert.deepEqual(list('up'), ['Watched long ago', 'Rated', 'Starred, undated']);
  assert.equal(Title.statusLabel(Library.get('w')), 'Liked');
  assert.deepEqual(plain(ItemManager.sorted(Library.all(), 'recent').map(t => t.id)).slice(0, 1), ['r'], 'dated first in Recently rated; undated still listed');
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
  const app = loadLists();
  assert.equal(app.ItemManager.add({ title: 'Dune', imdbID: 'tt1160419', genres: 'Action, Sci-Fi', imdbRating: '8.0' }), true);
  const dune = app.Library.byImdb('tt1160419');
  assert.deepEqual(plain([dune.want, dune.genres, dune.imdbRating]), [true, ['Action', 'Sci-Fi'], 8]);
  assert.equal(app.ItemManager.add({ title: 'Dune', imdbID: 'tt1160419' }), false);
  assert.equal(app.statuses.at(-1), 'duplicate item');
});

// ---- Import, export and status -------------------------------------------------------

test('loading says nothing when it works, including an empty list, and says so when it fails', async () => {
  for (const stored of [[{ title: 'A' }], [], undefined]) {
    const app = loadLists();
    if (stored !== undefined) app.Store.saved.set('titles_v2', stored);
    await app.ItemManager.load();
    assert.deepEqual(app.statuses, [], `stored: ${JSON.stringify(stored)}`);
  }
  const broken = loadLists();
  broken.Store.saved.set('titles_v2', '{not json');
  await broken.ItemManager.load();
  assert.equal(broken.statuses.at(-1), 'load failed');
});

test('titles that fail to load are never overwritten: nothing saves for the rest of the visit', async () => {
  const app = loadLists();
  app.Store.saved.set('titles_v2', { not: 'a list' });
  await app.ItemManager.load();
  assert.equal(app.Library.all().length, 0, 'the page carries on empty');
  assert.ok(app.Store.blocked, 'with saving stopped');
  app.ItemManager.add({ title: 'New', want: true });
  assert.deepEqual(plain(app.Store.saved.get('titles_v2')), { not: 'a list' }, 'storage untouched');
});

test('a title can be added as already seen, with its thumb', () => {
  const app = loadLists();
  assert.equal(app.ItemManager.add({ title: 'Arrival', imdbID: 'tt2543164', verdict: 'up', want: false }), true);
  const t = app.Library.byImdb('tt2543164');
  assert.deepEqual(plain([t.want, t.verdict]), [false, 'up']);
  assert.ok(t.reviewDate, 'adding it as seen dates the review');
  app.state.list = 'rated';
  assert.deepEqual(plain(app.ItemManager.getFiltered().map(i => i.title)), ['Arrival'], 'in Rated, not the list to watch');
});

// ---- Searching your titles ------------------------------------------------------

function searchable() {
  const app = load([...SHARED, 'js/state.js', 'js/movie-api.js', 'js/item-manager.js', 'js/review/config.js', 'js/review/title-search.js'],
    'CONFIG, state, Title, Store, Library, MovieAPI, ItemManager, TitleSearch', { UI: { render() {}, setStatus() {} } });
  app.Library.load([
    { id: 'a', imdbID: 'tt4633694', title: 'Spider-Man: Into the Spider-Verse', year: 2018, type: 'movie', verdict: 'up', want: false, reviewDate: '2026-01-03' },
    { id: 'b', imdbID: 'tt0211915', title: 'Amélie', year: 2001, type: 'movie', want: true },
    { id: 'c', imdbID: 'tt2543164', title: 'Arrival', year: 2016, type: 'movie', verdict: 'up', want: false, stars: 4, reviewDate: '2026-01-01' },
    { id: 'd', title: 'Home Movie', year: 2020, type: 'movie', verdict: 'down', want: false, reviewDate: '2026-01-02' }
  ]);
  return app;
}
const found = (app, query, view = {}) => plain(app.ItemManager.getFiltered({ list: 'rated', filter: 'all', verdict: 'all', ...view, quickSearch: query }).map(t => t.title));

test('list search ignores case, accents and punctuation, and takes a year', () => {
  const app = searchable();
  assert.deepEqual(found(app, 'spiderman'), ['Spider-Man: Into the Spider-Verse']);
  assert.deepEqual(found(app, 'spider verse'), ['Spider-Man: Into the Spider-Verse']);
  assert.deepEqual(found(app, 'amelie', { list: 'queue' }), ['Amélie']);
  assert.deepEqual(found(app, 'arrival 2016'), ['Arrival']);
  assert.deepEqual(found(app, 'arrival 1999'), []);
  assert.deepEqual(found(app, 'tt2543164'), ['Arrival']);
});

test('list search forgives a typo only when nothing matches exactly', () => {
  const app = searchable();
  assert.deepEqual(found(app, 'arival'), ['Arrival']);
  assert.deepEqual(found(app, 'arr'), ['Arrival'], 'an exact match keeps near misses out');
});

test('a search finds your titles outside the list being searched', () => {
  const app = searchable();
  // Watchlist's search: the rated film is elsewhere
  const shown = app.ItemManager.getFiltered({ list: 'queue', filter: 'all', quickSearch: 'arrival' });
  assert.equal(shown.length, 0);
  assert.deepEqual(plain(app.ItemManager.elsewhere('arrival', shown).map(t => t.id)), ['c']);
  // Rated, narrowed to 👎: the liked film is still found
  const down = app.ItemManager.getFiltered({ list: 'rated', verdict: 'down', filter: 'all', quickSearch: 'arrival' });
  assert.deepEqual(plain(app.ItemManager.elsewhere('arrival', down).map(t => t.id)), ['c']);
});

test('suggestions include your titles without an IMDb ID, and know which title they are', () => {
  const app = searchable();
  const [home] = app.TitleSearch.suggest('home movie');
  assert.equal(home.id, 'd');
  assert.equal(app.TitleSearch.owned(home).title, 'Home Movie');
  assert.equal(app.TitleSearch.owned({ imdbID: 'tt2543164' }).id, 'c');
  assert.equal(app.TitleSearch.owned({ imdbID: 'tt9999999' }), undefined);
});



test('taking an unrated title off the watchlist keeps it, with its details, off every list', () => {
  const app = withTitles([{ id: 'u', title: 'Maybe Later', year: 2020, want: true, priority: 'high', tag: 'from Sam', platform: 'Netflix' }]);
  const { ItemManager, Library, UndoManager } = app;
  const inList = list => plain(ItemManager.getFiltered({ list, filter: 'all', quickSearch: '', verdict: 'all' }).map(t => t.id));
  assert.deepEqual(inList('queue'), ['u']);
  ItemManager.update('u', { want: false, verdict: '', priority: 'high', tag: 'from Sam', platform: 'Netflix' }, 'Removed from your watchlist');
  const t = Library.get('u');
  assert.deepEqual(plain([t.want, t.verdict, t.tag, t.platform, t.priority]), [false, '', 'from Sam', 'Netflix', 'high']);
  assert.deepEqual(inList('queue'), [], 'off the watchlist');
  assert.deepEqual(inList('rated'), [], 'and not rated');
  assert.deepEqual(plain(ItemManager.elsewhere('maybe later', []).map(x => x.id)), ['u'], 'still found by search');
  UndoManager.undo();
  assert.deepEqual(inList('queue'), ['u'], 'undo puts it back');
});
