// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// End-to-end tests of tools/make-import.js: the command as you'd run it, with
// OMDb and TMDB faked (tests/fixtures/fake-services.js) so runs are repeatable
// and free. Each test has its own cache and output folder. Checks what's
// printed, the exit code, the file's format (it imports into the app as an
// export does), the requests made, and the stops: the run's OMDb limit,
// OMDb's quota, a rejected TMDB key.
// Run with: node --test tests/*.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadLists, plain } = require('./helpers');

const ROOT = path.join(__dirname, '..');
// 48 titles with random ratings: editions, repeated names, names the services
// write differently, shared names, obscure titles, titles only OMDb finds, a
// title nothing matches
const RATINGS = path.join(__dirname, 'fixtures', 'ratings-sample.csv');
const FAKE_KEY = '0123456789abcdef0123456789abcdef';

// A fresh folder for one test: run(args, { env, input }) runs the command there
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-import-'));
  const logFile = path.join(dir, 'requests.log');
  const run = (args, { env = {}, input = '' } = {}) => {
    fs.writeFileSync(logFile, '');
    const result = spawnSync(process.execPath, ['--require', path.join(__dirname, 'fixtures', 'fake-services.js'), path.join(ROOT, 'tools', 'make-import.js'), ...args], {
      cwd: dir, input, encoding: 'utf8', timeout: 60000,
      env: { PATH: process.env.PATH, MAKE_IMPORT_CACHE: path.join(dir, 'cache.json'), MAKE_IMPORT_DELAY_MS: '0', FAKE_LOG: logFile, ...env }
    });
    const requests = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    return { code: result.status, out: result.stdout, err: result.stderr, requests, omdb: requests.filter(r => r.startsWith('omdb')), tmdb: requests.filter(r => r.startsWith('tmdb')) };
  };
  const file = name => path.join(dir, name);
  const write = (name, text) => { fs.writeFileSync(file(name), text); return file(name); };
  const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
  return { dir, run, file, write, read };
}

// The file is the app's export format, every record is already in the app's
// own shape, and the app imports all of it
function assertImportable(data, kind) {
  assert.deepEqual(Object.keys(data).sort(), ['app', 'exportDate', 'from', 'titles', 'version']);
  assert.deepEqual([data.app, data.version, data.from], ['titles', 2, `make-import-${kind}`]);
  assert.ok(!Number.isNaN(Date.parse(data.exportDate)), 'exportDate is a date');
  const { Title, Library } = loadLists();
  for (const t of data.titles) assert.deepEqual(plain(Title.sanitize(t)), plain(t), `${t.title} is as the app stores it`);
  assert.equal(Library.import(data).added, data.titles.length, 'every title imports');
}

test('make-import CLI: OMDb stops at its limit, writes what\u2019s done, and the same command carries on', () => {
  const box = sandbox();
  const first = box.run(['reviewed', RATINGS, '-o', 'out.json', '--limit', '20']);
  assert.equal(first.code, 0, first.err);
  assert.equal(first.omdb.length, 20, 'exactly the limit');
  assert.match(first.out, /^Looking titles up on OMDb \(at most 20 requests; --no-limit for more\)…/);
  const stopped = first.out.match(/Stopped after 20 OMDb requests, the most one run makes \(--limit\)\. (\d+) of 48 rows done; the other (\d+) \(from "(.+)" on\) aren't in the file yet\./);
  assert.ok(stopped, first.out);
  assert.equal(Number(stopped[1]) + Number(stopped[2]), 48);
  for (const text of ['about 1,000 requests a day', 'the app on your phone uses the same key', 'Run the same command again to carry on', '--limit N', '--no-limit', '--tmdb-key KEY']) {
    assert.ok(first.out.includes(text), text);
  }
  const data = box.read('out.json');
  assertImportable(data, 'reviewed');
  assert.match(first.out, new RegExp(`Converted ${data.titles.length} titles from the first ${stopped[1]} of 48 rows`));

  // Again and again: each run spends at most the limit and gets further, until done
  let done = Number(stopped[1]);
  let run;
  for (let i = 0; i < 10; i++) {
    run = box.run(['reviewed', RATINGS, '-o', 'out.json', '--limit', '20']);
    assert.ok(run.omdb.length <= 20);
    const now = run.out.match(/(\d+) of 48 rows done/);
    if (!now) break;
    assert.ok(Number(now[1]) > done, `${now[1]} > ${done}`);
    done = Number(now[1]);
  }
  assert.match(run.out, /^Converted 44 of 48 titles/m);
  assertImportable(box.read('out.json'), 'reviewed');
});

test('make-import CLI: by default OMDb stops at 100 requests', () => {
  const box = sandbox();
  const out = box.run(['reviewed', RATINGS, '-o', 'out.json']);
  assert.equal(out.code, 0, out.err);
  assert.match(out.out, /^Looking titles up on OMDb \(at most 100 requests; --no-limit for more\)…/);
  assert.equal(out.omdb.length, 100);
  assert.match(out.out, /Stopped after 100 OMDb requests, the most one run makes \(--limit\)\. \d+ of 48 rows done/);
  assertImportable(box.read('out.json'), 'reviewed');
});

test('make-import CLI: --no-limit goes on until OMDb\u2019s quota runs out, then finishes on a later run', () => {
  const box = sandbox();
  const out = box.run(['reviewed', RATINGS, '-o', 'out.json', '--no-limit'], { env: { FAKE_QUOTA: '30' } });
  assert.equal(out.code, 0, out.err);
  assert.match(out.out, /^Looking titles up on OMDb until its quota runs out…/);
  assert.match(out.out, /Stopped: OMDb's daily quota ran out \("Request limit reached!"\) after \d+ requests this run\. \d+ of 48 rows done/);
  assert.ok(out.out.includes('The app\'s key and the demo key are both used up for today'), out.out);
  assert.ok(out.out.includes('Run the same command again tomorrow to carry on'), out.out);
  assertImportable(box.read('out.json'), 'reviewed');

  // "Tomorrow": the rest, from the cache onwards
  const done = box.run(['reviewed', RATINGS, '-o', 'out.json', '--no-limit']);
  assert.equal(done.code, 0, done.err);
  assert.doesNotMatch(done.out, /Stopped/);
  assert.match(done.out, /^Converted 44 of 48 titles \(6 ❤️ · 22 👍 · 11 👎 · 5 not interested\)/m);
  const data = box.read('out.json');
  assert.equal(data.titles.length, 44);
  assertImportable(data, 'reviewed');

  // A third run asks nothing
  assert.equal(box.run(['reviewed', RATINGS, '-o', 'out.json', '--no-limit']).requests.length, 0);
});

// What either service's run of the sample says, after the line naming the file
const SAMPLE_SUMMARY = source => `Matched on ${source}: 43
${source === 'TMDB' ? '  OMDb was asked about 8 titles TMDB had no clear match for\n' : ''}
Ambiguous, kept the best-known match (run with -i to choose, or add a year or "(TV)"/"(film)"): 9
  Insomnia → Insomnia (2002, film) · also: Insomnia (1997, film)
  Insomnia → Insomnia (1997, film) · also: Insomnia (2002, film)
  Scarface → Scarface (1983, film) · also: Scarface (1932, film)
  Scarface → Scarface (1932, film) · also: Scarface (1983, film)
  The Office (U.K.) → The Office (2005, series) · also: The Office (2001, series)
  Muppets → The Muppets (2011, film) · also: The Muppets (2015, series)
  Fargo → Fargo (1996, film) · also: Fargo (2014, series)
  Crash → Crash (2004, film) · also: Crash (1996, film)
  Monster → Monster (2003, film) · also: Monster (2023, film)

Unsure, kept the closest match (check these, or run with -i to choose): 4
  Hearts of Darkness → Hearts of Darkness: A Filmmaker's Apocalypse (1991, film) · also: Hearts of Darkness (2020, film)
  Aziz Ansari: Intimate Moments → Aziz Ansari: Intimate Moments for a Sensual Evening (2010, film)
  Born Into Brothels → Born into Brothels: Calcutta's Red Light Kids (2004, film)
  MI Ghost Protocol → Mission: Impossible - Ghost Protocol (2011, film)
  Nearly all of these are films: run with --type movie to leave shows out of the matching (a ": Season 1" or "(TV)" title still matches a show)

Not found, kept without an IMDb ID (they won't merge with titles you already have): 1
  Zzz Nonexistent Film

Duplicates left out: 4
  Blade Runner: The Final Cut: the same title as "Blade Runner: Theatrical Cut", which came first and is kept
  Blade Runner: Theatrical & Director's Cut: the same title as "Blade Runner: Theatrical Cut", which came first and is kept
  Donnie Darko: the same title as "Donnie Darko: Director's Cut", which came first and is kept
  Gladiator: the same title as "Gladiator: Extended Edition", which came first and is kept

Import it in the app: Settings → Import.
`;

// Names each service writes differently, matched (IMDb IDs from the fake services)
const MATCHES = {
  'The Hunger Games': 'tt1392170', 'The Bourne Legacy': 'tt1194173', 'WALL·E': 'tt0910970', 'The Taking of Pelham 1 2 3': 'tt1111422',
  'I ♥ Huckabees': 'tt0356721', '500 Days of Summer': 'tt1022603', 'Raising Victor Vargas': 'tt0300214',
  // Only OMDb finds these as written (TMDB calls the first "Se7en", and doesn't show the second)
  // As written: two films, and the famous one over a rare namesake
  Nine: 'tt0875034', 9: 'tt0472033', 'The Black Dahlia': 'tt0387877',
  Scratch: 'tt0143861', '2 Guns': 'tt1272878', 'The Hangover Part II': 'tt1411697', 'Mission: Impossible - Ghost Protocol': 'tt1229238'
};

for (const source of ['OMDb', 'TMDB']) {
  test(`make-import CLI: the sample on ${source}, summary and file in full`, () => {
    const box = sandbox();
    const out = box.run(['reviewed', RATINGS, '-o', 'out.json', '--no-limit', ...(source === 'TMDB' ? ['--tmdb-key', FAKE_KEY] : [])]);
    assert.equal(out.code, 0, out.err);
    assert.equal(out.out, `Looking titles up on ${source === 'TMDB' ? 'TMDB (and OMDb for any it has no clear match for)' : 'OMDb until its quota runs out'}…\n\n` +
      `Converted 44 of 48 titles (6 ❤️ · 22 👍 · 11 👎 · 5 not interested) → out.json\n${SAMPLE_SUMMARY(source)}`);
    if (source === 'TMDB') {
      assert.equal(out.omdb.length, 8, 'only for the titles TMDB had no clear match for');
      assert.ok(out.tmdb.length <= 3 * 48, `${out.tmdb.length} TMDB requests`);
    }
    const data = box.read('out.json');
    assertImportable(data, 'reviewed');
    const ids = Object.fromEntries(data.titles.map(t => [t.title, t.imdbID]));
    for (const [title, id] of Object.entries(MATCHES)) assert.equal(ids[title], id, title);
    assert.equal(ids[source === 'TMDB' ? 'Se7en' : 'Seven'], 'tt0114369', 'Seven, by each service\u2019s name for it');
    assert.deepEqual(plain(data.titles.filter(t => t.title === 'Insomnia').map(t => t.year)), [2002, 1997], 'a name twice: the other title');
    assert.deepEqual(plain(data.titles.filter(t => t.verdict === 'pass').map(t => t.title)),
      ['Blade Runner', 'The Office', 'Love and Other Drugs', 'Aziz Ansari: Intimate Moments for a Sensual Evening', 'The Taking of Pelham 1 2 3'],
      'the zeros: Not interested');
    assert.deepEqual(plain(data.titles.filter(t => t.type === 'series').map(t => t.title)), ['The Office', 'Afro Samurai'], '": Season 1" is a show');
    assert.ok(data.titles.filter(t => t.title !== 'Zzz Nonexistent Film').every(t => /^tt\d+$/.test(t.imdbID)), 'IMDb IDs on every title found');
  });
}

test('make-import CLI: OMDB_KEY alone is used, and its quota running out says so', () => {
  const box = sandbox();
  const out = box.run(['watchlist', box.write('list.txt', 'Arrival\nDune\nHeat\nUp\n'), '-o', 'out.json'], { env: { OMDB_KEY: 'mykey123', FAKE_QUOTA: '3' } });
  assert.equal(out.code, 0, out.err);
  assert.equal(out.omdb.length, 4, 'three, then the refused one: no other key tried');
  assert.ok(out.out.includes('Your key is used up for today'), out.out);
  assertImportable(box.read('out.json'), 'watchlist');
});

test('make-import CLI: a TMDB key that’s turned down stops at once, cleanly', () => {
  const box = sandbox();
  const out = box.run(['watchlist', box.write('list.txt', 'Arrival\nDune\n'), '-o', 'out.json', '--tmdb-key', 'ffffffffffffffffffffffffffffffff']);
  assert.equal(out.code, 0, out.err);
  assert.equal(out.tmdb.length, 1);
  assert.ok(out.out.includes('Stopped: TMDB didn’t accept the key given with --tmdb-key. 0 of 2 rows done'), out.out);
  assert.deepEqual(box.read('out.json').titles, []);
});

test('make-import CLI: -i asks about each unclear title, and the answers stick', () => {
  const box = sandbox();
  const list = box.write('list.txt', 'The Office\t4\nInsomnia\t5\nInsomnia\t3\nZzz Nothing\t2\n');
  const out = box.run(['reviewed', list, '-o', 'out.json', '-i'], { input: '2\n\n\n' });
  assert.equal(out.code, 0, out.err);
  assert.match(out.out, /\[1\] "The Office" could be any of 2:\n  1\) The Office \(2005, series\) · created by Greg Daniels · IMDb 7\.5 \(760k votes\)\n {5}Steve Carell, Jenna Fischer, John Krasinski\n {5}About The Office\.\n {5}https:\/\/www\.imdb\.com\/title\/tt0386676\//);
  assert.match(out.out, /\[3\] "Insomnia" \(its 2nd time in your list\) could be any of 2:\n  1\) Insomnia \(1997, film\)/, 'the one not yet taken first');
  assert.match(out.out, /Matched on OMDb: 3 \(3 chosen by you\)/);
  assert.match(out.out, /Not found, kept without an IMDb ID[^\n]*: 1\n  Zzz Nothing/);
  assert.deepEqual(plain(box.read('out.json').titles.map(t => [t.title, t.year, t.stars])),
    [['The Office', 2001, 4], ['Insomnia', 2002, 5], ['Insomnia', 1997, 3], ['Zzz Nothing', null, 2]]);

  // Without -i, the same answers hold and nothing is asked or looked up
  const again = box.run(['reviewed', list, '-o', 'again.json']);
  assert.equal(again.requests.length, 0);
  assert.deepEqual(plain(box.read('again.json').titles.map(t => t.year)), [2001, 2002, 1997, null]);
  // --ask-again forgets them: Enter for each takes the defaults
  const reset = box.run(['reviewed', list, '-o', 'reset.json', '-i', '--ask-again'], { input: '\n\n\n' });
  assert.deepEqual(plain(box.read('reset.json').titles.map(t => t.year)), [2005, 2002, 1997, null], reset.out);
});

test('make-import CLI: a plain list without lookups makes no requests', () => {
  const box = sandbox();
  const out = box.run(['watchlist', box.write('list.txt', 'Dune (2021)\nSeverance (TV)\n# a comment\n\ntt0111161\n'), '--no-lookup']);
  assert.equal(out.code, 0, out.err);
  assert.equal(out.requests.length, 0);
  assert.match(out.out, /^Converted 2 of 3 titles → .*list-import\.json/m, 'named after the input by default');
  assert.match(out.out, /Left out, no title \(an IMDb ID needs a lookup to get one: drop --no-lookup\): 1\n  tt0111161/);
  const data = box.read('list-import.json');
  assertImportable(data, 'watchlist');
  assert.deepEqual(plain(data.titles.map(t => [t.title, t.year, t.type, t.imdbID, t.want])),
    [['Dune', 2021, 'movie', '', true], ['Severance', null, 'series', '', true]]);
});

test('make-import CLI: usage mistakes exit with an error and write nothing', () => {
  const box = sandbox();
  const list = box.write('list.txt', 'Dune\n');
  for (const [args, message] of [
    [[], /^Usage: node tools\/make-import\.js watchlist\|reviewed/],
    [['seen', list], /^Usage:/],
    [['watchlist', list, '--tmdb-key', 'nope'], /doesn't look like a TMDB key/],
    [['watchlist', list, '-i', '--no-lookup'], /-i chooses between OMDb matches, so it needs lookups/]
  ]) {
    const out = box.run(args);
    assert.equal(out.code, 1, args.join(' '));
    assert.match(out.err, message);
    assert.equal(out.requests.length, 0);
  }
  assert.ok(!fs.existsSync(box.file('list-import.json')));
});
