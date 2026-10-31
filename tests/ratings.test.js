// Unit tests for the ratings page logic. Run with: node --test tests/ratings.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// Plain <script> globals, loaded into one context in page order
function loadRatings() {
  const files = ['js/config.js', 'js/security.js', 'js/ratings/config.js', 'js/ratings/store.js',
    'js/ratings/catalog.js', 'js/ratings/taste.js', 'js/ratings/feed.js'];
  const context = vm.createContext({ console, crypto, setTimeout, clearTimeout, URL, ItemModel: { newId: () => 'x' } });
  vm.runInContext(
    `${files.map(read).join('\n')}\nthis.app = { Ratings, Catalog, MovieInfo, Taste, Feed };`,
    context
  );
  const { app } = context;
  app.Catalog.use({
    movies: {
      tt0000001: ['Alpha', 1984, 'Drama'],
      tt0000002: ['Beta', 1995, 'Comedy'],
      tt0000003: ['Gamma', 2001, 'Drama|Thriller'],
      'title:Delta (2025)': ['Delta', 2025, '']
    },
    categories: [
      { id: 'one', group: 'G', name: 'One', keys: ['tt0000001', 'tt0000002'] },
      { id: 'two', group: 'G', name: 'Two', keys: ['tt0000003', 'title:Delta (2025)'] }
    ]
  });
  return app;
}

function film(n, fields = {}) {
  return { imdbID: `tt000000${n}`, title: `Film ${n}`, year: 1990 + n, genres: ['Drama'], type: 'movie', ...fields };
}

test('swipes record verdicts; thumbs clear "want" and stamp when rated', () => {
  const { Ratings } = loadRatings();
  Ratings.update(film(1), { want: true });
  assert.equal(Ratings.isDone('tt0000001'), true);
  const rated = Ratings.setVerdict(film(1), 'up');
  assert.equal(rated.verdict, 'up');
  assert.equal(rated.want, false);
  assert.ok(rated.ratedAt);
  assert.equal(Ratings.setStars(film(1), 4).stars, 4);
  assert.equal(Ratings.setStars(film(1), 4).stars, 0, 'tapping the same star clears it');
});

test('sanitize rejects bad IDs and values', () => {
  const { Ratings } = loadRatings();
  assert.equal(Ratings.sanitize({ imdbID: 'nope', title: 'A' }), null);
  const entry = Ratings.sanitize({ imdbID: 'tt1234567', title: 'A', verdict: 'meh', stars: 9, poster: 'javascript:x' });
  assert.equal(entry.verdict, '');
  assert.equal(entry.stars, 0);
  assert.equal(entry.poster, '');
});

test('clearSkips forgets plain skips but keeps anything else about the film', () => {
  const { Ratings } = loadRatings();
  Ratings.setVerdict(film(1), 'skip');
  Ratings.update(film(2), { verdict: 'skip', review: 'saw half' });
  Ratings.setVerdict(film(3), 'down');
  assert.equal(Ratings.clearSkips(), 2);
  assert.equal(Ratings.get('tt0000001'), undefined);
  assert.equal(Ratings.get('tt0000002').verdict, '');
  assert.equal(Ratings.get('tt0000003').verdict, 'down');
});

test('feed deals unrated films, goes back and forward, and skips finished ones', () => {
  const { Ratings, Feed } = loadRatings();
  Ratings.setVerdict(film(2), 'down');
  Feed.start('one');
  assert.equal(Feed.next(), 'tt0000001');
  assert.equal(Feed.next(), null, 'Beta is already rated');
  Feed.start('two');
  assert.equal(Feed.next(), 'tt0000003');
  assert.equal(Feed.back(), 'tt0000001');
  assert.equal(Feed.back(), null);
  assert.equal(Feed.next(), 'tt0000003', 'forward again through the trail');
  assert.equal(Feed.next(), 'title:Delta (2025)');
});

test('catalog treats films found by title as done once rated, and passes over series', () => {
  const { Ratings, Catalog, MovieInfo } = loadRatings();
  MovieInfo.cache.set('title:Delta (2025)', film(9, { imdbID: 'tt0000009' }));
  assert.equal(Catalog.remaining('two'), 2);
  Ratings.setVerdict(film(9), 'up');
  assert.equal(Catalog.remaining('two'), 1);
  MovieInfo.cache.set('tt0000003', film(3, { type: 'series' }));
  assert.equal(Catalog.remaining('two'), 0);
  assert.equal(Catalog.nextId('two'), 'mix', 'the mix of everything follows the last list');
  assert.equal(Catalog.nextId('mix'), 'one');
  assert.equal(JSON.stringify(Catalog.basics('title:Delta (2025)')), '{"title":"Delta","year":2025,"genres":[],"tags":[],"likeRate":null,"crowdCount":0}');
});

test('taste profile smooths small samples and ranks groups against your overall rate', () => {
  const { Ratings, Taste } = loadRatings();
  const add = (n, genre, verdict) => Ratings.setVerdict(film(n, { imdbID: `tt10000${String(n).padStart(2, '0')}`, genres: [genre] }), verdict);
  for (let n = 0; n < 5; n++) add(n, 'Horror', 'up');
  for (let n = 5; n < 10; n++) add(n, 'Romance', 'down');
  add(10, 'Western', 'up'); // Too few to count
  const taste = Taste.compute(Ratings.all());
  assert.deepEqual([...taste.genres.map(g => g.name)], ['Horror', 'Romance']);
  assert.ok(taste.genres[0].lift > 0 && taste.genres[0].rate < 1, 'smoothed below 100%');
  assert.ok(taste.genres[1].lift < 0);
});

test('watchlist export imports: stars map to thumbs, unwatched become want-to-watch', () => {
  const { Ratings } = loadRatings();
  const result = Ratings.import({
    unwatched: [{ title: 'Later', imdbID: 'tt0000011', type: 'movie' }, { title: 'Clip', type: 'youtube', youtubeID: 'abc' }],
    watched: [
      { title: 'Loved', imdbID: 'tt0000012', stars: 5, rewatch: true, review: 'great', genre: 'Drama, Crime' },
      { title: 'Hated', imdbID: 'tt0000013', stars: 1 },
      { title: 'Fine', imdbID: 'tt0000014', stars: 3 },
      { title: 'Show', imdbID: 'tt0000015', type: 'series', stars: 5 }
    ]
  });
  assert.deepEqual({ ...result }, { added: 4, updated: 0 });
  assert.equal(Ratings.get('tt0000011').want, true);
  assert.equal(Ratings.get('tt0000012').verdict, 'up');
  assert.deepEqual([...Ratings.get('tt0000012').genres], ['Drama', 'Crime']);
  assert.equal(Ratings.get('tt0000013').verdict, 'down');
  assert.equal(Ratings.get('tt0000014').verdict, '', '3 stars still needs a thumb');
  assert.equal(Ratings.get('tt0000015'), undefined);
});

test('backup round-trips and keeps the most recently changed copy', () => {
  const { Ratings } = loadRatings();
  Ratings.setVerdict(film(1), 'up');
  const backup = JSON.parse(JSON.stringify(Ratings.backup()));
  backup.ratings[0].verdict = 'down';
  backup.ratings[0].updatedAt = '2000-01-01T00:00:00.000Z';
  assert.deepEqual({ ...Ratings.import(backup) }, { added: 0, updated: 0 }, 'older copy ignored');
  backup.ratings[0].updatedAt = '2999-01-01T00:00:00.000Z';
  assert.deepEqual({ ...Ratings.import(backup) }, { added: 0, updated: 1 });
  assert.equal(Ratings.get('tt0000001').verdict, 'down');
  assert.throws(() => Ratings.import({ something: 1 }));
});

test('want-to-watch export is accepted by the watchlist import unchanged', () => {
  const { Ratings } = loadRatings();
  Ratings.update(film(1, { poster: 'https://m.media-amazon.com/x.jpg', plot: 'p' }), { want: true });
  Ratings.setVerdict(film(2), 'up');
  const exported = JSON.parse(JSON.stringify(Ratings.watchlistItems()));
  assert.equal(exported.length, 1);

  // Run it through the watchlist's own import code
  const files = ['config', 'state', 'security', 'item-model', 'movie-api', 'item-manager'];
  const context = vm.createContext({ console, crypto, setTimeout, clearTimeout, URL, UI: { setStatus() {}, render() {} } });
  vm.runInContext(`${files.map(f => read(`js/${f}.js`)).join('\n')}\nthis.wl = { state, ItemManager };`, context);
  const { state, ItemManager } = context.wl;
  ItemManager.save = () => Promise.resolve();
  assert.equal(ItemManager.import(JSON.stringify(exported)), true);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].imdbID, 'tt0000001');
  assert.equal(state.items[0].watched, false);
  assert.equal(state.items[0].poster, 'https://m.media-amazon.com/x.jpg');
});

test('AI profile lists likes with stars and notes', () => {
  const { Ratings, Taste } = loadRatings();
  Ratings.update(film(1), { verdict: 'up', stars: 5, review: 'tense\nand clever', rewatch: true });
  Ratings.setVerdict(film(2), 'down');
  const text = Ratings.aiProfile(Taste.compute(Ratings.all()));
  assert.match(text, /## Liked \(1\)\n- Film 1 \(1991\) · ★★★★★ · would rewatch · "tense and clever"/);
  assert.match(text, /## Disliked \(1\)\n- Film 2 \(1992\)/);
});

test('build script tidies MovieLens titles', () => {
  const { splitTitle, parseCsvLine } = require('../tools/build-categories.js');
  assert.deepEqual(splitTitle('Fabelmans, The (2022)'), { title: 'The Fabelmans', year: 2022 });
  assert.deepEqual(splitTitle('Lives of Others, The (Das leben der Anderen) (2006)'), { title: 'The Lives of Others', year: 2006 });
  assert.deepEqual(splitTitle('Bicycle Thieves (a.k.a. The Bicycle Thief) (a.k.a. The Bicycle Thieves) (1948)'), { title: 'Bicycle Thieves', year: 1948 });
  assert.deepEqual(parseCsvLine('1,"Hello, World (1999)",Drama'), ['1', 'Hello, World (1999)', 'Drama']);
});

test('categories file is well formed', () => {
  const data = JSON.parse(read('data/categories.json'));
  assert.ok(data.categories.length > 20);
  for (const category of data.categories) {
    assert.ok(category.id && category.name && category.group, category.id);
    assert.ok(category.keys.length > 0, category.id);
    for (const key of category.keys) assert.ok(data.movies[key], `${category.id}: ${key}`);
  }
});

test('build script cleans tags: folds synonyms, drops opinions and genre repeats', () => {
  const { cleanTag } = require('../tools/build-categories.js');
  assert.equal(cleanTag('Twist Ending'), 'twist ending');
  assert.equal(cleanTag('plot twist'), 'twist ending');
  assert.equal(cleanTag('Oscar (Best Picture)'), null);
  assert.equal(cleanTag('overrated'), null);
  assert.equal(cleanTag('imdb top 250'), null);
  assert.equal(cleanTag('Sci-Fi'), null, 'already a genre');
  assert.equal(cleanTag('atmospheric'), 'atmospheric');
  assert.equal(cleanTag('so'), null);
});

test('catalog exposes MovieLens tags and crowd like-rate', () => {
  const { Catalog } = loadRatings();
  Catalog.use({ movies: { tt0000001: ['Alpha', 1984, 'Drama', 'atmospheric|twist ending', 82, 12000] }, categories: [] });
  const basics = Catalog.basics('tt0000001');
  assert.deepEqual([...basics.tags], ['atmospheric', 'twist ending']);
  assert.equal(basics.likeRate, 0.82);
  assert.equal(basics.crowdCount, 12000);
  assert.equal(Catalog.basics('title:New Film (2025)').likeRate, null);
});

test('taste profile covers themes and agreement with the crowd', () => {
  const { Ratings, Taste } = loadRatings();
  const tags = {}, crowd = {};
  const add = (n, verdict, tagList, rate) => {
    const id = `tt20000${String(n).padStart(2, '0')}`;
    tags[id] = tagList;
    crowd[id] = rate;
    Ratings.setVerdict(film(n, { imdbID: id }), verdict);
  };
  for (let n = 0; n < 4; n++) add(n, 'up', ['atmospheric'], 0.8);
  for (let n = 4; n < 8; n++) add(n, 'down', ['quirky'], 0.7);
  add(8, 'up', ['quirky'], 0.3);
  const taste = Taste.compute(Ratings.all(), { tagsOf: e => tags[e.imdbID], crowdOf: e => crowd[e.imdbID] });
  assert.equal(taste.tags[0].name, 'atmospheric');
  assert.equal(taste.tags[taste.tags.length - 1].name, 'quirky');
  assert.equal(taste.crowd.compared, 9);
  assert.equal(taste.crowd.agree, 4, 'agreed on the four liked atmospheric films');
  assert.equal(taste.crowd.likedAgainst.length, 1);
  assert.equal(taste.crowd.dislikedAgainst.length, 4);
});

test('categories file carries tags and crowd like-rates for MovieLens films', () => {
  const data = JSON.parse(read('data/categories.json'));
  const films = Object.entries(data.movies).filter(([key]) => key.startsWith('tt'));
  const tagged = films.filter(([, f]) => f[3]);
  assert.ok(tagged.length / films.length > 0.7, 'most films have tags');
  for (const [key, f] of films) {
    assert.ok(f[4] === null || (f[4] >= 0 && f[4] <= 100), key);
  }
});
