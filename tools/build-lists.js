// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Builds data/critics.json: critics' ranked lists for review mode, from the
// text files in tools/lists/, one title to a line, in rank order. Each line is
// "Title (Year)"; text copied from a web page also works, as parseList finds
// the titles in it.
//
//   node tools/build-lists.js
//
// To add a list: put its titles in tools/lists/, add it to LISTS here and to
// CRITIC_LISTS in js/review/config.js, and run this.
//
// Each title gets its IMDb ID from Wikidata, which records the year and what
// kind of work it is, so "Mother (2009)" can't turn into another Mother; OMDb is
// the fallback, for a title of exactly that name. A title neither can confirm is
// kept by name, for OMDb to look up when it's dealt, and the build prints it.
// IDs from the last build are kept; delete data/critics.json to look them all up.
// Only titles, years, ranks and IDs are kept, which are facts.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'data', 'critics.json');
const USER_AGENT = 'watchlist-build/1.0 (https://github.com/paulc12s/watchlist)';
const WIKIDATA_PAUSE_MS = 800;
const CONFIG_TEXT = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');
// The app's key, then the shared one, as the app does when its quota runs out
const OMDB_KEYS = [/OMDB_KEY: '([^']+)'/, /OMDB_FALLBACK_KEY: '([^']+)'/].map(key => (CONFIG_TEXT.match(key) || [])[1]);

const LISTS = [
  {
    id: 'critics-nyt-movies', name: 'NYT: best movies of the 21st century', type: 'movie', file: 'nyt-best-movies-21st-century.txt',
    note: 'The New York Times top 100, in rank order', source: 'https://www.nytimes.com/interactive/2025/movies/best-movies-21st-century.html'
  },
  {
    id: 'critics-nyt-tv', name: 'NYT: best TV shows of the 21st century', type: 'series', file: 'nyt-best-tv-21st-century.txt',
    note: 'The New York Times top 100, in rank order. No TMDB key needed', source: 'https://www.nytimes.com/interactive/2026/arts/television/best-tv-shows-21st-century.html'
  },
  {
    id: 'critics-letterboxd-21st', name: 'Letterboxd: top 100 of the 21st century', type: 'movie', file: 'letterboxd-brianformo-21st-century.txt',
    note: 'Brian Formo’s ranking, in order', source: 'https://letterboxd.com/brianformo/list/top-100-of-the-21st-century-so-far/'
  }
];

// "Title (Year)" lines from a list file or text copied from a page: Letterboxd's
// "Poster for Title (2002)" lines, or a plain list with or without rank numbers.
// An IMDb ID after the year settles a title the lookups get wrong, and "series"
// after it marks one that IMDb has as TV in a list of films (Lovers Rock is a
// Small Axe episode), or the app would pass it over. Each title once, in the
// order first seen. Returns [{ title, year, imdbID, type? }]
function parseList(text) {
  const seen = new Set();
  const titles = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim().replace(/^Poster for /, '').replace(/^\d+[.)]\s+/, '');
    const match = line.match(/^(.+?)\s*\((\d{4})\)(?:\s+(tt\d{7,10}))?(?:\s+(series))?$/);
    if (!match) continue;
    const key = `${normalize(match[1])}|${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push({ title: match[1], year: Number(match[2]), imdbID: match[3] || '', ...(match[4] ? { type: match[4] } : {}) });
  }
  return titles;
}

function normalize(title) {
  return title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

async function json(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Wikidata's limits are per client: a pause before each request, and a longer
// one when it says to slow down
async function wikidata(params) {
  const url = `https://www.wikidata.org/w/api.php?${new URLSearchParams({ ...params, format: 'json' })}`;
  for (let attempt = 0; ; attempt++) {
    await wait(WIKIDATA_PAUSE_MS);
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (response.ok) return response.json();
    if (response.status !== 429 || attempt >= 4) throw new Error(`${response.status} ${url}`);
    const seconds = Number(response.headers.get('retry-after')) || 15 * (attempt + 1);
    console.log(`  Wikidata asks to slow down: waiting ${seconds}s`);
    await wait(seconds * 1000);
  }
}

// The closest Wikidata item for a title and year: of that kind of work,
// released that year or a year either side (festival and release dates
// differ). Its name or another name for it matching comes first
const INSTANCE = {
  // Film, feature film, documentary, animated film, animated feature
  movie: ['Q11424', 'Q24869', 'Q93204', 'Q202866', 'Q29168811'],
  // Series, miniseries, program, reality show, animated series, sitcom, docuseries
  series: ['Q5398426', 'Q1259759', 'Q15416', 'Q1261214', 'Q581714', 'Q170238', 'Q3464665']
};

async function fromWikidata({ title, year }, type) {
  const found = await wikidata({ action: 'query', list: 'search', srlimit: '30', srsearch: `${title} haswbstatement:${INSTANCE[type].map(id => `P31=${id}`).join('|')} haswbstatement:P345` });
  const ids = (found.query.search || []).map(hit => hit.title);
  if (!ids.length) return null;
  const candidates = [];
  for (let at = 0; at < ids.length; at += 50) {
    const data = await wikidata({ action: 'wbgetentities', ids: ids.slice(at, at + 50).join('|'), props: 'claims|labels|aliases', languages: 'en' });
    for (const id of ids.slice(at, at + 50)) {
      const entity = data.entities[id] || {};
      const claims = entity.claims || {};
      const imdbID = claims.P345 && claims.P345[0].mainsnak.datavalue ? claims.P345[0].mainsnak.datavalue.value : '';
      // Release date, or when a show started
      const years = [...(claims.P577 || []), ...(claims.P580 || [])].map(claim => (claim.mainsnak.datavalue ? parseInt(claim.mainsnak.datavalue.value.time.slice(1, 5), 10) : 0));
      const label = entity.labels && entity.labels.en ? entity.labels.en.value : '';
      const names = [label, ...((entity.aliases && entity.aliases.en) || []).map(alias => alias.value)];
      if (/^tt\d{7,10}$/.test(imdbID)) candidates.push({ imdbID, years, label, names });
    }
  }
  const same = c => c.names.some(name => normalize(name) === normalize(title));
  const distance = c => Math.min(...c.years.map(y => Math.abs(y - year)), 99);
  return candidates.filter(c => same(c) && distance(c) <= 1).sort((a, b) => distance(a) - distance(b))[0] || null;
}

async function omdb(params) {
  for (const apikey of OMDB_KEYS) {
    const response = await fetch(`https://www.omdbapi.com/?${new URLSearchParams({ apikey, ...params })}`);
    const data = await response.json().catch(() => null);
    if (data && !/limit|api key/i.test(data.Error || '')) return data;
  }
  throw new Error('OMDb: no key has quota left');
}

// Only a title of exactly this name: OMDb's closest match can be another film
async function fromOmdb({ title, year }, type) {
  for (const y of [year, year + 1, year - 1]) {
    const data = await omdb({ t: title, y: String(y), type });
    if (data.Response === 'True' && /^tt\d{7,10}$/.test(data.imdbID || '') && normalize(data.Title || '') === normalize(title)) return { imdbID: data.imdbID, label: data.Title };
  }
  return null;
}

async function resolve(entry, type) {
  if (entry.imdbID) return { key: entry.imdbID, from: 'file', label: entry.title };
  const wiki = await fromWikidata(entry, type).catch(error => { console.warn(`  Wikidata: ${error.message}`); return null; });
  if (wiki) return { key: wiki.imdbID, from: 'wikidata', label: wiki.label };
  const omdb = await fromOmdb(entry, type).catch(error => { console.warn(`  OMDb: ${error.message}`); return null; });
  if (omdb) return { key: omdb.imdbID, from: 'omdb', label: omdb.label };
  return { key: `title:${entry.title} (${entry.year})`, from: 'none', label: '' };
}

// IDs an earlier build found, so a rebuild only looks up what's new
function earlierIDs() {
  const found = new Map();
  if (!fs.existsSync(OUTPUT)) return found;
  const { titles } = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
  for (const [key, [title, year, type]] of Object.entries(titles)) {
    if (key.startsWith('tt')) found.set(`${normalize(title)}|${year}|${type}`, key);
  }
  return found;
}

async function main() {
  const earlier = earlierIDs();
  const out = { generated: new Date().toISOString().slice(0, 10), source: 'Critics’ published rankings; IMDb IDs from Wikidata (CC0) and OMDb.', lists: [], titles: {} };
  for (const list of LISTS) {
    const entries = parseList(fs.readFileSync(path.join(__dirname, 'lists', list.file), 'utf8'));
    console.log(`${list.name}: ${entries.length} titles`);
    const keys = [];
    for (const entry of entries) {
      const known = !entry.imdbID && earlier.get(`${normalize(entry.title)}|${entry.year}|${list.type}`);
      const found = known ? { key: known, from: 'earlier', label: entry.title } : await resolve(entry, list.type);
      if (found.from === 'none') console.log(`  NOT FOUND  ${entry.title} (${entry.year})`);
      else if (found.from === 'omdb') console.log(`  OMDB       ${entry.title} (${entry.year}) -> ${found.label} ${found.key}`);
      if (keys.includes(found.key)) console.log(`  REPEATED   ${entry.title} -> ${found.key}`);
      else keys.push(found.key);
      out.titles[found.key] = [entry.title, entry.year, entry.type || list.type];
    }
    const { file, ...details } = list;
    out.lists.push({ ...details, group: 'Critics', keys });
  }
  fs.writeFileSync(OUTPUT, `${JSON.stringify(out)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)}`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });

module.exports = { parseList };
