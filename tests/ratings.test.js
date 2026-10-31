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
    'js/ratings/tmdb.js', 'js/ratings/catalog.js', 'js/ratings/taste.js', 'js/ratings/feed.js'];
  const context = vm.createContext({ console, crypto, setTimeout, clearTimeout, URL, ItemModel: { newId: () => 'x' } });
  vm.runInContext(
    `${files.map(read).join('\n')}\nthis.app = { Ratings, Catalog, MovieInfo, Taste, Feed, TMDB };`,
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
  assert.deepEqual({ ...result }, { added: 5, updated: 0 });
  assert.equal(Ratings.get('tt0000011').want, true);
  assert.equal(Ratings.get('tt0000012').verdict, 'up');
  assert.deepEqual([...Ratings.get('tt0000012').genres], ['Drama', 'Crime']);
  assert.equal(Ratings.get('tt0000013').verdict, 'down');
  assert.equal(Ratings.get('tt0000014').verdict, '', '3 stars still needs a thumb');
  assert.equal(Ratings.get('tt0000015').type, 'series', 'TV shows come across too');
  assert.equal(Ratings.get('tt0000015').verdict, 'up');
  assert.equal(Ratings.get('tt0000012').type, 'movie');
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

test('watchlist import never loses what the ratings page already has', () => {
  const { Ratings } = loadRatings();
  Ratings.update(film(1), { verdict: 'skip' });                       // skipped here, watched there
  Ratings.update(film(2), { want: true });                            // wanted here, watched there
  Ratings.update(film(3), { stars: 4, review: 'mine', rewatch: true }); // seen, no thumb yet
  Ratings.update(film(4), { verdict: 'up' });                         // thumbed here
  Ratings.update(film(5), { verdict: 'up', review: 'keep' });         // thumbed and noted here
  const before5 = Ratings.get('tt0000005').updatedAt;

  const result = Ratings.import({
    unwatched: [{ title: 'Film 4', imdbID: 'tt0000004' }, { title: 'Film 3', imdbID: 'tt0000003' }],
    watched: [
      { title: 'Film 1', imdbID: 'tt0000001', stars: 5, review: 'loved it' },
      { title: 'Film 2', imdbID: 'tt0000002' },
      { title: 'Film 3', imdbID: 'tt0000003', stars: 0, review: '', rewatch: false },
      { title: 'Film 4', imdbID: 'tt0000004', stars: 1, review: 'meh' },
      { title: 'Film 5', imdbID: 'tt0000005' }
    ]
  });

  const one = Ratings.get('tt0000001');
  assert.equal(one.verdict, 'up', 'skip upgraded by 5 watchlist stars');
  assert.equal(one.stars, 5);
  assert.equal(one.review, 'loved it');

  const two = Ratings.get('tt0000002');
  assert.equal(two.want, false, 'watched now');
  assert.equal(two.verdict, '', 'seen but no stars: back in the feed for a thumb');

  const three = Ratings.get('tt0000003');
  assert.equal(three.stars, 4, 'blank watchlist stars do not erase');
  assert.equal(three.review, 'mine');
  assert.equal(three.rewatch, true);
  assert.equal(three.want, false, 'unwatched there does not make a seen film wanted');

  const four = Ratings.get('tt0000004');
  assert.equal(four.verdict, 'up', 'a thumb given here wins');
  assert.equal(four.stars, 0, 'contradicting stars are left out');
  assert.equal(four.review, 'meh', 'blank notes are filled in');
  assert.equal(four.want, false);

  assert.equal(Ratings.get('tt0000005').updatedAt, before5, 'nothing new means untouched');
  assert.deepEqual({ ...result }, { added: 0, updated: 3 }, 'film 3 had nothing new');
  assert.equal(Ratings.all().length, 5, 'nothing removed');
});

// A small similarity file: A-B-C sci-fi, D-E-F comedies the crowd panned, G unrelated
function loadRecommender() {
  const { Recommender, REC } = require('../js/ratings/recommend.js');
  Recommender.use({
    films: [
      ['tt0000001', 'A', 2001, 'Sci-Fi', '', 80, 50000, 420],
      ['tt0000002', 'B', 2002, 'Sci-Fi', '', 75, 30000, 410],
      ['tt0000003', 'C', 2003, 'Sci-Fi', '', 70, 20000, 400],
      ['tt0000004', 'D', 2004, 'Comedy', '', 30, 40000, 300],
      ['tt0000005', 'E', 2005, 'Comedy', '', 35, 30000, 310],
      ['tt0000006', 'F', 2006, 'Comedy', '', 40, 20000, 320],
      ['tt0000007', 'G', 2007, 'Drama', '', 85, 60000, 430]
    ],
    neighbors: [[1, 400, 2, 300], [2, 350], [], [4, 400, 5, 300], [5, 350], [], []]
  });
  return { Recommender, REC };
}

test('recommender weights ratings by strength: rewatch and 5 stars count most', () => {
  const { Recommender, REC } = loadRecommender();
  const w = (fields, lane = 'great') => Recommender.weight({ imdbID: 'tt0000001', ...fields }, lane);
  assert.equal(w({ verdict: 'up' }), REC.UP);
  assert.equal(w({ verdict: 'up', stars: 5 }), REC.FIVE_STARS);
  assert.equal(w({ verdict: 'up', stars: 5, rewatch: true }), REC.FIVE_STARS + REC.REWATCH);
  assert.equal(w({ verdict: 'up', stars: 5, rewatch: true }, 'flat'), REC.UP);
  assert.equal(w({ verdict: 'down' }), REC.DOWN);
  assert.ok(w({ verdict: 'skip' }) < 0 && w({ verdict: 'skip' }) > -1, 'skips count slightly against');
  assert.ok(w({ imdbID: 'tt0000004', verdict: 'up' }, 'fun') > w({ imdbID: 'tt0000001', verdict: 'up' }, 'fun'),
    'a like the crowd panned counts extra in the fun lane');
});

test('recommender ranks films near your likes, explains them, and keeps lanes apart', () => {
  const { Recommender } = loadRecommender();
  const entries = [
    { imdbID: 'tt0000001', verdict: 'up', stars: 5 },
    { imdbID: 'tt0000004', verdict: 'up' }
  ];
  const great = Recommender.recommend(entries, 'great', 3);
  assert.equal(great[0].imdbID, 'tt0000002', 'closest to the 5-star film');
  assert.deepEqual([...great[0].because], ['A']);
  assert.ok(!great.some(f => f.imdbID === 'tt0000005'), 'great lane needs a decent crowd like-rate');

  const { great: g, fun } = Recommender.lanes(entries, 3);
  assert.equal(fun[0].imdbID, 'tt0000005', 'fun lane follows the panned comedy');
  assert.ok(!fun.some(f => g.some(x => x.imdbID === f.imdbID)), 'no film in both lanes');
  assert.ok(!Recommender.recommend(entries, 'great', 10).some(f => f.imdbID === 'tt0000001'), 'rated films are left out');
});

test('similarity file is well formed and has no TV series flagged by raters', () => {
  const data = JSON.parse(read('data/similar.json'));
  assert.ok(data.films.length > 4000);
  assert.equal(data.films.length, data.neighbors.length);
  const ids = new Set(data.films.map(f => f[0]));
  assert.equal(ids.size, data.films.length, 'no duplicate films');
  for (const list of data.neighbors) {
    for (let k = 0; k < list.length; k += 2) assert.ok(list[k] < data.films.length && list[k + 1] > 0);
  }
  assert.ok(!data.films.some(f => f[1] === 'Band of Brothers'));
});

test('entries keep the IMDb rating OMDb gave, and drop nonsense values', () => {
  const { Ratings } = loadRatings();
  assert.equal(Ratings.setVerdict(film(1, { imdbRating: '7.4' }), 'up').imdbRating, 7.4);
  assert.equal(Ratings.update(film(1, { imdbRating: '' }), { stars: 4 }).imdbRating, 7.4, 'a blank lookup keeps it');
  assert.equal(Ratings.sanitize({ imdbID: 'tt1234567', title: 'A', imdbRating: 'N/A' }).imdbRating, null);
  assert.equal(Ratings.sanitize({ imdbID: 'tt1234567', title: 'A', imdbRating: 42 }).imdbRating, null);
});

test('TMDB show details map onto the same shape as film details', () => {
  const { TMDB } = loadRatings();
  const info = TMDB.parse({
    id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20', overview: 'A chemistry teacher…',
    genres: [{ id: 18, name: 'Drama' }, { id: 80, name: 'Crime' }], created_by: [{ name: 'Vince Gilligan' }],
    number_of_seasons: 5, poster_path: '/abc123.jpg', vote_average: 8.91, vote_count: 14000,
    external_ids: { imdb_id: 'tt0903747' },
    aggregate_credits: { cast: [{ name: 'Bryan Cranston' }, { name: 'Aaron Paul' }, { name: 'Anna Gunn' }, { name: 'Extra' }] }
  });
  assert.equal(info.imdbID, 'tt0903747');
  assert.equal(info.type, 'series');
  assert.equal(info.year, 2008);
  assert.equal(info.runtime, '5 seasons');
  assert.equal(info.director, 'Vince Gilligan');
  assert.equal(info.actors, 'Bryan Cranston, Aaron Paul, Anna Gunn');
  assert.equal(info.poster, 'https://image.tmdb.org/t/p/w780/abc123.jpg');
  assert.equal(info.tmdbRating, 8.9);
  assert.equal(info.missing, undefined);

  const noImdb = TMDB.parse({ id: 1, name: 'Obscure', external_ids: {}, poster_path: 'javascript:x' });
  assert.equal(noImdb.missing, true, 'shows without an IMDb ID are passed over');
  assert.equal(noImdb.poster, '');
});

test('TV lists load into the catalog and expect series; film lists expect films', () => {
  const { Catalog, MovieInfo, Ratings } = loadRatings();
  assert.ok(Catalog.isTv('tv-most-watched'));
  assert.equal(Catalog.get('tv-most-watched').loaded, false);
  assert.equal(Catalog.nextId('one'), 'two', 'film lists rotate among films');
  assert.ok(Catalog.isTv(Catalog.nextId('tv-most-watched')), 'TV lists rotate among TV');

  Catalog.restoreTvLists({ 'tv-most-watched': { fetchedAt: Date.now(), shows: [{ key: 'tv:1396', title: 'Breaking Bad', year: 2008 }] } });
  assert.deepEqual([...Catalog.get('tv-most-watched').keys], ['tv:1396']);
  assert.equal(Catalog.basics('tv:1396').title, 'Breaking Bad');

  const show = { imdbID: 'tt0903747', title: 'Breaking Bad', type: 'series', genres: [] };
  MovieInfo.cache.set('tv:1396', show);
  assert.equal(MovieInfo.isUsable(show, 'tv:1396'), true);
  assert.equal(MovieInfo.isUsable(show, 'tt0903747'), false, 'a series turning up in a film list is passed over');
  Ratings.setVerdict({ ...show }, 'up');
  assert.equal(MovieInfo.isUsable(show, 'tt0903747'), true, 'but a show you rated opens fine by its IMDb ID');
  assert.equal(Catalog.remaining('tv-most-watched'), 0);

  Catalog.restoreTvLists({ bad: null, 'tv-hbo': { fetchedAt: 'x', shows: [] } });
  assert.equal(Catalog.get('tv-hbo').loaded, false, 'malformed snapshots are ignored');
});

test('want-to-watch export keeps TV shows as series for the watchlist', () => {
  const { Ratings } = loadRatings();
  Ratings.update({ imdbID: 'tt0903747', title: 'Breaking Bad', type: 'series', genres: ['Drama'] }, { want: true });
  const [item] = Ratings.watchlistItems();
  assert.equal(item.type, 'series');
});
