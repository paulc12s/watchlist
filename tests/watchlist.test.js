// Unit tests for the page-independent logic. Run with: node --test tests/watchlist.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The app uses plain <script> globals, so load the files into one context in page order
function loadApp() {
  const files = ['config', 'state', 'security', 'item-model', 'movie-api', 'item-manager'];
  const source = files
    .map(f => fs.readFileSync(path.join(__dirname, '..', 'js', `${f}.js`), 'utf8'))
    .join('\n');

  const context = vm.createContext({
    console, crypto, setTimeout, clearTimeout, URL,
    UI: { setStatus() {}, render() {} }
  });
  vm.runInContext(
    `${source}\nthis.app = { CONFIG, state, Security, ItemModel, MovieAPI, ItemManager, html };`,
    context
  );
  const { app } = context;
  app.ItemManager.save = () => Promise.resolve();
  app.ItemManager.scheduleSave = () => {};
  return app;
}

// Arrays built inside the vm context fail deepStrictEqual against local ones
const ids = results => [...results.map(r => r.imdbID)];

test('html escapes interpolated values but not nested html', () => {
  const { html } = loadApp();
  const name = '<img src=x onerror=alert(1)>';
  assert.equal(String(html`<b title="${'"q"'}">${name}</b>`),
    '<b title="&quot;q&quot;">&lt;img src=x onerror=alert(1)&gt;</b>');
  assert.equal(String(html`<ul>${['a', '<b>'].map(x => html`<li>${x}</li>`)}</ul>`),
    '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
  assert.equal(String(html`${false}${null}${undefined}${0}${''}`), '0');
});

test('sanitizeItem keeps unknown priorities so older app versions cannot downgrade them', () => {
  const { Security } = loadApp();
  assert.equal(Security.sanitizeItem({ title: 'A', priority: 'someday' }).priority, 'someday');
  assert.equal(Security.sanitizeItem({ title: 'A', priority: 'watching' }).priority, 'watching');
  assert.equal(Security.sanitizeItem({ title: 'A', priority: '<script>' }).priority, 'medium');
  assert.equal(Security.sanitizeItem({ title: 'A' }).priority, 'medium');
  assert.equal(Security.sanitizeItem({ title: '  ' }), null);
});

test('sanitizeItem drops YouTube URLs that older versions stored in plot', () => {
  const { Security } = loadApp();
  const migrated = Security.sanitizeItem({
    title: 'Video', type: 'youtube', youtubeID: 'dQw4w9WgXcQ',
    plot: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  });
  assert.equal(migrated.plot, '');

  const kept = Security.sanitizeItem({ title: 'Video', type: 'youtube', youtubeID: 'dQw4w9WgXcQ', plot: 'A talk' });
  assert.equal(kept.plot, 'A talk');
});

test('ItemModel creates unique items and detects duplicates by IMDb or YouTube ID', () => {
  const { ItemModel } = loadApp();
  const a = ItemModel.create({ title: 'Dune', imdbID: 'tt1160419' });
  const b = ItemModel.create({ title: 'Dune', imdbID: 'tt1160419' });
  assert.notEqual(a.id, b.id);
  assert.equal(a.watched, false);

  const keys = ItemModel.keySet([a]);
  assert.equal(ItemModel.isDuplicate(b, keys), true);
  assert.equal(ItemModel.isDuplicate(ItemModel.create({ title: 'Dune' }), keys), false);
  assert.equal(ItemModel.isDuplicate(ItemModel.create({ title: 'V', youtubeID: 'abc' }), keys), false);
});

test('displayPriority treats unknown priorities as medium', () => {
  const { ItemModel } = loadApp();
  assert.equal(ItemModel.displayPriority({ priority: 'watching' }), 'watching');
  assert.equal(ItemModel.displayPriority({ priority: 'someday' }), 'medium');
});

test('parseQuery recognises IMDb links, trailing years, and title-numbers', () => {
  const { MovieAPI } = loadApp();
  assert.equal(MovieAPI.parseQuery('https://m.imdb.com/title/tt31450459/?ref_=x').imdbID, 'tt31450459');
  assert.equal(MovieAPI.parseQuery('dune 1984').year, '1984');
  assert.equal(MovieAPI.parseQuery('dune (1984)').title, 'dune');
  assert.equal(MovieAPI.parseQuery('Blade Runner 2049').year, undefined);
  assert.equal(MovieAPI.parseQuery('1917').title, '1917');
  assert.equal(MovieAPI.parseQuery('Death Race 2000').fullQuery, 'Death Race 2000');
});

test('rank puts exact titles first, then requested year, then recent releases', () => {
  const { MovieAPI } = loadApp();
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

test('getFiltered respects priority, type, watched mode and quick search', () => {
  const { state, ItemManager, ItemModel } = loadApp();
  state.items = [
    ItemModel.create({ title: 'Now Playing', priority: 'watching' }),
    ItemModel.create({ title: 'Future', priority: 'someday' }),
    ItemModel.create({ title: 'Show', type: 'series', priority: 'high' }),
    { ...ItemModel.create({ title: 'Seen', priority: 'high' }), watched: true }
  ];
  const titles = () => [...ItemManager.getFiltered().map(i => i.title)];

  state.filter = 'watching';
  assert.deepEqual(titles(), ['Now Playing']);
  state.filter = 'medium';
  assert.deepEqual(titles(), ['Future']);
  state.filter = 'series';
  assert.deepEqual(titles(), ['Show']);
  state.filter = 'all';
  state.watchedMode = true;
  assert.deepEqual(titles(), ['Seen']);
  state.watchedMode = false;
  state.quickSearch = 'now';
  assert.deepEqual(titles(), ['Now Playing']);
});

test('import skips duplicates already in the list and within the file', () => {
  const { state, ItemManager, ItemModel } = loadApp();
  state.items = [ItemModel.create({ title: 'Dune', imdbID: 'tt1' })];
  const file = JSON.stringify({
    unwatched: [
      { title: 'Dune', imdbID: 'tt1' },
      { title: 'Arrival', imdbID: 'tt2' },
      { title: 'Arrival again', imdbID: 'tt2' },
      { title: 'Home video' },
      { title: 'Home video' }
    ],
    watched: []
  });
  assert.equal(ItemManager.import(file), true);
  // Manual entries have no ID to compare, so both copies are kept
  assert.deepEqual(state.items.map(i => i.title).sort(), ['Arrival', 'Dune', 'Home video', 'Home video']);
  assert.equal(new Set(state.items.map(i => i.id)).size, state.items.length);
});

test('sanitizeItem keeps valid reviews and rejects bad star ratings', () => {
  const { Security } = loadApp();
  const reviewed = Security.sanitizeItem({ title: 'A', stars: 4, review: '  Great  ', rewatch: 1 });
  assert.equal(reviewed.stars, 4);
  assert.equal(reviewed.review, 'Great');
  assert.equal(reviewed.rewatch, true);
  assert.equal(Security.sanitizeItem({ title: 'A', stars: 6 }).stars, 0);
  assert.equal(Security.sanitizeItem({ title: 'A', stars: 2.5 }).stars, 0);
  assert.equal(Security.sanitizeItem({ title: 'A', stars: '3' }).stars, 0);
  assert.equal(Security.sanitizeItem({ title: 'A' }).rewatch, false);
});

test('rewatch filter applies to both the active and watched lists', () => {
  const { state, ItemManager, ItemModel } = loadApp();
  state.items = [
    ItemModel.create({ title: 'Again Soon', rewatch: true }),
    ItemModel.create({ title: 'Fresh' }),
    { ...ItemModel.create({ title: 'Loved It', rewatch: true }), watched: true },
    { ...ItemModel.create({ title: 'Once Was Enough' }), watched: true }
  ];
  const titles = () => [...ItemManager.getFiltered().map(i => i.title)];

  state.filter = 'rewatch';
  assert.deepEqual(titles(), ['Again Soon']);
  state.watchedMode = true;
  assert.deepEqual(titles(), ['Loved It']);
});

test('import merges duplicates field by field: fills blanks, never overwrites', () => {
  const { state, ItemManager } = loadApp();
  state.items = [
    { id: 'a', title: 'Heat', imdbID: 'tt0113277', type: 'movie', priority: 'high', tag: 'crime', watched: false, stars: 0, review: '', rewatch: false, thumb: '', platform: '' },
    { id: 'b', title: 'Alien', imdbID: 'tt0078748', type: 'movie', priority: 'low', tag: '', watched: true, stars: 4, review: 'tense', rewatch: false, thumb: 'up', platform: '' }
  ];
  ItemManager.import(JSON.stringify([
    { title: 'Heat', imdbID: 'tt0113277', priority: 'low', tag: 'other', watched: true, stars: 5, review: 'classic', thumb: 'up', rewatch: true, platform: 'Max' },
    { title: 'Alien', imdbID: 'tt0078748', stars: 1, review: 'nope', thumb: 'down', tag: 'space' },
    { title: 'New One', imdbID: 'tt0000099' }
  ]));
  assert.equal(state.items.length, 3);
  const heat = state.items.find(i => i.id === 'a');
  assert.equal(heat.priority, 'high', 'priority is kept');
  assert.equal(heat.tag, 'crime', 'tag is kept');
  assert.equal(heat.watched, false, 'watched status is kept');
  assert.equal(heat.stars, 5);
  assert.equal(heat.review, 'classic');
  assert.equal(heat.thumb, 'up');
  assert.equal(heat.rewatch, true);
  assert.equal(heat.platform, 'Max');
  const alien = state.items.find(i => i.id === 'b');
  assert.equal(alien.stars, 4);
  assert.equal(alien.review, 'tense');
  assert.equal(alien.thumb, 'up');
  assert.equal(alien.tag, 'space', 'blank tag is filled');
});
