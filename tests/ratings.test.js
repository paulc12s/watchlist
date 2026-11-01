// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Tests for the ratings page: the feed, catalog, taste profile, recommender
// and TV. Storing, merging, importing and exporting are shared with the
// watchlist and tested in tests/library.test.js. Run with: node --test tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, loadRatings, film, plain } = require('./helpers');

test('swipes record verdicts; thumbs clear "want" and stamp when rated', () => {
  const { Ratings } = loadRatings();
  Ratings.update(film(1), { want: true });
  assert.equal(Ratings.isDone('tt0000001'), true);
  const rated = Ratings.setVerdict(film(1), 'up');
  assert.equal(rated.verdict, 'up');
  assert.equal(rated.want, false);
  assert.ok(rated.reviewDate);
  assert.equal(Ratings.setStars(film(1), 4).stars, 4);
  assert.equal(Ratings.setStars(film(1), 4).stars, 0, 'tapping the same star clears it');
});

test('clearSkips forgets plain skips but keeps anything else about the film', () => {
  const { Ratings } = loadRatings();
  Ratings.setVerdict(film(1), 'skip');
  Ratings.update(film(2), { want: true });
  Ratings.setVerdict(film(2), 'skip');
  Ratings.setVerdict(film(3), 'down');
  assert.equal(Ratings.clearSkips(), 2);
  assert.equal(Ratings.get('tt0000001'), undefined);
  assert.deepEqual(plain([Ratings.get('tt0000002').verdict, Ratings.get('tt0000002').want]), ['', true]);
  assert.equal(Ratings.get('tt0000003').verdict, 'down');
  // Notes mean you've seen it, so a skip with notes counts as seen
  assert.equal(Ratings.update(film(4), { verdict: 'skip', review: 'saw half' }).verdict, 'up');
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
  const { Ratings, Title } = loadRatings();
  assert.equal(Ratings.setVerdict(film(1, { imdbRating: '7.4' }), 'up').imdbRating, 7.4);
  assert.equal(Ratings.update(film(1, { imdbRating: '' }), { stars: 4 }).imdbRating, 7.4, 'a blank lookup keeps it');
  assert.equal(Title.sanitize({ imdbID: 'tt1234567', title: 'A', imdbRating: 'N/A' }).imdbRating, null);
  assert.equal(Title.sanitize({ imdbID: 'tt1234567', title: 'A', imdbRating: 42 }).imdbRating, null);
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

  Catalog.restoreTvLists({ 'tv-most-watched': { fetchedDate: Date.now(), shows: [{ key: 'tv:1396', title: 'Breaking Bad', year: 2008 }] } });
  assert.deepEqual([...Catalog.get('tv-most-watched').keys], ['tv:1396']);
  assert.equal(Catalog.basics('tv:1396').title, 'Breaking Bad');

  const show = { imdbID: 'tt0903747', title: 'Breaking Bad', type: 'series', genres: [] };
  MovieInfo.cache.set('tv:1396', show);
  assert.equal(MovieInfo.isUsable(show, 'tv:1396'), true);
  assert.equal(MovieInfo.isUsable(show, 'tt0903747'), false, 'a series turning up in a film list is passed over');
  Ratings.setVerdict({ ...show }, 'up');
  assert.equal(MovieInfo.isUsable(show, 'tt0903747'), true, 'but a show you rated opens fine by its IMDb ID');
  assert.equal(Catalog.remaining('tv-most-watched'), 0);

  Catalog.restoreTvLists({ bad: null, 'tv-hbo': { fetchedDate: 'x', shows: [] } });
  assert.equal(Catalog.get('tv-hbo').loaded, false, 'malformed snapshots are ignored');
});

// TMDB list results in the shape tvrecs.js reads
const tmdbShows = (...shows) => ({
  results: shows.map(([id, name, vote_average = 8, vote_count = 5000]) => ({ id, name, first_air_date: '2015-01-01', vote_average, vote_count, poster_path: `/p${id}.jpg` }))
});

test('TV recommendations: TMDB lists become a graph scored like films', () => {
  const { Ratings, TvRecs, Recommender } = loadRatings();
  const show = (tmdbId, fields) => Ratings.update({ imdbID: `tt90000${tmdbId}`, title: `Show ${tmdbId}`, type: 'series', tmdbId }, fields);
  show(10, { verdict: 'up', stars: 5 });
  show(20, { verdict: 'down' });
  TvRecs.load({
    recs: {
      10: { fetchedDate: Date.now(), shows: [{ id: 11, name: 'Like Ten', year: 2016, poster: '/a.jpg', vote_average: 8.6, vote_count: 9000 }, { id: 30, name: 'Shared', vote_average: 8, vote_count: 3000 }] },
      20: { fetchedDate: Date.now(), shows: [{ id: 21, name: 'Like Twenty', vote_average: 8.5, vote_count: 9000 }, { id: 30, name: 'Shared', vote_average: 8, vote_count: 3000 }] }
    }
  });
  const graph = TvRecs.graph(Ratings.all());
  const { great, fun } = Recommender.lanes(Ratings.all(), 5, graph);
  assert.equal(great[0].id, 'tv:11', 'top pick comes from the 5-star show');
  assert.deepEqual([...great[0].because], ['Show 10']);
  assert.equal(great[0].poster, 'https://image.tmdb.org/t/p/w780/a.jpg');
  assert.ok(![...great, ...fun].some(item => item.id === 'tv:21'), 'nothing near the disliked show alone');
  assert.ok(![...great, ...fun].some(item => item.id === 'tv:10' || item.id === 'tv:20'), 'rated shows are left out');
  assert.ok(Recommender.guess('tv:11', Ratings.all(), graph).percentile > Recommender.guess('tv:30', Ratings.all(), graph).percentile);
});

test('TV refresh resolves watchlist shows by IMDb ID and falls back to similar shows', async () => {
  const { Ratings, TvRecs, TMDB } = loadRatings();
  Ratings.update({ imdbID: 'tt0903747', title: 'Breaking Bad', type: 'series' }, { verdict: 'up' });
  const calls = [];
  TMDB.request = async path => {
    calls.push(path);
    if (path.startsWith('/find/')) return { tv_results: [{ id: 1396 }] };
    if (path.endsWith('/recommendations')) return { results: [] };
    if (path.endsWith('/similar')) return tmdbShows([60059, 'Better Call Saul']);
    return null;
  };
  assert.equal(await TvRecs.refresh(Ratings.all()), 3);
  assert.deepEqual(calls, ['/find/tt0903747', '/tv/1396/recommendations', '/tv/1396/similar']);
  assert.equal(TvRecs.cache.recs[1396].shows[0].name, 'Better Call Saul');
  assert.equal(await TvRecs.refresh(Ratings.all()), 0, 'cached for a week');
});

test('TV bridge ranks shows by how many of your film themes they share', async () => {
  const { TvRecs, TMDB } = loadRatings();
  TMDB.request = async (path, params) => {
    if (path === '/search/keyword') {
      const ids = { dystopia: 4565, 'time travel': 4379, quirky: 1 };
      return { results: ids[params.query] ? [{ id: ids[params.query], name: params.query }] : [] };
    }
    if (params.with_keywords === 4565) return tmdbShows([1, 'Both'], [2, 'Only Dystopia']);
    if (params.with_keywords === 4379) return tmdbShows([3, 'Only Time'], [1, 'Both']);
    return { results: [] };
  };
  const picks = await TvRecs.bridge([], [
    { name: 'dystopia', lift: 0.2 }, { name: 'time travel', lift: 0.2 }, { name: 'nonexistent', lift: 0.1 }, { name: 'quirky', lift: -0.3 }
  ]);
  assert.equal(picks[0].title, 'Both');
  assert.deepEqual([...picks[0].because], ['dystopia', 'time travel']);
  assert.equal(TvRecs.cache.keywords.nonexistent, 0, 'themes with no TMDB keyword are remembered as missing');
  assert.ok(!('quirky' in TvRecs.cache.keywords), 'themes you lean away from are not looked up');
});

test('guesses are kept with the first verdict and summarised against your verdicts', () => {
  const { Ratings, Guesses, Title } = loadRatings();
  const add = (n, verdict, guessPct) => Ratings.update(film(n, { imdbID: `tt30000${String(n).padStart(2, '0')}` }), { verdict, guessPct });
  for (let n = 0; n < 6; n++) add(n, 'up', 0.9);
  add(6, 'down', 0.95);
  for (let n = 7; n < 10; n++) add(n, 'skip', 0.3);
  add(10, 'up', 0.2);
  const record = Guesses.record(Ratings.all());
  assert.equal(record.total, 11);
  assert.equal(record.top.count, 7);
  assert.equal(record.top.seen, 1);
  assert.equal(Math.round(record.top.liked * 100), 86);
  assert.equal(record.rest.seen, 0.25);
  assert.equal(Guesses.label(0.97), 'a top pick for you');
  assert.equal(Guesses.label(0.1), 'not your usual');
  assert.equal(Title.sanitize({ imdbID: 'tt1234567', title: 'A', guessPct: 2 }).guessPct, null);
});

test('learn-fastest order puts widely seen films with little evidence first', () => {
  const { Catalog, Recommender, Guesses } = loadRatings();
  Recommender.use({
    films: [
      ['tt0000001', 'Alpha', 1984, 'Drama', '', 70, 50000, 400],
      ['tt0000002', 'Beta', 1995, 'Comedy', '', 70, 1000, 400],
      ['tt0000003', 'Gamma', 2001, 'Drama', '', 70, 90000, 400]
    ],
    neighbors: [[], [], []]
  });
  Catalog.learnScore = () => Guesses.learnScore();
  assert.deepEqual([...Catalog.queue('one', 'learn')], ['tt0000001', 'tt0000002']);
  assert.deepEqual([...Catalog.queue('two', 'learn')].slice(0, 1), ['tt0000003']);
});

test('review date: thumbs, stars, notes and rewatch date a review; skips and wants do not', () => {
  const { Ratings, Title } = loadRatings();
  assert.equal(Ratings.update(film(1), { verdict: 'skip' }).reviewDate, '');
  assert.equal(Ratings.update(film(2), { want: true }).reviewDate, '');
  assert.ok(Ratings.update(film(3), { review: 'nice' }).reviewDate);
  Ratings.get('tt0000003').reviewDate = '2026-01-01T00:00:00.000Z';
  Ratings.update(film(3), { want: false });
  assert.equal(Ratings.get('tt0000003').reviewDate, '2026-01-01T00:00:00.000Z');
  assert.notEqual(Ratings.update(film(3), { stars: 5 }).reviewDate, '2026-01-01T00:00:00.000Z');
  // Older saves called it ratedAt / updatedAt
  const old = Title.sanitize({ imdbID: 'tt1234567', title: 'A', ratedAt: '2025-05-05T00:00:00.000Z', updatedAt: '2025-06-06T00:00:00.000Z' });
  assert.equal(old.reviewDate, '2025-05-05T00:00:00.000Z');
  assert.equal(old.updatedDate, '2025-06-06T00:00:00.000Z');
  assert.equal('ratedAt' in old || 'updatedAt' in old, false);
});

// ---- API responses are untrusted input ------------------------------------
// OMDb's parsing is shared with the watchlist and tested in tests/watchlist.test.js
test('film cards ask the shared OMDb client; titles it can’t find count as missing', async () => {
  const app = loadRatings();
  app.setFetch(async url => ({
    status: 200,
    json: async () => (new URL(url).searchParams.get('i') === 'tt0000001'
      ? { Response: 'True', imdbID: 'tt0000001', Title: 'Alpha', Year: '1984', Type: 'movie', imdbRating: '7.0' }
      : { Response: 'False', Error: 'Incorrect IMDb ID.' })
  }));
  const info = await app.MovieInfo.fetch('tt0000001');
  assert.deepEqual(plain([info.title, info.year, info.imdbRating, info.type]), ['Alpha', 1984, 7, 'movie']);
  assert.equal((await app.MovieInfo.fetch('tt0000002')).missing, true);
});

test('TMDB show details: non-strings dropped, lengths capped, posters only from TMDB paths', () => {
  const { TMDB } = loadRatings();
  const show = TMDB.parse({
    id: 5, name: { evil: 1 }, overview: 'o'.repeat(5000), poster_path: '/../../x" onerror="alert(1)',
    external_ids: { imdb_id: 'tt7654321' }, genres: [{ name: 7 }, { name: 'Drama' }, null],
    created_by: 'nope', aggregate_credits: { cast: [{ name: 'n'.repeat(500) }] }
  });
  assert.equal(show.title, '');
  assert.equal(show.plot.length, 1000);
  assert.equal(show.poster, '');
  assert.deepEqual([...show.genres], ['Drama']);
  assert.equal(show.director, '');
  assert.equal(show.actors.length, 100);
  assert.equal(TMDB.parse({ id: 5, external_ids: { imdb_id: 'javascript:1' } }).missing, true);
});


test('settings saved before the feed starts keep the saved key and list', async () => {
  const app = loadRatings();
  app.Store.saved.set('prefs_v1', { order: 'shuffled', tmdbKey: 'secret', categoryId: 'two' });
  await app.RatingsApp.loadPrefs();
  app.Feed.order = 'learn';
  app.RatingsApp.savePrefs();
  assert.deepEqual(plain(app.Store.saved.get('prefs_v1')), { categoryId: 'two', order: 'learn', tmdbKey: 'secret' });
});
