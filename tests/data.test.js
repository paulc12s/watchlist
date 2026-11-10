// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Checks on the bundled data files (data/*.json) and the tools that build
// them (tools/build-*.js): each file is well formed, matches the lists the
// app names, and known entries hold. The app's own use of them is tested in
// tests/review.test.js. Run with: node --test tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { read, plain } = require('./helpers');

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

test('categories file carries tags and crowd like-rates for MovieLens films', () => {
  const data = JSON.parse(read('data/categories.json'));
  const films = Object.entries(data.movies).filter(([key]) => key.startsWith('tt'));
  const tagged = films.filter(([, f]) => f[3]);
  assert.ok(tagged.length / films.length > 0.7, 'most films have tags');
  for (const [key, f] of films) {
    assert.ok(f[4] === null || (f[4] >= 0 && f[4] <= 100), key);
  }
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

test('data/critics.json matches the lists the page names, in rank order, every title identified', () => {
  const data = JSON.parse(read('data/critics.json'));
  const config = read('js/review/config.js');
  const names = [...config.matchAll(/id: '(critics-[a-z0-9-]+)'/g)].map(m => m[1]);
  assert.deepEqual(names, data.lists.map(l => l.id), 'the page names every list in the file, in the same order');
  for (const list of data.lists) {
    assert.ok(list.keys.length >= 20, `${list.id} has titles`);
    assert.equal(new Set(list.keys).size, list.keys.length, `${list.id} repeats nothing`);
    for (const key of list.keys) {
      assert.match(key, /^tt\d{7,10}$/, `${key}: every title has an IMDb ID`);
      assert.ok(Array.isArray(data.titles[key]) && data.titles[key][0], `${key} has a title`);
    }
  }
  const letterboxd = data.lists.find(l => l.id === 'critics-letterboxd-21st');
  assert.equal(letterboxd.keys.length, 100);
  const named = rank => data.titles[letterboxd.keys[rank - 1]].slice(0, 2);
  assert.deepEqual(plain([named(1), named(58), named(100)]), [['Morvern Callar', 2002], ['Silence', 2016], ['Magic Mike XXL', 2015]]);
  assert.equal(data.titles.tt4263482[0], 'The Witch', 'Eggers’s, not the other film of that name');
  assert.equal(data.titles.tt10551102[2], 'series', 'an episode on IMDb, so a film list would pass it over');

  const ranked = (id, rank) => data.titles[data.lists.find(l => l.id === id).keys[rank - 1]];
  assert.deepEqual(plain(ranked('critics-nyt-movies', 1)), ['Parasite', 2019, 'movie']);
  assert.deepEqual(plain(ranked('critics-nyt-movies', 100)), ['Superbad', 2007, 'movie']);
  assert.deepEqual(plain(ranked('critics-nyt-tv', 1)), ['Breaking Bad', 2008, 'series']);
  assert.deepEqual(plain(ranked('critics-nyt-tv', 100)), ['Scandal', 2012, 'series']);
  for (const id of ['critics-nyt-movies', 'critics-nyt-tv']) assert.equal(data.lists.find(l => l.id === id).keys.length, 100);
});

test('build-lists reads a list file or text copied from a page, in order, each title once', () => {
  const { parseList } = require('../tools/build-lists.js');
  const copied = 'Poster for Morvern Callar (2002)\n1\nMorvern Callar2002\nRead Review\nPoster for No Country for Old Men (2007)\n2\nNo Country for Old Men2007\nShow Reviews\n';
  assert.deepEqual(parseList(copied).map(t => [t.title, t.year]), [['Morvern Callar', 2002], ['No Country for Old Men', 2007]]);
  const plainList = '1. Spring, Summer, Fall, Winter... and Spring (2003)\n2) Silence (2016) tt0490215\nnot a title\n\nSilence (2016)\n';
  assert.deepEqual(parseList(plainList), [
    { title: 'Spring, Summer, Fall, Winter... and Spring', year: 2003, imdbID: '' },
    { title: 'Silence', year: 2016, imdbID: 'tt0490215' }
  ]);
  assert.deepEqual(parseList('Lovers Rock (2020) tt10551102 series'), [{ title: 'Lovers Rock', year: 2020, imdbID: 'tt10551102', type: 'series' }]);
});

test('data/awards.json matches the award lists the page names', () => {
  const { REVIEW } = { REVIEW: null };
  const data = JSON.parse(read('data/awards.json'));
  const config = read('js/review/config.js');
  for (const list of data.lists) {
    assert.match(config, new RegExp(`id: '${list.id}'`), `${list.id} is named in js/review/config.js`);
    assert.ok(list.keys.length >= 20, `${list.id} has titles`);
    for (const key of list.keys) {
      assert.match(key, /^(tt\d{7,10}|title:.+)$/);
      assert.ok(Array.isArray(data.titles[key]) && data.titles[key][0], `${key} has a title`);
    }
  }
  assert.equal(data.lists.length, 9);
  const names = [...config.matchAll(/id: '(awards-[a-z-]+)'/g)].map(m => m[1]);
  assert.deepEqual(names, data.lists.map(l => l.id), 'the page names every list in the file, in the same order');
});

test('data/honors.json: every entry names a real category, and known results hold', () => {
  const { awards, titles } = JSON.parse(read('data/honors.json'));
  for (const [imdb, [won, nominated]] of Object.entries(titles)) {
    assert.match(imdb, /^tt\d{7,10}$/);
    for (const at of [...won, ...nominated]) assert.ok(awards[at], `${imdb} ${at}`);
    assert.equal(won.filter(at => nominated.includes(at)).length, 0, `${imdb} has a category once`);
  }
  const names = list => list.map(at => awards[at].join(': '));
  assert.ok(names(titles.tt6751668[0]).includes('Oscars: Best Picture'), 'Parasite');
  assert.ok(names(titles.tt0068646[0]).includes('Oscars: Best Picture'), 'The Godfather');
  assert.ok(names(titles.tt0903747[0]).includes('Emmys: Drama Series'), 'Breaking Bad');
  assert.ok(names(titles.tt6751668[0]).includes('Festivals: Cannes Palme d’Or'), 'Parasite');
});
