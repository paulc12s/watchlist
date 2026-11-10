// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Tests for settings in the export file (js/app/settings.js): only known
// settings, each checked on its own, are read from a file; malformed, partial
// or hostile entries are skipped and the rest still apply.
// Run with: node --test tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, plain } = require('./helpers');

// The settings module with the parts of the app it talks to stubbed
function loadSettings(globals = {}) {
  const calls = [];
  const view = name => ({ setSort: sort => calls.push([`${name}Sort`, sort]) });
  const context = vm.createContext({
    Palette: { CHOICES: ['basic', 'pastel', 'pride'], get: () => 'basic', set: v => calls.push(['theme', v]) },
    Appearance: { CHOICES: ['auto', 'light', 'dark'], get: () => 'auto', set: v => calls.push(['appearance', v]) },
    IconChoice: { FOLDERS: { mono: 'icons/', colour: 'icons/colour/' }, get: () => 'mono', set: v => calls.push(['appIcon', v]) },
    ItemManager: { SORTS: { recent: [], rating: [], title: [] } },
    REVIEW: { ORDERS: ['ranked', 'shuffled', 'learn'] },
    UI: { views: { watchlist: view('watchlist'), rated: view('rated') } },
    state: { sort: 'recent', rated: { sort: 'rating' } },
    Feed: { order: 'ranked', categoryId: null, start: id => calls.push(['restart', id]) },
    ReviewApp: { savedCategoryId: '', savePrefs: () => calls.push(['savePrefs']) },
    ReviewUI: { feedStarted: () => false },
    TMDB: { key: '' },
    OMDb: { personalKey: '', KEY_SHAPE: /^[0-9a-f]{8}$/i, setPersonalKey(key) { this.personalKey = key; calls.push(['omdbKey', key]); } },
    TitleSearch: { refreshRecent: () => calls.push(['refreshRecent']) },
    CONFIG: { LIMITS: { MAX_FILE_SIZE: 1000 } },
    Store: { blocked: '' },
    Library: {
      isExport: data => Boolean(data) && ['watchlist', 'titles'].includes(data.app) && Array.isArray(data.titles),
      import(data) {
        if (!data || !Array.isArray(data.titles)) throw new Error('Not a watchlist or ratings export');
        calls.push(['import', data.titles.length]);
        return { added: data.titles.length, updated: 0, unchanged: 0 };
      }
    },
    ...globals
  });
  vm.runInContext(`${read('js/app/settings.js')}\nthis.AppSettings = AppSettings;`, context);
  return { ...context, calls };
}

const V3 = '0123456789abcdef0123456789abcdef';

test('settings: every known setting comes back in, checked; a TMDB key in either form', () => {
  const { AppSettings } = loadSettings();
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${'a'.repeat(40)}.${'b'.repeat(43)}`;
  const { settings, skipped } = AppSettings.clean({
    theme: 'pride', appearance: 'dark', appIcon: 'colour', watchlistSort: 'title', ratedSort: 'rating',
    reviewOrder: 'learn', reviewList: 'awards-festivals', tmdbKey: `  ${V3}  `
  });
  assert.deepEqual(plain(settings), {
    theme: 'pride', appearance: 'dark', appIcon: 'colour', watchlistSort: 'title', ratedSort: 'rating',
    reviewOrder: 'learn', reviewList: 'awards-festivals', tmdbKey: V3
  });
  assert.deepEqual(plain(skipped), []);
  assert.equal(AppSettings.clean({ tmdbKey: jwt }).settings.tmdbKey, jwt, 'a read access token');
});

test('settings: malformed, partial and hostile entries are skipped one by one', () => {
  const { AppSettings } = loadSettings();
  for (const raw of [null, undefined, 'pride', 42, [], ['theme', 'pride'], true]) {
    assert.deepEqual(plain(AppSettings.clean(raw)), { settings: {}, skipped: [] }, `settings: ${JSON.stringify(raw)}`);
  }
  const hostile = JSON.parse(`{
    "theme": "<img src=x onerror=alert(1)>",
    "appearance": ["dark"],
    "appIcon": { "toString": "colour" },
    "watchlistSort": "constructor",
    "ratedSort": "__proto__",
    "reviewOrder": 7,
    "reviewList": "../../etc/passwd",
    "tmdbKey": "abc\\r\\nX-Injected: 1",
    "__proto__": { "polluted": true },
    "constructor": { "prototype": { "polluted": true } },
    "unknown": "ignored"
  }`);
  const { settings, skipped } = AppSettings.clean(hostile);
  assert.deepEqual(plain(settings), {}, 'nothing hostile passes');
  assert.deepEqual(plain(skipped).sort(), ['appIcon', 'appearance', 'ratedSort', 'reviewList', 'reviewOrder', 'theme', 'tmdbKey', 'watchlistSort']);
  assert.equal({}.polluted, undefined, 'no prototype pollution');
  assert.equal(AppSettings.clean({ tmdbKey: 'x'.repeat(5000) }).settings.tmdbKey, undefined, 'oversized key');

  // Partial: the good ones still apply
  const partial = AppSettings.clean({ theme: 'pastel', appearance: 'sepia', reviewOrder: 'shuffled' });
  assert.deepEqual(plain(partial), { settings: { theme: 'pastel', reviewOrder: 'shuffled' }, skipped: ['appearance'] });
});

test('settings: applying sets each one, saves review prefs once, and never removes a TMDB key', () => {
  const app = loadSettings();
  app.TMDB.key = V3;
  const result = app.AppSettings.apply({ theme: 'pride', watchlistSort: 'title', reviewOrder: 'learn', reviewList: 'popular' });
  assert.deepEqual(plain(result), { applied: ['theme', 'watchlistSort', 'reviewOrder', 'reviewList'], skipped: [] });
  assert.deepEqual(plain(app.calls), [['theme', 'pride'], ['watchlistSort', 'title'], ['savePrefs']]);
  assert.equal(app.Feed.order, 'learn');
  assert.equal(app.ReviewApp.savedCategoryId, 'popular');
  assert.equal(app.TMDB.key, V3, 'a file without a key leaves this device’s key');

  app.calls.length = 0;
  const newKey = 'fedcba9876543210fedcba9876543210';
  app.AppSettings.apply({ tmdbKey: newKey });
  assert.equal(app.TMDB.key, newKey);
  assert.deepEqual(plain(app.calls), [['refreshRecent'], ['savePrefs']]);
  assert.deepEqual(plain(app.AppSettings.apply('not settings')), { applied: [], skipped: [] });
});

test('settings: collect writes only what would pass on the way back in', () => {
  const app = loadSettings();
  app.TMDB.key = 'not a real key';
  app.Feed.categoryId = 'popular';
  const settings = plain(app.AppSettings.collect());
  assert.deepEqual(settings, {
    theme: 'basic', appearance: 'auto', appIcon: 'mono', watchlistSort: 'recent', ratedSort: 'rating',
    reviewOrder: 'ranked', reviewList: 'popular'
  });
  assert.deepEqual(plain(app.AppSettings.clean(settings).settings), settings, 'a round trip changes nothing');
});

test('settings: Include settings is on unless turned off, and remembered', () => {
  const stored = {};
  const app = loadSettings({ localStorage: { getItem: k => stored[k] ?? null, setItem: (k, v) => { stored[k] = v; } } });
  assert.equal(app.AppSettings.included(), true, 'on by default');
  app.AppSettings.setIncluded(false);
  assert.equal(app.AppSettings.included(), false);
  assert.equal(stored.include_settings, 'no');
  app.AppSettings.setIncluded(true);
  assert.equal(app.AppSettings.included(), true);
  const blocked = loadSettings({ localStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
  assert.equal(blocked.AppSettings.included(), true, 'storage blocked (private browsing): on');
  blocked.AppSettings.setIncluded(false);
});

test('settings: an OMDb key comes in only in its exact shape, and a file without one keeps this device’s', () => {
  const app = loadSettings();
  assert.equal(app.AppSettings.clean({ omdbKey: ' 12AB34cd ' }).settings.omdbKey, '12AB34cd');
  for (const bad of ['1234567', '123456789', 'zzzzzzzz', '1234abcd&i=x', 42]) {
    assert.deepEqual(plain(app.AppSettings.clean({ omdbKey: bad }).skipped), ['omdbKey'], String(bad));
  }
  app.OMDb.personalKey = 'aaaabbbb';
  app.AppSettings.apply({ theme: 'pride' });
  assert.equal(app.OMDb.personalKey, 'aaaabbbb');
  app.AppSettings.apply({ omdbKey: 'ccccdddd' });
  assert.equal(app.OMDb.personalKey, 'ccccdddd');
  assert.equal(plain(app.AppSettings.collect()).omdbKey, 'ccccdddd', 'exported');
});

// A chosen file, as the import reads it
const fileOf = (content, size) => {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return { size: size === undefined ? text.length : size, text: async () => text };
};

test('import: a file’s titles are merged and its settings applied, in one step', async () => {
  const app = loadSettings();
  const result = await app.AppSettings.importFile(fileOf({ app: 'titles', titles: [{ title: 'A' }, { title: 'B' }], settings: { theme: 'pride', appearance: 'sepia' } }));
  assert.deepEqual(plain(result), { added: 2, updated: 0, applied: ['theme'] });
  assert.deepEqual(plain(app.calls), [['import', 2], ['theme', 'pride']]);
});

test('import: settings alone still apply; with Include settings off they are left alone', async () => {
  const app = loadSettings();
  const result = await app.AppSettings.importFile(fileOf({ app: 'watchlist', titles: [], settings: { theme: 'pastel' } }));
  assert.deepEqual(plain(result), { added: 0, updated: 0, applied: ['theme'] });
  assert.deepEqual(plain(app.calls), [['theme', 'pastel']], 'the empty list isn’t imported, which would be an error');

  const off = loadSettings({ localStorage: { getItem: () => 'no', setItem() {} } });
  const kept = await off.AppSettings.importFile(fileOf({ app: 'titles', titles: [{ title: 'A' }], settings: { theme: 'pride' } }));
  assert.deepEqual(plain(kept), { added: 1, updated: 0, applied: [] });
  assert.deepEqual(plain(off.calls), [['import', 1]]);
});

test('import: a file that’s too large, not JSON, or not an export is refused with a reason, changing nothing', async () => {
  const app = loadSettings();
  const { AppSettings } = app;
  await assert.rejects(AppSettings.importFile(fileOf({ app: 'titles', titles: [] }, 1001)), /too large/);
  await assert.rejects(AppSettings.importFile(fileOf('{ "titles": [')), /not a JSON file/);
  await assert.rejects(AppSettings.importFile(fileOf('null')), /Not a watchlist or ratings export/);
  await assert.rejects(AppSettings.importFile(fileOf({ settings: { theme: 'pride' } })), /Not a watchlist or ratings export/);
  assert.deepEqual(plain(app.calls), [], 'not even the settings of a file whose titles were refused');
});

test('import: refused while nothing can be saved, rather than looking imported and vanishing', async () => {
  const app = loadSettings();
  app.Store.blocked = 'This page is open in another tab.';
  await assert.rejects(app.AppSettings.importFile(fileOf({ app: 'titles', titles: [{ title: 'A' }] })), /Nothing can be saved right now. This page is open in another tab/);
  assert.deepEqual(plain(app.calls), []);
});
