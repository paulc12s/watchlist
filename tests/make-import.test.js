// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Tests for tools/make-import.js: reading lists and CSVs (including IMDb's and
// Letterboxd's exports), reading ratings, and writing a file the app imports
// unchanged. OMDb is stubbed, so no requests are made.
// Run with: node --test tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readInput, parseRating, parseLine, build, summary, describe, loadApp } = require('../tools/make-import.js');
const { plain, loadLists } = require('./helpers');

const app = loadApp();

test('make-import: ratings in every form, with five stars kept for a full score', () => {
  const cases = {
    '👍': { verdict: 'up' }, like: { verdict: 'up' }, Yes: { verdict: 'up' },
    '👎': { verdict: 'down' }, dislike: { verdict: 'down' },
    '❤️': { verdict: 'up', stars: 5 }, Favourite: { verdict: 'up', stars: 5 },
    4: { stars: 4 }, '4/5': { stars: 4 }, '★★★': { stars: 3 }, '★★★★½': { stars: 4 }, '5': { stars: 5 },
    '8/10': { stars: 4 }, 9: { stars: 4 }, '10/10': { stars: 5 }, '3.5': { stars: 4 }, '1': { stars: 1 },
    'not interested': { verdict: 'pass' }, 'Not-interested': { verdict: 'pass' }, '🚫': { verdict: 'pass' }, 0: { verdict: 'pass' }
  };
  for (const [text, expected] of Object.entries(cases)) {
    const { rewatch, ...rating } = parseRating(text);
    assert.deepEqual(rating, expected, `"${text}"`);
  }
  assert.equal(parseRating(''), null, 'no rating');
  assert.deepEqual(parseRating('👍 🔁'), { verdict: 'up', rewatch: true });
  assert.deepEqual(parseRating('rewatch'), { rewatch: true });
  for (const bad of ['maybe', '11/10', '-3', '4/0', 'pass', 'skip']) assert.throws(() => parseRating(bad), /can't read/, `"${bad}"`);
});

test('make-import: plain lines with a year, a separator, symbols, a kind or an IMDb ID', () => {
  const line = text => plain(parseLine(text, app.MovieAPI));
  assert.deepEqual(line('Dune (2021) | 4/5'), { title: 'Dune', year: 2021, rating: '4/5', type: '' });
  assert.deepEqual(line('Arrival, 👍'), { title: 'Arrival', year: null, rating: '👍', type: '' });
  assert.deepEqual(line('Heat 1995 - 8/10'), { title: 'Heat', year: 1995, rating: '8/10', type: '' });
  assert.deepEqual(line('Blade Runner 2049 🔁'), { title: 'Blade Runner 2049', year: null, rating: '🔁', type: '' }, 'a title ending in a number keeps it');
  assert.deepEqual(line('Up ★★★★'), { title: 'Up', year: null, rating: '★★★★', type: '' });
  assert.deepEqual(line('The Office (TV)'), { title: 'The Office', year: null, rating: '', type: 'series' });
  assert.deepEqual(line('Severance (film) 2006'), { title: 'Severance', year: 2006, rating: '', type: 'movie' });
  assert.equal(line('https://www.imdb.com/title/tt0111161/').imdb, 'tt0111161');
  assert.deepEqual(line('Crouching Tiger, Hidden Dragon'), { title: 'Crouching Tiger', year: null, rating: 'Hidden Dragon', type: '' },
    'a plain line splits at its last comma: use a CSV with quotes for titles with commas');
});

test('make-import: CSVs by header, including IMDb’s and Letterboxd’s exports', () => {
  const csv = '﻿Title,Year,Rating,Notes,Tag\n"Crouching Tiger, Hidden Dragon",2000,4,"Wire work,\nwonderful"\nArrival,2016,👍,,airplane\n';
  assert.deepEqual(plain(readInput(csv, app.MovieAPI).map(r => [r.title, r.year, r.rating, r.review, r.tag])), [
    ['Crouching Tiger, Hidden Dragon', 2000, '4', 'Wire work,\nwonderful', ''], ['Arrival', 2016, '👍', '', 'airplane']]);
  const imdb = 'Const,Your Rating,Date Rated,Title,URL,Title Type,Year\ntt0903747,9,2023-01-02,Breaking Bad,https://www.imdb.com/title/tt0903747/,TV Series,2008\n';
  assert.deepEqual(plain(readInput(imdb, app.MovieAPI).map(r => [r.imdb, r.rating, r.date, r.type])), [['tt0903747', '9', '2023-01-02', 'TV Series']]);
  const letterboxd = 'Date,Name,Year,Letterboxd URI,Rating\n2024-01-05,Past Lives,2023,https://boxd.it/x,4.5\n';
  assert.deepEqual(plain(readInput(letterboxd, app.MovieAPI).map(r => [r.title, r.year, r.rating, r.date])), [['Past Lives', 2023, '4.5', '2024-01-05']]);
});

test('make-import: a reviewed list becomes rated titles the app imports unchanged', async () => {
  const text = 'Title,Year,Rating,Date\nDune,2021,4/5,2024-03-01\nCats,2019,2,\nArrival,2016,,\nHeat,1995,maybe,\nDune,2021,5,\n';
  const { text: file, count, report } = await build('reviewed', text, { lookup: false, app });
  const data = JSON.parse(file);
  assert.equal(data.app, 'titles');
  assert.equal(count, 3);
  assert.deepEqual(plain(report.badRatings), ['Heat (1995): can\'t read the rating "maybe"']);
  assert.deepEqual(plain(report.duplicates), ['Dune (2021): the same title as "Dune (2021)", which came first and is kept']);
  const byTitle = Object.fromEntries(data.titles.map(t => [t.title, t]));
  assert.deepEqual(plain([byTitle.Dune.verdict, byTitle.Dune.stars, byTitle.Dune.want, byTitle.Dune.reviewDate.slice(0, 10)]), ['up', 4, false, '2024-03-01']);
  assert.deepEqual(plain([byTitle.Cats.verdict, byTitle.Cats.stars]), ['down', 2], 'two stars and no thumb: 👎');
  assert.deepEqual(plain([byTitle.Arrival.verdict, byTitle.Arrival.reviewDate]), ['up', ''], 'no rating: watched, under Not rated');

  const fresh = loadLists();
  const result = plain(fresh.Library.import(data));
  assert.equal(result.added, 3, JSON.stringify(result));
  assert.ok(fresh.Title.isUnrated(fresh.Library.all().find(t => t.title === 'Arrival')));
});

test('make-import: lookups fill details, try the year either side, and come from the cache next time', async () => {
  const lookups = loadApp();
  const asked = [];
  lookups.OMDb.request = async params => {
    asked.push({ ...params });
    if (params.s) return { Response: 'False', Error: 'Movie not found!' };
    if (params.t === 'Crouching Tiger, Hidden Dragon' && params.y === 2001) {
      return { Response: 'True', imdbID: 'tt0190332', Title: 'Crouching Tiger, Hidden Dragon', Year: '2001', Type: 'movie', Poster: 'https://m.media-amazon.com/x.jpg', Genre: 'Action', imdbVotes: '280,000' };
    }
    return { Response: 'False', Error: 'Movie not found!' };
  };
  lookups.CONFIG.BATCH_DELAY_MS = 0;
  const cache = {};
  const csv = 'Title,Year\n"Crouching Tiger, Hidden Dragon",2000\nNo Such Film,1990\n';
  const first = await build('watchlist', csv, { app: lookups, cache });
  const titles = JSON.parse(first.text).titles;
  assert.deepEqual(plain([titles[0].imdbID, titles[0].year, titles[0].want, titles[0].poster]), ['tt0190332', 2001, true, 'https://m.media-amazon.com/x.jpg']);
  assert.equal(titles[1].imdbID, '', 'not found: kept, without an IMDb ID');
  assert.deepEqual(plain(first.report.notFound), [{ title: 'No Such Film (1990)', others: [] }]);
  const count = asked.length;
  await build('watchlist', csv, { app: lookups, cache });
  assert.equal(asked.length, count, 'the second run asks OMDb nothing');
});

// A small OMDb: two shows and a film called The Office, one Arrival, a Dune
function fakeOmdb() {
  const app = loadApp();
  app.CONFIG.BATCH_DELAY_MS = 0;
  const all = [
    { imdbID: 'tt0386676', title: 'The Office', year: 2005, type: 'series', writer: 'Greg Daniels', actors: 'Steve Carell, Jenna Fischer, John Krasinski, Rainn Wilson', plot: 'A mockumentary on a group of typical office workers.', rating: 9, votes: 760000 },
    { imdbID: 'tt0290978', title: 'The Office', year: 2001, type: 'series', writer: 'Ricky Gervais', actors: 'Ricky Gervais, Martin Freeman', plot: 'The story of an office in Slough.', votes: 110000 },
    { imdbID: 'tt9999999', title: 'The Office', year: 2014, type: 'series', actors: 'Nobody', plot: 'A web series.', votes: 12 },
    { imdbID: 'tt0000001', title: 'Office Space', year: 1999, type: 'movie', director: 'Mike Judge', actors: 'Ron Livingston', plot: 'Three workers rebel.', votes: 300000 },
    { imdbID: 'tt2543164', title: 'Arrival', year: 2016, type: 'movie', director: 'Denis Villeneuve', actors: 'Amy Adams', plot: 'A linguist works with the military.', votes: 800000 },
    { imdbID: 'tt1160419', title: 'Dune', year: 2021, type: 'movie', director: 'Denis Villeneuve', actors: 'Timothée Chalamet', plot: 'Paul Atreides goes to Arrakis.', votes: 900000 }
  ];
  app.requests = 0;
  // OMDb's own JSON, so the app's parsing runs as it would
  const raw = x => ({ Response: 'True', imdbID: x.imdbID, Title: x.title, Year: String(x.year), Type: x.type, Director: x.director || 'N/A',
    Writer: x.writer || 'N/A', Actors: x.actors, Plot: x.plot, imdbRating: String(x.rating || 'N/A'), imdbVotes: (x.votes || 0).toLocaleString('en') });
  const none = { Response: 'False', Error: 'Movie not found!' };
  app.OMDb.request = async ({ i, t, y, type, s: text }) => {
    app.requests++;
    const kind = x => !type || x.type === type;
    if (text) {
      const words = text.toLowerCase().split(' ').filter(w => w !== 'the');
      const hits = all.filter(x => words.some(w => x.title.toLowerCase().includes(w)) && kind(x));
      return hits.length ? { Response: 'True', Search: hits.map(x => ({ imdbID: x.imdbID, Title: x.title, Year: String(x.year), Type: x.type })) } : none;
    }
    const found = i ? all.find(x => x.imdbID === i) : all.find(x => x.title === t && (!y || x.year === Number(y)) && kind(x));
    return found ? raw(found) : none;
  };
  return app;
}

test('make-import: a name several titles share is ambiguous; a year or a kind settles it', async () => {
  const app = fakeOmdb();
  const text = 'The Office\nThe Office 2001\nThe Offic\nArrival\nZzyzx Road Movie\n';
  const { text: file, report } = await build('watchlist', text, { app, cache: {} });
  assert.deepEqual(plain(report.ambiguous.map(a => [a.title, a.picked.imdbID, a.others.map(o => o.imdbID)])),
    [['The Office', 'tt0386676', ['tt0290978']]], 'kept the best-known, with the other known one listed (not the 12-vote web series)');
  assert.equal(report.matched, 2, 'The Office 2001 and Arrival');
  assert.deepEqual(plain(report.notFound.map(n => [n.title, n.others.map(o => o.imdbID)])),
    [['The Offic', ['tt0386676', 'tt0000001', 'tt0290978']], ['Zzyzx Road Movie', []]],
    'closest search results, top three by votes');
  assert.deepEqual(plain(JSON.parse(file).titles.map(t => [t.title, t.imdbID])), [
    ['The Office', 'tt0386676'], ['The Office', 'tt0290978'], ['The Offic', ''], ['Arrival', 'tt2543164'], ['Zzyzx Road Movie', '']]);
  const tv = await build('watchlist', 'The Office (TV)\n', { app, type: '', cache: {} });
  assert.equal(tv.report.ambiguous.length, 1, 'both are shows, so (TV) alone doesn\u2019t settle it');
  const film = await build('watchlist', 'Arrival (film)\n', { app, cache: {} });
  assert.deepEqual(plain([film.report.matched, film.report.ambiguous]), [1, []]);
});

test('make-import: -i asks about each unclear title once, with details, and remembers the answers', async () => {
  const app = fakeOmdb();
  const cache = {};
  const questions = [];
  let saves = 0;
  const answers = { 'The Office': 'tt0290978', 'The Offic': null, Dun: 'skip' };
  const choose = async (row, options, { ambiguous }) => {
    questions.push([row.title, ambiguous, options.map(o => o.imdbID)]);
    assert.ok(options.every(o => o.plot && o.actors), 'each option carries its details');
    return answers[row.title];
  };
  const text = 'Title,Rating\nThe Office,❤️\nThe Offic,👍\nDun,4\nArrival,2\nDune,\n';
  const { text: file, count, report } = await build('reviewed', text, { app, cache, choose, onChoice: () => saves++ });
  assert.deepEqual(plain(questions), [
    ['The Office', true, ['tt0386676', 'tt0290978']],
    ['The Offic', false, ['tt0386676', 'tt0000001', 'tt0290978']],
    ['Dun', false, ['tt1160419']]]);
  assert.equal(saves, 3, 'saved after each answer');
  assert.deepEqual(plain([count, report.chosen, report.unmatched, report.skipped, report.matched]),
    [4, 1, ['The Offic'], ['Dun'], 2]);
  assert.deepEqual(plain(report.ratings), { loved: 1, up: 1, down: 1, notInterested: 0, unrated: 1 });
  const titles = JSON.parse(file).titles;
  assert.equal(titles[0].imdbID, 'tt0290978', 'the one you chose');
  assert.equal(titles[1].imdbID, '', 'none of these: kept without an ID');

  const before = app.requests;
  const again = await build('reviewed', text, { app, cache });
  assert.equal(app.requests, before, 'answers and lookups come from the cache');
  assert.equal(JSON.parse(again.text).titles[0].imdbID, 'tt0290978', 'and the choice holds without -i');
  assert.equal(again.report.chosen, 1);

  assert.match(describe(cache['i:tt0386676'], 1),
    /1\) The Office \(2005, series\) · created by Greg Daniels · IMDb 9 \(760k votes\)\n {5}Steve Carell, Jenna Fischer, John Krasinski\n {5}A mockumentary/);
});

test('make-import: errors in a row stop the run, writing the rows done; one error leaves its row out', async () => {
  const app = fakeOmdb();
  const real = app.OMDb.request;
  app.OMDb.request = async params => {
    if (/^(B|D|E|F)$/.test(params.t || params.s || '')) throw new Error('Could not reach OMDb.');
    return real(params);
  };
  const { text, count, report } = await build('watchlist', 'Arrival\nB\nDune\nD\nE\nF\nThe Office\n', { app, cache: {} });
  assert.equal(count, 2, 'Arrival and Dune');
  assert.deepEqual(plain(JSON.parse(text).titles.map(t => t.title)), ['Arrival', 'Dune']);
  assert.deepEqual(plain(report.lookupErrors), ['B: Could not reach OMDb.', 'D: Could not reach OMDb.', 'E: Could not reach OMDb.'],
    'left out, to retry; the third in a row stops it');
  assert.deepEqual(plain(report.stopped), { reason: 'errors', message: 'Could not reach OMDb.', done: 5, next: 'F' });
});

test('make-import: OMDb stops at the run\u2019s limit, writes what\u2019s done, and carries on from the cache', async () => {
  const app = fakeOmdb();
  const cache = {};
  const list = 'Arrival\nDune\nThe Office\nOffice Space\n';
  const first = await build('watchlist', list, { app, cache, limit: 5 });
  assert.deepEqual(plain(first.report.stopped), { reason: 'limit', message: '5 OMDb requests', done: 2, next: 'The Office' });
  assert.equal(first.report.requests, 5);
  assert.deepEqual(plain(JSON.parse(first.text).titles.map(t => t.title)), ['Arrival', 'Dune'], 'only finished rows');
  // Each run again spends at most the limit, gets further, and the last one finishes
  let done = first.report.stopped.done;
  let last;
  for (let run = 0; run < 5; run++) {
    const before = app.requests;
    last = await build('watchlist', list, { app, cache, limit: 5 });
    assert.ok(app.requests - before <= 5, 'within the limit');
    if (!last.report.stopped) break;
    assert.ok(last.report.stopped.done > done, 'further each time');
    done = last.report.stopped.done;
  }
  assert.equal(last.report.stopped, null);
  assert.deepEqual(plain(JSON.parse(last.text).titles.map(t => t.title)), ['Arrival', 'Dune', 'The Office', 'Office Space']);

  const text = summary('watchlist', first.report, first.count, 'out.json', { lookup: true });
  for (const line of ['Converted 2 titles from the first 2 of 4 rows → out.json', 'Stopped after 5 OMDb requests, the most one run makes (--limit). 2 of 4 rows done; the other 2 (from "The Office" on) aren\'t in the file yet.',
    'about 1,000 requests a day', 'the app on your phone uses the same key', 'Run the same command again to carry on', '--no-limit', '--tmdb-key']) {
    assert.ok(text.includes(line), `${line}\n---\n${text}`);
  }
});

test('make-import: OMDb\u2019s quota running out stops the run cleanly', async () => {
  const app = fakeOmdb();
  const real = app.OMDb.request;
  let calls = 0;
  app.OMDb.request = async params => {
    if (++calls > 3) throw new Error('OMDb: Request limit reached!');
    return real(params);
  };
  const { count, report } = await build('watchlist', 'Arrival\nDune\nCrash\n', { app, cache: {} });
  assert.equal(count, 1);
  assert.deepEqual(plain([report.stopped.reason, report.stopped.done, report.requests]), ['quota', 1, 4]);
  const text = summary('watchlist', report, count, 'out.json', { lookup: true, ownKey: true });
  assert.ok(text.includes('Stopped: OMDb\'s daily quota ran out ("Request limit reached!") after 4 requests this run. 1 of 3 rows done'), text);
  assert.ok(text.includes('Your key is used up for today') && text.includes('again tomorrow'), text);
});

test('make-import: the summary says what happened to every title', () => {
  const office = { title: 'The Office', year: 2005, type: 'series' };
  const report = {
    rows: 9, matched: 3, chosen: 1, unsure: [], ambiguous: [{ title: 'The Office', picked: office, others: [{ title: 'The Office', year: '2001', type: 'series' }] }],
    notFound: [{ title: 'The Offic', others: [office] }], unmatched: ['Mystery'], skipped: ['Dunes'], badRatings: ['Heat: can\'t read the rating "maybe"'],
    duplicates: ['Dune: the same title as "Dune", which came first and is kept'], untitled: [], lookupErrors: [], stopped: null, requests: 0, ratings: { loved: 1, up: 4, down: 1, notInterested: 2, unrated: 1 }, kinds: { movie: 7, series: 0 }
  };
  const text = summary('reviewed', report, 7, 'out.json', { lookup: true, interactive: false });
  for (const line of [
    'Converted 7 of 9 titles (1 ❤️ · 4 👍 · 1 👎 · 2 not interested · 1 not rated) → out.json',
    'Matched on OMDb: 5 (1 chosen by you)',
    '  The Office → The Office (2005, series) · also: The Office (2001, series)',
    'run with -i to choose',
    '  The Offic · closest: The Office (2005, series)',
    'None of the matches, kept without an IMDb ID: 1',
    'Left out, as you chose: 1',
    'Failed, rating unreadable (left out): 1',
    'Duplicates left out: 1'
  ]) assert.ok(text.includes(line), `${line}\n---\n${text}`);
});

test('make-import: edition words come off the title, and say which kind it is', () => {
  const rows = readInput('Title,Rating\nBlade Runner: Theatrical & Director\'s Cut,5\nGladiator: Extended Edition,3\nDumb and Dumber: Unrated,0\n' +
    'The Office (U.K.),4\nSex and the City: The Movie,3\nAfro Samurai: Season 1,3\nKill Bill: Vol. 2,4\n2001: A Space Odyssey,5\n', app.MovieAPI);
  assert.deepEqual(plain(rows.map(r => [r.title, r.type, r.written || ''])), [
    ['Blade Runner', '', "Blade Runner: Theatrical & Director's Cut"], ['Gladiator', '', 'Gladiator: Extended Edition'],
    ['Dumb and Dumber', '', 'Dumb and Dumber: Unrated'], ['The Office', '', 'The Office (U.K.)'],
    ['Sex and the City', 'movie', 'Sex and the City: The Movie'], ['Afro Samurai', 'series', 'Afro Samurai: Season 1'],
    ['Kill Bill: Vol. 2', '', ''], ['2001: A Space Odyssey', '', '']]);
  assert.deepEqual(plain(readInput('Apocalypse Now / Apocalypse Now Redux\nApocalypse Now Redux\n', app.MovieAPI).map(r => r.title)), ['Apocalypse Now', 'Apocalypse Now']);
});

test('make-import: a name twice takes the next title of that name; editions of one film stay one', async () => {
  const app = fakeOmdb();
  const { text, report } = await build('reviewed', 'Title,Rating\nThe Office,4\nThe Office: Special Edition,5\nThe Office,2\nThe Office,3\n', { app, cache: {} });
  assert.deepEqual(plain(JSON.parse(text).titles.map(t => [t.imdbID, t.stars])), [['tt0386676', 4], ['tt0290978', 2]],
    'the edition is the first one again (a duplicate); the second Office is the other show; the third has none left');
  assert.equal(report.duplicates.length, 2);
  const questions = [];
  await build('reviewed', 'Title,Rating\nThe Office,4\nThe Office,2\n', {
    app, cache: {}, choose: async (row, options, { occurrence }) => { questions.push([occurrence, options.map(o => o.imdbID)]); return options[0].imdbID; }
  });
  assert.deepEqual(plain(questions), [[0, ['tt0386676', 'tt0290978']], [1, ['tt0290978', 'tt0386676']]], 'asked each time; Enter means the one not taken');
});

test('make-import: OMDb\u2019s guess under another name, or an obscure one, is unsure', async () => {
  const app = fakeOmdb();
  const real = app.OMDb.request;
  const extra = {
    'Making Summer': { Response: 'True', imdbID: 'tt0000501', Title: 'Not a Love Story: Making (500) Days of Summer', Year: '2009', Type: 'movie', imdbVotes: '40' },
    '500 Days of Summer': { Response: 'True', imdbID: 'tt1022603', Title: '500 Days of Summer', Year: '2009', Type: 'movie', imdbVotes: '560,000' },
    'Hearts 2020': { Response: 'True', imdbID: 'tt0002020', Title: 'Hearts of Darkness', Year: '2020', Type: 'movie', imdbVotes: '15' },
    'Hearts 1991': { Response: 'True', imdbID: 'tt0102015', Title: 'Hearts of Darkness: A Filmmaker\'s Apocalypse', Year: '1991', Type: 'movie', imdbVotes: '26,000' }
  };
  const byId = Object.fromEntries(Object.values(extra).map(x => [x.imdbID, x]));
  app.OMDb.request = async params => {
    if (params.i && byId[params.i]) return byId[params.i];
    if (params.t === '(500) Days of Summer') return extra['Making Summer'];
    if (params.t === 'Hearts of Darkness') return extra['Hearts 2020'];
    if (params.s === '(500) Days of Summer') return { Response: 'True', Search: [extra['Making Summer'], extra['500 Days of Summer']] };
    if (params.s === 'Hearts of Darkness') return { Response: 'True', Search: [extra['Hearts 2020'], extra['Hearts 1991']] };
    return real(params);
  };
  const { report } = await build('watchlist', '(500) Days of Summer\nHearts of Darkness\nArrival\n', { app, cache: {} });
  assert.equal(report.matched, 2, '(500) Days of Summer is the film of that name, Arrival');
  assert.deepEqual(plain(report.unsure.map(u => [u.title, u.picked.imdbID, u.others.map(o => o.imdbID)])),
    [['Hearts of Darkness', 'tt0102015', ['tt0002020']]], 'the obscure namesake loses to the known title with a subtitle');
});

// A full ratings export, kept on your computer only (git-ignored): skipped where it isn't there
const FULL_RATINGS = require('node:path').join(__dirname, '..', 'data', 'test ratings.csv');
test('make-import: a full ratings file converts, with lookups faked', { skip: !require('node:fs').existsSync(FULL_RATINGS) && 'data/test ratings.csv is local only' }, async () => {
  const text = require('node:fs').readFileSync(FULL_RATINGS, 'utf8');
  const app = loadApp();
  app.CONFIG.BATCH_DELAY_MS = 0;
  // Every title is two known films: the real results don't matter here
  const id = (title, n) => `tt${String(Math.abs([...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))).padStart(8, '0').slice(0, 8)}${n}`;
  const film = (title, n) => ({ Response: 'True', imdbID: id(title, n), Title: title, Year: String(2000 - n), Type: 'movie', imdbVotes: n ? '20,000' : '90,000', Plot: 'A plot.', Actors: 'A, B, C' });
  const films = {};
  app.OMDb.request = async ({ i, t, s: search }) => {
    if (i) return films[i] || { Response: 'False', Error: 'Incorrect IMDb ID.' };
    const title = t || search;
    for (const n of [0, 1]) films[id(title, n)] = film(title, n);
    return t ? films[id(title, 0)] : { Response: 'True', Search: [0, 1].map(n => films[id(title, n)]) };
  };
  const { text: file, count, report } = await build('reviewed', text, { app, cache: {} });
  const rows = readInput(text, app.MovieAPI).length;
  assert.equal(rows, 688);
  assert.deepEqual(plain([report.badRatings, report.lookupErrors, report.notFound]), [[], [], []]);
  assert.equal(count + report.duplicates.length, rows, 'every row is written or a duplicate');
  assert.deepEqual(plain(report.duplicates.map(d => d.split(':')[0])), ['Blade Runner', 'Blade Runner', 'Apocalypse Now Redux', 'Donnie Darko', 'Gladiator'],
    'other editions of one film: the first in the file is kept');
  assert.equal(report.ratings.notInterested, 5, 'the zeros');
  const titles = JSON.parse(file).titles;
  assert.deepEqual(plain(titles.filter(t => /^(Insomnia|Scarface)$/.test(t.title)).map(t => t.year)), [2000, 1999, 2000, 1999], 'the second of each takes the other');
  const fresh = loadLists();
  assert.equal(fresh.Library.import(JSON.parse(file)).added, count);
});

test('make-import: names match however each service writes them', () => {
  const { sameTitle, extendsTitle } = require('../tools/make-import.js');
  for (const [a, b] of [['Hunger Games', 'The Hunger Games'], ['WALL-E', 'WALL·E'], ['The Taking of Pelham 123', 'The Taking of Pelham 1 2 3'],
    ['I Heart Huckabees', 'I ♥ Huckabees'], ['Love and Other Drugs', 'Love & Other Drugs'], ['Amélie', 'Amelie'], ['(500) Days of Summer', '500 Days of Summer'],
    ['A Beautiful Mind', 'Beautiful Mind']]) {
    assert.ok(sameTitle(a, b), `${a} = ${b}`);
  }
  for (const [a, b] of [['Up', 'Upgrade'], ['Heat', 'The Heat Is On'], ['Nine', 'Brooklyn Nine-Nine'], ['Scarface', 'Scarface: The World Is Yours']]) {
    assert.ok(!sameTitle(a, b), `${a} ≠ ${b}`);
  }
  assert.ok(!sameTitle('Heat', 'The Heat', true) && sameTitle('Heat', 'The Heat'), 'strict keeps the article');
  for (const [x, y] of [['Two Guns', '2 Guns'], ['Hangover 2', 'The Hangover Part II'], ["Ocean's Eleven", "Ocean's 11"], ['Rocky IV', 'Rocky 4'], ['The Taking of Pelham 123', 'The Taking of Pelham One Two Three']]) {
    assert.ok(sameTitle(x, y), `${x} = ${y}`);
  }
  assert.ok(!sameTitle('Nine', '9', true) && !sameTitle('Two Guns', '2 Guns', true), 'strict keeps numbers as written');
  assert.ok(!sameTitle('Malcolm X', 'Malcolm 10') && !sameTitle('Rocky', 'Rocky II'), 'X and I stay letters; a number isn\u2019t nothing');
  const { abbreviates } = require('../tools/make-import.js');
  assert.ok(abbreviates('Mission: Impossible - Ghost Protocol', 'MI Ghost Protocol'));
  assert.ok(abbreviates('Teenage Mutant Ninja Turtles', 'TMNT'));
  assert.ok(!abbreviates('Ultimate Puzzle', 'Up'), 'only capitals stand for words');
  assert.ok(!abbreviates('Mission: Impossible - Ghost Protocol', 'MI Protocol'), 'every word accounted for');
  assert.ok(extendsTitle('Aziz Ansari: Intimate Moments for a Sensual Evening', 'Aziz Ansari: Intimate Moments'));
  assert.ok(extendsTitle("Hearts of Darkness: A Filmmaker's Apocalypse", 'Hearts of Darkness'));
  assert.ok(extendsTitle('The Hunger Games: Catching Fire', 'Hunger Games'));
  assert.ok(!extendsTitle('Upgrade', 'Up'), 'whole words only');
  assert.ok(!extendsTitle('Blue Velvet', 'Blue') && !extendsTitle('Wall Street: Money Never Sleeps', 'Wall'), 'a short name needs a subtitle after it');
  assert.ok(extendsTitle('Talladega Nights: The Ballad of Ricky Bobby', 'Talladega Nights'));
  assert.ok(extendsTitle("Don't Be a Menace to South Central While Drinking Your Juice in the Hood", "Don't Be a Menace to South Central"));
  assert.ok(!extendsTitle('Hearts of Darkness', 'Hearts of Darkness'), 'longer only');
});

test('make-import: OMDb costs two requests for a title of its own, as its best guess isn’t asked for again', async () => {
  const app = fakeOmdb();
  await build('watchlist', 'Arrival\n', { app, cache: {} });
  assert.equal(app.requests, 2, 'the guess and the search');
});

// A small TMDB, answering as its API does
function fakeTmdb() {
  const app = loadApp();
  const calls = [];
  const shows = {
    2316: { id: 2316, name: 'The Office', first_air_date: '2005-03-24', vote_count: 4300, overview: 'A mockumentary.', poster_path: '/office.jpg', imdb: 'tt0386676', created_by: [{ name: 'Greg Daniels' }], cast: ['Steve Carell', 'Jenna Fischer', 'John Krasinski', 'Rainn Wilson'] },
    2996: { id: 2996, name: 'The Office', first_air_date: '2001-07-09', vote_count: 900, overview: 'Slough.', imdb: 'tt0290978', created_by: [{ name: 'Ricky Gervais' }], cast: ['Ricky Gervais'] },
    9001: { id: 9001, name: 'The Office', first_air_date: '2019-01-01', vote_count: 3, overview: 'Obscure.', imdb: '' }
  };
  const films = {
    329865: { id: 329865, title: 'Arrival', release_date: '2016-11-10', vote_count: 18000, overview: 'A linguist.', imdb: 'tt2543164', director: 'Denis Villeneuve', cast: ['Amy Adams'] },
    77: { id: 77, title: 'Arrival', release_date: '1996-05-31', vote_count: 50, overview: 'Charlie Sheen.', imdb: 'tt0115571' },
    1: { id: 1, title: 'Nameless Thing', release_date: '2010-01-01', vote_count: 500, overview: 'No IMDb page.', imdb: '' }
  };
  app.TMDB.request = async (path, params) => {
    calls.push(path);
    const all = [...Object.values(shows).map(x => ({ ...x, media_type: 'tv' })), ...Object.values(films).map(x => ({ ...x, media_type: 'movie' }))];
    if (path === '/search/multi') return { results: all.filter(x => (x.name || x.title).toLowerCase().includes(params.query.toLowerCase())) };
    if (path === '/search/movie') return { results: Object.values(films).filter(x => x.title.toLowerCase().includes(params.query.toLowerCase())) };
    if (path.startsWith('/find/')) {
      const id = path.slice(6);
      return { movie_results: Object.values(films).filter(x => x.imdb === id), tv_results: Object.values(shows).filter(x => x.imdb === id) };
    }
    const [, kind, id] = path.split('/');
    const x = (kind === 'tv' ? shows : films)[id];
    if (!x) return null;
    return {
      ...x, external_ids: { imdb_id: x.imdb || null }, genres: [{ name: 'Drama' }],
      ...(kind === 'tv' ? { aggregate_credits: { cast: (x.cast || []).map(name => ({ name })) } }
        : { runtime: 116, credits: { cast: (x.cast || []).map(name => ({ name })), crew: x.director ? [{ job: 'Director', name: x.director }] : [] } })
    };
  };
  return { app, calls };
}

test('make-import: with a TMDB key, a title costs a search and one details request', async () => {
  const { app, calls } = fakeTmdb();
  app.OMDb.request = async () => { throw new Error('OMDb was asked'); };
  const cache = {};
  const { text, report } = await build('reviewed', 'Title,Rating\nArrival,5\nThe Office,4\nThe Office,3\nNameless Thing,2\nArrival (1996),2\n', { app, cache, tmdbKey: 'k' });
  assert.equal(report.source, 'TMDB');
  assert.deepEqual(plain(report.lookupErrors), []);
  const titles = JSON.parse(text).titles;
  assert.deepEqual(plain(titles.map(t => [t.title, t.year, t.type, t.imdbID, t.tmdbId])), [
    ['Arrival', 2016, 'movie', 'tt2543164', 329865], ['The Office', 2005, 'series', 'tt0386676', 2316],
    ['The Office', 2001, 'series', 'tt0290978', 2996], ['Nameless Thing', null, 'movie', '', null], ['Arrival', 1996, 'movie', 'tt0115571', 77]],
    'Arrival: 50 votes is obscure beside 18,000; the second Office takes the other show; a year picks the 1996 Arrival');
  assert.deepEqual(plain([titles[0].director, titles[0].actors, titles[1].director, titles[1].poster]),
    ['Denis Villeneuve', 'Amy Adams', 'Greg Daniels', 'https://image.tmdb.org/t/p/w780/office.jpg']);
  assert.deepEqual(plain(report.ambiguous.map(a => [a.title, a.picked.title, a.picked.year, a.others.map(o => o.year)])),
    [['The Office', 'The Office', 2005, [2001]], ['The Office', 'The Office', 2001, [2005]]], 'the 3-vote one isn’t a rival');
  assert.deepEqual(plain(report.notFound.map(n => [n.title, n.others.map(o => o.title)])), [['Nameless Thing', ['Nameless Thing']]], 'no IMDb ID: not found, with what TMDB had');
  const searches = calls.filter(c => c.startsWith('/search')).length;
  const details = calls.length - searches;
  assert.deepEqual([searches, details], [3, 5], 'one search a name (both Arrivals share one); details only for titles picked');

  const before = calls.length;
  await build('reviewed', 'Title,Rating\nArrival,5\n', { app, cache, tmdbKey: 'k' });
  assert.equal(calls.length, before, 'from the cache');
});

test('make-import: with a TMDB key, IMDb IDs, -i and a rejected key', async () => {
  const { app } = fakeTmdb();
  const asked = [];
  const { text } = await build('watchlist', 'tt2543164\nThe Office\n', {
    app, cache: {}, tmdbKey: 'k', choose: async (row, options) => { asked.push(options.map(o => [o.imdbID, o.votesFrom])); return options[1].imdbID; }
  });
  assert.deepEqual(plain(JSON.parse(text).titles.map(t => t.imdbID)), ['tt2543164', 'tt0290978']);
  assert.deepEqual(plain(asked), [[['tt0386676', 'TMDB'], ['tt0290978', 'TMDB']]], 'options come with their IMDb IDs');
  assert.match(describe({ title: 'The Office', year: 2005, type: 'series', writer: 'Greg Daniels', votes: 4300, votesFrom: 'TMDB', tmdbId: 2316, imdbID: '' }, 1),
    /The Office \(2005, series\) · created by Greg Daniels · 4k TMDB votes\n {5}https:\/\/www\.themoviedb\.org\/tv\/2316/);

  app.TMDB.request = async () => { throw new Error('TMDB didn’t accept the key. Check it in Settings'); };
  const { report } = await build('watchlist', 'A\nB\nC\nD\n', { app, cache: {}, tmdbKey: 'bad' });
  assert.deepEqual(plain(report.stopped), { reason: 'key', message: 'TMDB didn’t accept the key given with --tmdb-key', done: 0, next: 'A' }, 'at once');
});
