// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Loads each page's real scripts into its own context for the tests. The
// pages use plain <script> globals, so files run in one context in page order.
// Storage is replaced by an in-memory stand-in (see memoryStore).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// The modules both pages share, in page order
const SHARED = ['js/config.js', 'js/security.js', 'js/title.js', 'js/store.js', 'js/library.js', 'js/omdb.js'];

function load(files, expose, globals = {}) {
  const context = vm.createContext({
    console, crypto, setTimeout, clearTimeout, URL, AbortController,
    fetch: (...args) => context.fetchStub(...args),
    ...globals
  });
  vm.runInContext(`${files.map(read).join('\n')}\nthis.app = { ${expose} };`, context);
  const { app } = context;
  app.setFetch = stub => { context.fetchStub = stub; };
  app.Store.saved = memoryStore(app.Store);
  return app;
}

// Stands in for IndexedDB: open/load/save work on a Map the test can read
// and seed (store.data), and saves happen at once rather than batched
function memoryStore(Store) {
  const data = new Map();
  Store.open = async () => {};
  Store.load = async key => (data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : undefined);
  Store.scheduleSave = (key, write) => {
    if (!Store.blocked) data.set(key, JSON.parse(JSON.stringify(write())));
  };
  Store.flush = async () => {};
  return data;
}

// The watchlist page: everything but the DOM-bound UI, which is stubbed
function loadWatchlist() {
  const errors = [];
  const statuses = [];
  const UI = {
    setStatus: text => statuses.push(text), render() {},
    showImportError: message => errors.push(message), hideImportError: () => errors.push(null),
    elements: { undoBar: { classList: { toggle() {}, remove() {} } }, undoMessage: {} }
  };
  const app = load(
    [...SHARED, 'js/state.js', 'js/movie-api.js', 'js/item-manager.js', 'js/undo-manager.js'],
    'CONFIG, state, Security, html, Title, Store, Library, OMDb, MovieAPI, ItemManager, UndoManager',
    { UI }
  );
  app.UndoManager.updateUI = () => {};
  Object.assign(app, { UI, errors, statuses });
  return app;
}

// The ratings page's logic, with a small catalog of films to deal
function loadRatings() {
  const app = load(
    [...SHARED, 'js/movie-api.js', 'js/ratings/config.js', 'js/ratings/store.js', 'js/ratings/tmdb.js', 'js/ratings/catalog.js',
      'js/ratings/taste.js', 'js/ratings/feed.js', 'js/ratings/recommend.js', 'js/ratings/tvrecs.js', 'js/ratings/foryou.js',
      'js/ratings/title-search.js', 'js/ratings/app.js'],
    'CONFIG, Title, Store, Library, OMDb, Ratings, Catalog, MovieInfo, Taste, Feed, TMDB, Recommender, TvRecs, Guesses, RatingsApp, TitleSearch'
  );
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

// Values built inside a page's context fail deepStrictEqual against local ones
const plain = value => JSON.parse(JSON.stringify(value));

module.exports = { read, loadWatchlist, loadRatings, film, plain };
