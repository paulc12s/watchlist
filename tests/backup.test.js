// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Tests for what guards the only copy of your titles outside the database:
// js/backup.js (asking the browser to keep its storage, noticing titles that
// have gone, backup reminders) and js/version-check.js (reloading into a new
// deploy once, with everything saved first). Run with: node --test tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read } = require('./helpers');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-09T12:00:00.000Z');

function loadBackup(globals = {}) {
  const stored = {};
  const context = vm.createContext({
    localStorage: { getItem: k => stored[k] ?? null, setItem: (k, v) => { stored[k] = String(v); } },
    ...globals
  });
  vm.runInContext(`${read('js/backup.js')}\nthis.Backup = Backup;`, context);
  return { Backup: context.Backup, stored };
}

test('backup: titles that were here and are gone are noticed; a new start and a full list are not', () => {
  const { Backup } = loadBackup();
  assert.equal(Backup.missing(0), 0, 'never had any: a new start');
  Backup.noteCount(672);
  assert.equal(Backup.missing(672), 0);
  assert.equal(Backup.missing(3), 0, 'fewer is yours to decide');
  assert.equal(Backup.missing(0), 672, 'all gone: the browser cleared them');
  Backup.noteCount(0);
  assert.equal(Backup.missing(0), 0, 'you removed the last one yourself');
});

test('backup: the browser is asked to keep its storage once there are titles, once a visit', async () => {
  let asked = 0;
  const { Backup } = loadBackup({ navigator: { storage: { persist: async () => { asked++; return true; } } } });
  Backup.noteCount(0);
  assert.equal(asked, 0, 'nothing to keep yet');
  Backup.noteCount(1);
  Backup.noteCount(2);
  assert.equal(asked, 1);
  assert.equal(await Backup.persist(), true);

  assert.equal(await loadBackup().Backup.persist(), false, 'a browser without it');
  const refuses = loadBackup({ navigator: { storage: { persist: async () => { throw new Error('no'); } } } });
  assert.equal(await refuses.Backup.persist(), false);
  refuses.Backup.noteCount(5);
});

test('backup: Settings says when you last exported', () => {
  const { Backup } = loadBackup();
  assert.equal(Backup.status(NOW), 'No backup exported from this device yet.');
  Backup.noteExport(NOW - 2 * 60 * 60 * 1000);
  assert.equal(Backup.status(NOW), 'Last backup: today.');
  Backup.noteExport(NOW - 1.5 * DAY);
  assert.equal(Backup.status(NOW), 'Last backup: yesterday.');
  Backup.noteExport(NOW - 12 * DAY);
  assert.equal(Backup.status(NOW), 'Last backup: 12 days ago.');
});

test('backup: an overdue backup gets a word at launch, at most once a week, and only with titles to lose', () => {
  const { Backup } = loadBackup();
  assert.equal(Backup.nudge(5, NOW), '', 'a handful of titles');
  assert.match(Backup.nudge(672, NOW), /672 titles and no backup yet/);
  assert.equal(Backup.nudge(672, NOW + DAY), '', 'said this week already');
  assert.match(Backup.nudge(672, NOW + 8 * DAY), /no backup yet/);

  Backup.noteExport(NOW + 9 * DAY);
  assert.equal(Backup.nudge(672, NOW + 30 * DAY), '', 'backed up three weeks ago');
  assert.match(Backup.nudge(672, NOW + 50 * DAY), /Last backup 41 days ago/);
});

test('backup: with storage blocked (private browsing) nothing is remembered, and nothing breaks', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const { Backup } = loadBackup({ localStorage: blocked });
  Backup.noteCount(10);
  Backup.noteExport(NOW);
  assert.equal(Backup.missing(0), 0);
  assert.equal(Backup.status(NOW), 'No backup exported from this device yet.');
});

// ---- Version check ---------------------------------------------------------------

function loadVersionCheck({ running = 'abc1234', deployed = 'abc1234', search = '', offline = false } = {}) {
  const events = [];
  const session = {};
  const listeners = {};
  const context = vm.createContext({
    CONFIG: { APP_VERSION: running },
    Store: { flush: async () => { await null; events.push('flush'); } },
    URLSearchParams,
    encodeURIComponent,
    sessionStorage: { getItem: k => session[k] ?? null, setItem: (k, v) => { session[k] = v; } },
    location: { pathname: '/app.html', search, replace: url => events.push(`replace ${url}`) },
    document: { visibilityState: 'visible', addEventListener: (name, fn) => { listeners[name] = fn; } },
    window: { addEventListener: (name, fn) => { listeners[name] = fn; } },
    fetch: async (url, options) => {
      events.push(`fetch ${url} ${options.cache}`);
      if (offline) throw new Error('offline');
      return { ok: true, json: async () => ({ version: context.deployed }) };
    }
  });
  context.deployed = deployed;
  vm.runInContext(`${read('js/version-check.js')}\nthis.VersionCheck = VersionCheck;`, context);
  return { VersionCheck: context.VersionCheck, events, listeners, context };
}

test('version check: a new deploy reloads the page once, after everything is saved', async () => {
  const { VersionCheck, events } = loadVersionCheck({ deployed: 'def5678' });
  await VersionCheck.run();
  assert.deepEqual(events, ['fetch version.json no-store', 'flush', 'replace /app.html?v=def5678'], 'saved first, then reloaded past any cached copy');
  events.length = 0;
  await VersionCheck.run();
  assert.deepEqual(events, ['fetch version.json no-store'], 'a stubborn cache can’t make it reload in a loop');
});

test('version check: nothing happens when up to date, offline, or run straight from the branch', async () => {
  const current = loadVersionCheck();
  await current.VersionCheck.run();
  assert.deepEqual(current.events, ['fetch version.json no-store']);

  const offline = loadVersionCheck({ deployed: 'def5678', offline: true });
  await offline.VersionCheck.run();
  assert.deepEqual(offline.events, ['fetch version.json no-store']);

  const unstamped = loadVersionCheck({ running: '__APP_VERSION__', deployed: 'def5678' });
  await unstamped.VersionCheck.run();
  assert.deepEqual(unstamped.events, [], 'not even asked');
});

test('version check: hiding or leaving the page saves what’s pending; coming back checks again', async () => {
  const { VersionCheck, events, listeners, context } = loadVersionCheck({ search: '?v=abc1234' });
  let updated = 0;
  VersionCheck.onUpdated = () => { updated++; };
  VersionCheck.start();
  assert.equal(updated, 1, 'arriving from an update reload says so');
  await new Promise(resolve => setTimeout(resolve, 0));
  events.length = 0;

  context.document.visibilityState = 'hidden';
  listeners.visibilitychange();
  listeners.pagehide();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(events, ['flush', 'flush']);

  events.length = 0;
  context.document.visibilityState = 'visible';
  listeners.visibilitychange();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(events, ['fetch version.json no-store']);
});

// ---- The banner ---------------------------------------------------------------------

function loadBanner() {
  const element = () => ({
    children: [], hidden: false, textContent: '',
    setAttribute() {}, addEventListener(name, fn) { this.click = fn; },
    append(...nodes) { this.children.push(...nodes); },
    get firstChild() { return this.children[0]; },
    get lastChild() { return this.children.at(-1); }
  });
  const context = vm.createContext({
    Store: {}, reloads: 0,
    document: { createElement: element, body: { append() {} } },
    location: { reload() { context.reloads++; } }
  });
  vm.runInContext(`${read('js/save-banner.js')}\nthis.SaveBanner = SaveBanner;`, context);
  const { SaveBanner } = context;
  const shown = () => (SaveBanner.el && !SaveBanner.el.hidden ? [SaveBanner.el.firstChild.textContent, SaveBanner.el.lastChild.textContent] : null);
  return { SaveBanner, Store: context.Store, shown, context };
}

test('banner: a held notice outlasts saves that work, gives way to a saving problem, and is yours to dismiss', () => {
  const { SaveBanner, Store, shown, context } = loadBanner();
  Store.onProblem(null);
  assert.equal(shown(), null, 'nothing to say, nothing drawn');

  SaveBanner.hold('Your titles are gone');
  Store.onProblem(null);
  assert.deepEqual(shown(), ['Your titles are gone', 'OK'], 'a save that worked doesn’t clear it');

  Store.onProblem('Not saved yet');
  assert.deepEqual(shown(), ['Not saved yet', 'Reload']);
  SaveBanner.el.lastChild.click();
  assert.equal(context.reloads, 1);
  Store.onProblem(null);
  assert.deepEqual(shown(), ['Your titles are gone', 'OK'], 'back once saving works');

  SaveBanner.el.lastChild.click();
  assert.equal(shown(), null, 'dismissed');
  assert.equal(context.reloads, 1);
});
