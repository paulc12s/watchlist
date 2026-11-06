// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Turns a list of titles into a file the app imports (Settings → Import).
//
//   node tools/make-import.js watchlist my-list.txt          titles to watch
//   node tools/make-import.js reviewed my-ratings.csv         titles you've seen, with ratings
//
// Options:
//   -o, --out FILE   where to write (default: next to the input, "<name>-import.json")
//   -i               ask about each title that's unclear (below), showing the top
//                    three matches with year, director, cast and plot. Answers are
//                    remembered for later runs; --ask-again forgets them
//   --tmdb-key KEY   look titles up on TMDB rather than OMDb (or set TMDB_KEY): its
//                    search results carry vote counts, so a title costs about 2
//                    requests rather than 2-5, and TMDB has no daily limit
//   --limit N        OMDb lookups stop after N requests a run, 100 by default (a free
//                    key allows about 1,000 a day, and the app on your phone shares
//                    the app's key)
//   --no-limit       go on until OMDb's quota runs out instead
//   --no-lookup      don't look titles up (no IMDb IDs, posters or details)
//   --type TYPE      movie or series, for every title the list doesn't mark; by
//                    default none, and OMDb picks the best-known match
//
// Input, either:
//   - a plain list, one title per line: "Dune", "Dune 2021" or "Dune (2021)";
//     "(TV)" or "(film)" after a name settles which one is meant.
//     For reviewed lists, a rating after a tab, comma, " - " or " | ":
//     "Dune (2021) | 4/5", "Arrival, 👍". Blank lines and lines starting # are skipped
//   - a CSV with a header row. Recognised columns (any order, any case):
//     title/name/film/movie, year, rating/score/stars/verdict/your rating,
//     notes/review/comment, tag/tags (separated by commas), platform/service, priority, date/watched/date rated,
//     rewatch, imdb/imdbid/const, type/title type.
//     IMDb's ratings and watchlist exports and Letterboxd's ratings, diary and
//     watchlist exports are CSVs like this, so they work as they are; IMDb's
//     carry IMDb IDs, so they need no lookup
//
// Ratings (reviewed lists): 👍 / up / like / yes · 👎 / down / dislike / no ·
// ❤️ / love / favourite (👍 with five stars) · 1-5 stars ("4", "4/5", "★★★★",
// "3.5" rounds) · out of ten ("8/10", or an IMDb rating column). Only a full
// top score is five stars, which the app counts as ❤️; 4.5 or 9/10 is four.
// Stars with no thumb: 1-2 stars 👎, otherwise 👍 · Not interested
// (haven't seen it, don't want to): "not interested", 🚫, or 0 as Netflix's
// ratings write it. Not "pass" or "skip", which could mean either. No rating: watched, which counts as 👍
// (undated, as the file gives no date). Rewatch: a rewatch column, or 🔁 / "rewatch" in the rating.
//
// Unclear titles: a name without a year that several known films or shows
// share (another one with 1,000+ IMDb votes, or 100+ TMDB votes, and 2%+ of the best-known one's:
// "The Office", "Crash") keeps the best-known match unless you choose with -i;
// a title whose closest match has another name or is obscure is "unsure" and
// keeps the most-voted title of that name or that name with a subtitle; a
// title not found is kept without an IMDb ID. -i asks about all three. A year,
// "(TV)" or "(film)" settles most of them. Shops' edition words come off
// titles first ("Gladiator: Extended Edition", ": Season 1", ": The Movie").
// A name written twice (Scarface and its remake) takes the next title of that
// name; editions of one film are one title, and the first row's rating is kept.
// The run ends with a summary: how many were converted and matched, and each
// title that was ambiguous, not found, left out or failed, and why.
//
// Lookups use OMDb through the app's own client (js/omdb.js), with the app's
// key falling back to the demo key; set OMDB_KEY to use only your own. A run
// stops after 100 OMDb requests (see --no-limit), or when the quota runs out,
// writing the titles done so far; running it again carries on from there. A title
// without a year costs 2-5 requests of the key's daily quota (about 1,000).
// With a TMDB key they use TMDB instead (js/review/tmdb.js), about 2 a title
// with no daily limit, and OMDb only for titles TMDB has no clear match for; TMDB's vote counts are about a tenth of IMDb's, so a
// known title there is 100+ votes. Results are cached in tools/.cache/, so
// running again costs nothing. Every record then
// goes through the app's own checks (Title.sanitize) and file format
// (Library.fileText), so the file imports exactly as the app's exports do.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
// For tests (tests/make-import-cli.test.js): MAKE_IMPORT_CACHE puts the cache
// elsewhere, MAKE_IMPORT_DELAY_MS sets the pause between requests
const CACHE = process.env.MAKE_IMPORT_CACHE || path.join(__dirname, '.cache', 'omdb-lookups.json');
const DELAY_MS = process.env.MAKE_IMPORT_DELAY_MS === undefined ? null : Number(process.env.MAKE_IMPORT_DELAY_MS) || 0;

// The app's own code: records, files, and the OMDb and TMDB clients
function loadApp() {
  const context = vm.createContext({ console, fetch, AbortController, setTimeout, clearTimeout, URL, URLSearchParams, crypto });
  const files = ['js/config.js', 'js/security.js', 'js/title.js', 'js/library.js', 'js/omdb.js', 'js/movie-api.js', 'js/review/config.js', 'js/review/tmdb.js'];
  vm.runInContext(`${files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')}\nthis.app = { CONFIG, Title, Library, OMDb, MovieAPI, TMDB, TMDB_CONFIG };`, context);
  const app = context.app;
  // Your own key alone: when it runs out, lookups stop rather than spending
  // the app's key, which the app on your phone uses
  if (process.env.OMDB_KEY) app.OMDb.keys = [process.env.OMDB_KEY.trim()];
  return app;
}

// ---- Reading the input ----------------------------------------------------------

// One CSV row's fields, quotes and doubled quotes handled
function csvFields(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { fields.push(field); field = ''; }
    else field += c;
  }
  fields.push(field);
  return fields.map(f => f.trim());
}

// Rows of a CSV, keeping line breaks inside quoted fields
function csvRows(text) {
  const rows = [];
  let current = '';
  for (const line of text.split(/\r?\n/)) {
    current = current ? `${current}\n${line}` : line;
    if ((current.match(/"/g) || []).length % 2 === 0) {
      if (current.trim()) rows.push(csvFields(current));
      current = '';
    }
  }
  return rows;
}

// Header names, as each format writes them, to the fields used here
const COLUMNS = {
  title: ['title', 'name', 'film', 'movie', 'show'],
  year: ['year', 'release year'],
  rating: ['rating', 'score', 'stars', 'verdict', 'your rating', 'my rating'],
  review: ['notes', 'note', 'review', 'comment', 'comments'],
  tag: ['tag', 'tags'],
  platform: ['platform', 'service', 'where to watch'],
  priority: ['priority'],
  date: ['date', 'watched', 'watched date', 'date rated', 'date watched'],
  rewatch: ['rewatch'],
  imdb: ['imdb', 'imdbid', 'imdb id', 'const', 'url'],
  type: ['type', 'title type']
};

function columnsOf(header) {
  const found = {};
  header.forEach((name, i) => {
    const clean = name.toLowerCase().replace(/^﻿/, '').trim();
    for (const [field, names] of Object.entries(COLUMNS)) {
      if (names.includes(clean) && found[field] === undefined) found[field] = i;
    }
  });
  return found.title === undefined ? null : found;
}

// A plain line: "Title", "Title 2021", "Title (2021)", with a rating after a
// tab, comma, " - " or " | " (reviewed lists)
// (or, for emoji and star ratings, just a space: "Heat 👍", "Up ★★★★")
const TRAILING_SYMBOLS = /\s+((?:👍|👎|❤️?|♥️?|🔁|[★⭐]+½?)(?:\s*(?:👍|👎|❤️?|♥️?|🔁|[★⭐]+½?))*)$/u;

function parseLine(line, MovieAPI) {
  // "(TV)", "[series]", "(film)": which kind of title a name means
  let type = '';
  line = line.replace(/\s*[([]\s*(tv|series|show|film|movie)\s*[)\]]/i, (_, kind) => {
    type = /film|movie/i.test(kind) ? 'movie' : 'series';
    return '';
  });
  const symbols = line.match(TRAILING_SYMBOLS);
  if (symbols) line = `${line.slice(0, symbols.index)}\t${symbols[1]}`;
  const [titlePart, ...rest] = line.split(/\t|\s+\|\s+|\s+[-–—]\s+|,\s*(?=[^,]*$)/);
  const parsed = MovieAPI.parseQuery(titlePart);
  if (parsed.imdbID) return { imdb: parsed.imdbID, title: '', rating: rest.join(' ').trim(), type };
  return { title: parsed.title.trim(), year: parsed.year ? Number(parsed.year) : null, rating: rest.join(' ').trim(), type };
}

// Shops' names for editions and seasons, which OMDb's titles don't carry:
// "Gladiator: Extended Edition", "Blade Runner: Theatrical & Director's Cut",
// "Dumb and Dumber: Unrated", "The Office (U.K.)", "Apocalypse Now Redux". ": The Movie" and
// ": Season 1" also say which kind of title it is
const EDITION = /\s*(?::|\s-|\()\s*(?:the\s+)?(?:(?:director'?s|theatrical|final|extended|special|collector'?s|ultimate|anniversary|unrated|uncut|remastered)(?:\s*&\s*director'?s)?(?:\s+(?:cut|edition|version))?|u\.?k\.?|u\.?s\.?)\)?$/i;
const AS_MOVIE = /\s*:\s*the\s+(?:movie|film)$/i;
const AS_SERIES = /\s*:\s*(?:(?:the\s+)?complete\s+)?(?:season|series|volume)\s+\d+$|\s*:\s*the\s+complete\s+series$/i;

function withoutEdition(row) {
  if (!row.title) return row;
  // Two names for one entry: the first ("Apocalypse Now / Apocalypse Now Redux")
  let title = row.title.split(' / ')[0].trim();
  let type = row.type;
  for (let before = ''; before !== title;) {
    before = title;
    title = title.replace(EDITION, '').replace(/\s+redux$/i, '');
    if (AS_MOVIE.test(title)) { title = title.replace(AS_MOVIE, ''); type = type || 'movie'; }
    if (AS_SERIES.test(title)) { title = title.replace(AS_SERIES, ''); type = type || 'series'; }
  }
  return title && title !== row.title ? { ...row, title, type, written: row.title } : row;
}

// Raw rows from either kind of input: [{ title, year, rating, review, tag, ... }]
// (title without edition words; written: the title as written, when they differ)
function readInput(text, MovieAPI) {
  return readRows(text, MovieAPI).map(withoutEdition);
}

function readRows(text, MovieAPI) {
  const rows = csvRows(text);
  const columns = rows.length ? columnsOf(rows[0]) : null;
  if (columns) {
    return rows.slice(1).map(fields => {
      const get = field => (columns[field] === undefined ? '' : fields[columns[field]] || '');
      const imdb = (get('imdb').match(/tt\d{7,10}/) || [])[0] || '';
      // A year in brackets after the title, when there's no year column: "Arrival (1996)"
      const dated = get('title').match(/^(.*\S)\s*\((\d{4})\)$/);
      const year = Number(get('year')) || (dated && Number(dated[2])) || null;
      return {
        title: dated && !Number(get('year')) ? dated[1] : get('title'), year, rating: get('rating'), review: get('review'),
        tag: get('tag'), platform: get('platform'), priority: get('priority').toLowerCase(), date: get('date'),
        rewatch: /^(1|y|yes|true|x|✓|🔁)$/i.test(get('rewatch')), imdb, type: get('type')
      };
    }).filter(r => r.title || r.imdb);
  }
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => parseLine(l, MovieAPI));
}

// ---- Ratings --------------------------------------------------------------------

// A rating as written, into review fields: { verdict, stars, rewatch } or
// null when there's no rating; throws on one it can't read
function parseRating(raw) {
  let text = String(raw || '').trim();
  const rewatch = /🔁|\brewatch\b/i.test(text);
  text = text.replace(/🔁|\brewatch\b/gi, '').trim().toLowerCase();
  if (!text) return rewatch ? { rewatch } : null;
  if (/^(❤️?|♥️?|love|loved|favou?rite|fav|heart)$/.test(text)) return { verdict: 'up', stars: 5, rewatch };
  if (/^(👍|up|like|liked|yes|y|\+|good|thumbs? ?up)$/.test(text)) return { verdict: 'up', rewatch };
  if (/^(👎|down|dislike|disliked|no|n|-|bad|thumbs? ?down)$/.test(text)) return { verdict: 'down', rewatch };
  // Not interested: haven't seen it, don't want to (the app's verdict 'pass').
  // Netflix's ratings write it as 0
  if (/^(not[\s-]?interested|uninterested|🚫|0(?:\s*\/\s*\d+)?)$/u.test(text)) return { verdict: 'pass' };
  // Out of five, rounded, with five kept for a full score
  const toStars = exact => (exact >= 5 ? 5 : Math.min(4, Math.round(exact)));
  const starGlyphs = text.match(/^[★⭐]+(½)?$/u);
  if (starGlyphs) return { stars: toStars(Math.min(5, [...text.replace('½', '')].length + (starGlyphs[1] ? 0.5 : 0))), rewatch };
  const outOf = text.match(/^(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+))?\s*(?:stars?)?$/);
  if (outOf) {
    const value = Number(outOf[1]);
    const scale = outOf[2] ? Number(outOf[2]) : value > 5 ? 10 : 5;
    const stars = toStars((value / scale) * 5);
    if (scale > 0 && value >= 0 && value <= scale && stars >= 1) return { stars, rewatch };
  }
  throw new Error(`can't read the rating "${raw}"`);
}

// ---- Matching -------------------------------------------------------------------

// How many matches an unclear title offers to choose from
const CANDIDATES = 3;
// Another title of the same name makes a name ambiguous only when it's known
// too: this share of the best-known one's votes, and at least each source's
// knownVotes. Without it every name is ambiguous, as both list student films
// and web series
const KNOWN_SHARE = 0.02;
// Lookups stop after this many errors in a row
const MAX_ERRORS = 3;
// OMDb requests one run makes, unless --no-limit: a tenth of a free key's
// daily quota (about 1,000), which the app on your phone shares
const OMDB_LIMIT = 100;

// Thrown when lookups have to stop: the run ends there, writing what's done.
// reason: 'limit' (this run's OMDb requests), 'quota' (OMDb's daily quota ran
// out), 'key' (the key was turned down) or 'errors' (several in a row)
class Stop extends Error {
  constructor(reason, message) {
    super(message);
    this.stop = reason;
  }
}
// TMDB allows about 40 requests a second; this stays well under
const TMDB_DELAY_MS = 60;

// Numbers as words and Roman numerals, as digits: "Two Guns" is "2 Guns",
// "Ocean's Eleven" is "Ocean's 11", "Part II" is "2". I, V and X are left
// alone, as words and letters ("Malcolm X")
const NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  ii: 2, iii: 3, iv: 4, vi: 6, vii: 7, viii: 8, ix: 9
};

// A title for comparing: no case, accents, punctuation or leading article
// ("The Hunger Games" is "hunger games"), & and ♥ as words, numbers as digits
// and "Part" before one dropped ("The Hangover Part II" is "hangover 2")
// (strict: the article and numbers as written)
const normalTitle = (text, strict = false) => {
  const plain = String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[♥❤]\ufe0f?/g, ' heart ').replace(/[^a-z0-9]+/g, ' ').trim();
  if (strict) return plain;
  return plain.split(' ').map(word => (word in NUMBERS ? String(NUMBERS[word]) : word)).join(' ')
    .replace(/\bpart (\d+)\b/g, '$1').replace(/^(?:the|a|an) /, '');
};

// The same name, spaces aside too: "WALL-E" is "WALL·E", "I Heart Huckabees"
// is "I ♥ Huckabees"; and unless strict, the article and how numbers are
// written aside: "Hunger Games" is "The Hunger Games", "Two Guns" is "2 Guns"
const sameTitle = (a, b, strict = false) => normalTitle(a, strict).replace(/ /g, '') === normalTitle(b, strict).replace(/ /g, '');

// A longer title that starts with this name, with a subtitle ("Talladega
// Nights: The Ballad of Ricky Bobby") or, for a name of three words or more,
// without ("Aziz Ansari: Intimate Moments for a Sensual Evening"). A short
// name isn't the start of any title that begins with it: "Blue" isn't "Blue Velvet"
const extendsTitle = (longer, name) => normalTitle(longer).startsWith(`${normalTitle(name)} `) &&
  (normalTitle(name).split(' ').length >= 3 || sameTitle(String(longer).split(/\s*[:(]\s*|\s+[-–—]\s+/)[0], name));

// A name with capitals standing for words: "MI Ghost Protocol" is
// "Mission: Impossible - Ghost Protocol". Only 2-4 letters written in capitals
const abbreviates = (longer, name) => {
  const caps = new Set((String(name).match(/\b[A-Z]{2,4}\b/g) || []).map(word => word.toLowerCase()));
  if (!caps.size) return false;
  const have = normalTitle(longer).split(' ');
  let at = 0;
  for (const word of normalTitle(name).split(' ')) {
    if (have[at] === word) at++;
    else if (caps.has(word) && have.slice(at, at + word.length).map(w => w[0]).join('') === word) at += word.length;
    else return false;
  }
  return at === have.length;
};

// What to search for: the title, then (each only while nothing found has the
// name) the title without punctuation, spaced and run together ("WALL-E" as
// "WALL E", "WALLE"). Each is cached on its own
const queries = title => [...new Set([title, title.replace(/[^\p{L}\p{N}']+/gu, ' ').trim(), title.replace(/[^\p{L}\p{N}\s']+/gu, '').trim()])].filter(Boolean);

// What a row was written as, for messages
const label = row => `${row.written || row.title || row.imdb}${row.year ? ` (${row.year})` : ''}`;

// A request's answer, from the cache when asked before; new ones wait a
// moment so a long list doesn't hammer the service
async function remember(cache, key, delay, ask) {
  if (!(key in cache)) {
    cache[key] = await ask();
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  return cache[key];
}

// ---- Sources: where titles are looked up ----------------------------------------
// Each gives records in OMDb's shape (js/omdb.js parseDetails) plus votes, and:
//   byImdb(id)          the record for an IMDb ID, or null
//   guess(row, type)    the service's own best match, or null (OMDb only)
//   search(row, type)   the titles a search finds; with votes when the
//                       service's results carry them (TMDB's do)
//   full(item)          a search result's full record, with its IMDb ID

// OMDb: votes are IMDb's. A search result has none, so each title of the same
// name costs a request; the best guess is cached under its IMDb ID too, so it
// isn't asked for twice
function omdbSource(app, cache, { limit = Infinity } = {}) {
  const ask = (key, fn) => remember(cache, key, DELAY_MS ?? app.CONFIG.BATCH_DELAY_MS, fn);
  // Every request is counted against this run's limit; cached answers aren't requests
  let used = 0;
  const omdb = Object.create(app.OMDb);
  omdb.request = async params => {
    if (used >= limit) throw new Stop('limit', `${used} OMDb requests`);
    used++;
    try {
      return await app.OMDb.request(params);
    } catch (error) {
      // The client has already tried each of its keys
      if (/limit/i.test(error.message)) throw new Stop('quota', error.message);
      if (/api key/i.test(error.message)) throw new Stop('key', error.message);
      throw error;
    }
  };
  // Records from before vote counts were kept are asked again
  const fresh = key => { if (cache[key] && !('votes' in cache[key])) delete cache[key]; return key; };
  const details = async params => {
    const data = await omdb.request({ plot: 'short', ...params });
    const record = data.Response === 'True' ? app.OMDb.parseDetails(data) : null;
    if (record) record.votes = parseInt(String(data.imdbVotes || '').replace(/,/g, ''), 10) || 0;
    return record;
  };
  const byImdb = id => ask(fresh(`i:${id}`), () => details({ i: id }));
  return {
    name: 'OMDb',
    knownVotes: 1000,
    get used() { return used; },
    byImdb,
    async guess(row, type) {
      // For the year or either side of it; "&" and "and" both ways ("Love
      // and Other Drugs" is "Love & Other Drugs")
      const best = await ask(fresh(`t:${row.title.toLowerCase()}|${row.year || ''}|${type}`), async () => {
        const swapped = / & /.test(row.title) ? row.title.replace(/ & /g, ' and ') : / and /i.test(row.title) ? row.title.replace(/ and /gi, ' & ') : '';
        for (const t of [row.title, swapped].filter(Boolean)) {
          for (const y of row.year ? [row.year, row.year + 1, row.year - 1] : ['']) {
            const record = await details({ t, y, ...(type ? { type } : {}) });
            if (record) return record;
          }
        }
        return null;
      });
      if (best && !(`i:${best.imdbID}` in cache)) cache[`i:${best.imdbID}`] = best;
      return best;
    },
    async search(row, type) {
      const all = [];
      for (const s of queries(row.title)) {
        all.push(...await ask(`s:${s.toLowerCase()}|${type}`, async () => (await app.OMDb.search.call(omdb, { s, ...(type ? { type } : {}) })).items));
        if (all.some(item => sameTitle(item.title, row.title))) break;
      }
      return all;
    },
    full: async item => (item.votes !== undefined ? item : (await byImdb(item.imdbID)) || item)
  };
}

// TMDB: votes are TMDB's own (about a tenth of IMDb's), and come with every
// search result, so ranking a name's titles costs nothing more; only the
// title picked costs a request, for its IMDb ID, cast and director
// fallback: an OMDb source, asked for its best guess when TMDB has no clear
// match ("Seven", which TMDB calls "Se7en"; "Scratch", the 2001 one, which
// TMDB's search doesn't show). Its requests count to OMDb's limit; if OMDb
// has to stop, TMDB carries on without it
function tmdbSource(app, cache, { fallback = null } = {}) {
  const ask = (key, fn) => remember(cache, `tmdb:${key}`, DELAY_MS ?? TMDB_DELAY_MS, fn);
  let fallbackStopped = '';
  const request = async (...args) => {
    try {
      return await app.TMDB.request(...args);
    } catch (error) {
      // The app's message points at its Settings
      throw /accept the key/.test(error.message) ? new Stop('key', 'TMDB didn’t accept the key given with --tmdb-key') : error;
    }
  };
  const text = (value, max) => (typeof value === 'string' ? value.substring(0, max) : '');
  const yearOf = date => parseInt(String(date || '').slice(0, 4), 10) || null;
  const names = list => (Array.isArray(list) ? list.map(item => item && text(item.name, 100)).filter(Boolean) : []);
  const poster = value => (typeof value === 'string' && /^\/[\w.-]+$/.test(value) ? app.TMDB_CONFIG.IMAGE_URL + value : '');
  const votes = data => (Number.isInteger(data.vote_count) ? data.vote_count : 0);
  // A search result: enough to rank and show, without an IMDb ID yet
  const brief = (data, type) => ({
    tmdbId: data.id, type, title: text(data.title || data.name, 500), original: text(data.original_title || data.original_name, 500),
    year: yearOf(data.release_date || data.first_air_date), votes: votes(data), votesFrom: 'TMDB', plot: text(data.overview, 1000), poster: poster(data.poster_path)
  });
  const full = async item => {
    if (item.imdbID !== undefined) return item;
    const kind = item.type === 'series' ? 'tv' : 'movie';
    const record = await ask(`${kind}:${item.tmdbId}`, async () => {
      const data = await request(`/${kind}/${item.tmdbId}`, { append_to_response: kind === 'tv' ? 'external_ids,aggregate_credits' : 'external_ids,credits' });
      if (!data) return null;
      const credits = (kind === 'tv' ? data.aggregate_credits : data.credits) || {};
      const imdbID = [data.imdb_id, data.external_ids && data.external_ids.imdb_id].find(id => /^tt\d{7,10}$/.test(id || '')) || '';
      return {
        ...brief(data, item.type), imdbID, genres: names(data.genres),
        director: kind === 'tv' ? names(data.created_by).join(', ') : names((credits.crew || []).filter(c => c && c.job === 'Director')).join(', '),
        writer: kind === 'tv' ? names(data.created_by).join(', ') : '',
        actors: names(credits.cast).slice(0, 5).join(', '),
        runtime: Number.isInteger(data.runtime) && data.runtime > 0 ? `${data.runtime} min` : ''
      };
    });
    return record || item;
  };
  return {
    name: 'TMDB',
    knownVotes: 100,
    get used() { return fallback ? fallback.used : 0; },
    get fallbackStopped() { return fallbackStopped; },
    // OMDb's best guess, when it's a known title of this name
    async fallback(row, type) {
      if (!fallback || fallbackStopped) return null;
      try {
        const guess = await fallback.guess(row, type);
        return guess && sameTitle(guess.title, row.title) && guess.votes >= fallback.knownVotes ? guess : null;
      } catch (error) {
        if (!error.stop) return null;
        fallbackStopped = error.message;
        return null;
      }
    },
    async byImdb(id) {
      const found = await ask(`find:${id}`, async () => {
        const data = await request(`/find/${id}`, { external_source: 'imdb_id' });
        const movie = data && (data.movie_results || [])[0];
        const show = data && (data.tv_results || [])[0];
        return movie ? brief(movie, 'movie') : show ? brief(show, 'series') : null;
      });
      return found ? full(found) : null;
    },
    guess: null,
    // TMDB's search of everything ranks people and shows high, so a film can
    // miss its first page ("Nine", "Blue"): when it has nothing of this name,
    // films and shows are searched on their own
    async searchMore(row, type) {
      if (type) return [];
      return [...await this.search(row, 'movie'), ...await this.search(row, 'series')];
    },
    async search(row, type) {
      const path = type === 'movie' ? '/search/movie' : type === 'series' ? '/search/tv' : '/search/multi';
      const all = [];
      for (const query of queries(row.title)) {
        const found = await ask(`s:${query.toLowerCase()}|${type}`, async () => {
          const data = await request(path, { query, include_adult: 'false' });
          return ((data && data.results) || [])
            .map(result => ({ result, kind: type || (result.media_type === 'tv' ? 'series' : result.media_type === 'movie' ? 'movie' : '') }))
            .filter(({ result, kind }) => kind && result && Number.isInteger(result.id))
            .map(({ result, kind }) => brief(result, kind));
        });
        all.push(...found);
        if (all.some(item => sameTitle(item.title, row.title) || sameTitle(item.original, row.title))) break;
      }
      return all;
    },
    full
  };
}

// ---- Choosing a match -----------------------------------------------------------

// One title, whichever source it came from
const idOf = item => item.imdbID || `tmdb:${item.type}:${item.tmdbId}`;

// What a row matches: { status, details, others }
//   matched     one clear match (an IMDb ID, a title and year, or the only known title of that name)
//   ambiguous   several known titles of that name: details is the best-known one, others the rest
//   unsure      the closest match has another name, or is obscure: check it
//   chosen      you chose one (with -i, now or on an earlier run)
//   notFound    no match; others are the closest search results, if any
//   unmatched   you chose none of the matches: kept without an IMDb ID
//   skipped     you chose to leave it out
// A title with a year matches that year or either side (festival and US
// release dates differ). choose(row, options, { ambiguous, unsure, occurrence })
// asks you, and answers an IMDb ID, null (none of these) or 'skip'.
async function resolve(row, source, cache, typeHint, choose, { occurrence = 0, taken = new Set() } = {}) {
  if (row.imdb) {
    const details = await source.byImdb(row.imdb);
    return { status: details ? 'matched' : 'notFound', details, others: [] };
  }
  const type = /series|tv/i.test(row.type) ? 'series' : /movie|film/i.test(row.type) ? 'movie' : typeHint;
  const key = `t:${row.title.toLowerCase()}|${row.year || ''}|${type}`;
  const best = source.guess ? await source.guess(row, type) : null;
  if (best && row.year && sameTitle(best.title, row.title) && !occurrence) return { status: 'matched', details: best, others: [] };

  let found = await source.search(row, type);
  const unique = list => list.filter(Boolean).filter((item, i, all) => all.findIndex(other => idOf(other) === idOf(item)) === i);
  const byVotes = list => [...list].sort((a, b) => (b.votes || 0) - (a.votes || 0));
  const withVotes = async items => {
    const out = [];
    for (const item of items) out.push(item.votes !== undefined ? item : await source.full(item));
    return out;
  };
  const near = item => !row.year || Math.abs((parseInt(item.year, 10) || -1e4) - row.year) <= 1;
  const namedAs = strict => item => sameTitle(item.title, row.title, strict) || (item.original && sameTitle(item.original, row.title, strict));
  // The name as written, when a known title has it; otherwise without its
  // article, and numbers however written ("Heat" isn't "The Heat", "Nine"
  // isn't "9"; but "Hunger Games" is "The Hunger Games", and "Two Guns", whose
  // only namesake has no votes, is "2 Guns")
  // (OMDb's search results carry no votes: its best guess's count, when it's the same title)
  const votesOf = item => item.votes ?? (best && item.imdbID === best.imdbID ? best.votes : undefined);
  const known = item => votesOf(item) === undefined || votesOf(item) >= source.knownVotes;
  const asWritten = () => [best, ...found].some(item => item && namedAs(true)(item) && known(item));
  if (source.searchMore && !asWritten()) found = unique([...found, ...await source.searchMore(row, type)]);
  const named = asWritten() ? namedAs(true) : namedAs(false);

  // Every title of exactly this name (and year, if given), most-voted first:
  // the best-known one is the match, and the others known enough to be meant
  // make it ambiguous
  const same = byVotes(await withVotes(unique([best, ...found].filter(item => item && named(item) && near(item))).slice(0, CANDIDATES + 1)));
  let status;
  let candidates;
  // An obscure title is the match too when it's the only one of this name,
  // and no title that extends the name is better known (or may be: OMDb's
  // search results carry no votes). With a year, the title of this name from
  // then is the match however obscure
  const choiceKey = `choice:${key}${occurrence ? `#${occurrence + 1}` : ''}`;
  // No known title of this name: another source's best guess, if it has one
  if (source.fallback && !(choiceKey in cache) && !(same.length && same[0].votes >= source.knownVotes)) {
    const other = await source.fallback(row, type);
    if (other && !taken.has(other.imdbID)) return { status: 'matched', details: (await source.byImdb(other.imdbID)) || other, others: [] };
  }
  const longer = found.filter(item => extendsTitle(item.title, row.title) && near(item));
  const alone = same.length === 1 && !longer.some(item => item.votes === undefined || item.votes > same[0].votes);
  if (same.length && (same[0].votes >= source.knownVotes || row.year || alone)) {
    const top = same[0];
    candidates = [top, ...same.slice(1).filter(item => item.votes >= Math.max(source.knownVotes, KNOWN_SHARE * top.votes))];
    status = candidates.length > 1 ? 'ambiguous' : 'matched';
  } else if (best || same.length || found.length) {
    // Unsure: the closest match has another name ("Not a Love Story: Making
    // (500) Days of Summer"), or a title of this name is obscure beside one
    // that extends it. The closest results, most-voted first; the match is the
    // most-voted of those named this, or that extend it ("Hearts of Darkness:
    // A Filmmaker's Apocalypse", "Aziz Ansari: Intimate Moments for a Sensual Evening")
    let pool = unique([best, ...same, ...found]);
    if (row.year) {
      const off = item => Math.abs((parseInt(item.year, 10) || -1e4) - row.year);
      pool = pool.sort((a, b) => off(a) - off(b));
    }
    // Every result when they come with votes (TMDB's do); otherwise the first few, looked up
    candidates = pool.every(item => item.votes !== undefined) ? byVotes(pool).slice(0, CANDIDATES + 1) : byVotes(await withVotes(pool.slice(0, CANDIDATES + 1)));
    const fits = item => (named(item) || extendsTitle(item.title, row.title) || abbreviates(item.title, row.title)) && near(item);
    const pick = candidates.find(fits);
    if (pick) candidates = unique([pick, ...candidates]);
    status = pick ? 'unsure' : 'notFound';
  } else {
    return { status: 'notFound', details: null, others: [] };
  }
  // A name that comes up again takes the next title of that name (the first
  // Insomnia is the 2002 one, the second the 1997 one), here and when asked
  const top = candidates[0];
  const isTaken = item => taken.has(idOf(item)) || (item.tmdbId && taken.has(`tmdb:${item.type}:${item.tmdbId}`));
  candidates = candidates.slice(0, CANDIDATES);
  if (occurrence) candidates = [...candidates.filter(item => !isTaken(item)), ...candidates.filter(isTaken)];
  if (status === 'matched' && candidates[0] !== top) status = 'ambiguous';

  // Your answer, if you've given one (to either source): each time a name
  // comes up in the list is asked about on its own (Scarface and its remake)
  let options = null;
  if (status !== 'matched' && !(choiceKey in cache) && choose) {
    options = [];
    for (const item of candidates) options.push(await source.full(item));
    cache[choiceKey] = await choose(row, options, { ambiguous: status === 'ambiguous', unsure: status === 'unsure', occurrence });
  }
  if (choiceKey in cache) {
    const answer = cache[choiceKey];
    if (answer === 'skip') return { status: 'skipped', details: null, others: [] };
    if (!answer) return { status: 'unmatched', details: null, others: [] };
    const details = (options || []).find(item => item.imdbID === answer) || await source.byImdb(answer);
    return { status: details ? 'chosen' : 'notFound', details, others: [] };
  }
  if (status === 'notFound') return { status, details: null, others: candidates };
  // The match's full record: for TMDB, this is where its IMDb ID comes from.
  // One without an IMDb ID gives way to the next that has one
  for (const [i, item] of candidates.entries()) {
    const details = await source.full(item);
    if (details.imdbID || i === candidates.length - 1) return { status, details, others: candidates.filter(other => other !== item) };
  }
}

// ---- Building the file ----------------------------------------------------------

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch (error) {
    return {};
  }
}

// The import file's text for a list, and what happened to each line:
//   report = { rows, matched, chosen, ambiguous / unsure: [{ title, picked, others }],
//     notFound: [{ title, others }], unmatched, skipped, badRatings, duplicates (each a line), untitled,
//     lookupErrors, stopped: { reason, message, done, next } or null, requests, ratings: { loved, up, down, notInterested, unrated },
//     kinds: { movie, series } }
// choose: see resolve; onChoice runs after each answer (the command line saves the cache)
// tmdbKey: look titles up on TMDB instead of OMDb
// limit: OMDb requests this run may make. When lookups have to stop (that
// limit, OMDb's quota, a rejected key, errors in a row) the run ends there:
// the file holds the rows done so far, and report.stopped says why
async function build(kind, text, { lookup = true, type = '', app = loadApp(), cache = {}, choose = null, onChoice = () => {}, tmdbKey = '', limit = Infinity } = {}) {
  const rows = readInput(text, app.MovieAPI);
  if (tmdbKey) app.TMDB.key = tmdbKey;
  const source = tmdbKey ? tmdbSource(app, cache, { fallback: lookup ? omdbSource(app, cache, { limit }) : null }) : omdbSource(app, cache, { limit });
  const records = [];
  const report = {
    source: source.name, rows: rows.length, matched: 0, chosen: 0, ambiguous: [], unsure: [], notFound: [], unmatched: [], skipped: [],
    badRatings: [], duplicates: [], untitled: [], lookupErrors: [], stopped: null, requests: 0,
    ratings: { loved: 0, up: 0, down: 0, notInterested: 0, unrated: 0 }, kinds: { movie: 0, series: 0 }
  };
  const asking = choose && (async (...args) => {
    const answer = await choose(...args);
    onChoice();
    return answer;
  });
  const seen = new Map();
  const taken = new Set();
  const times = {};
  let errorsInARow = 0;
  for (const [index, row] of rows.entries()) {
    let rating = null;
    if (kind === 'reviewed') {
      try {
        rating = parseRating(row.rating);
      } catch (error) {
        report.badRatings.push(`${label(row)}: ${error.message}`);
        continue;
      }
    }
    let match = { status: 'off', details: null, others: [] };
    if (lookup) {
      try {
        // Counted as written: "Blade Runner: Final Cut" and "Blade Runner:
        // Theatrical Cut" are one film, two "Insomnia"s are two
        const name = `${row.imdb || (row.written || row.title).toLowerCase()}|${row.year || ''}|${row.type}`;
        const occurrence = times[name] = (times[name] ?? -1) + 1;
        match = await resolve(row, source, cache, type, asking, { occurrence, taken });
        errorsInARow = 0;
      } catch (error) {
        const stop = error.stop ? error : ++errorsInARow >= MAX_ERRORS ? new Stop('errors', error.message) : null;
        if (stop) {
          report.stopped = { reason: stop.stop, message: stop.message, done: index, next: label(row) };
          break;
        }
        // Left out, so a later run can try again: kept without an IMDb ID it
        // wouldn't merge with the title once imported
        report.lookupErrors.push(`${label(row)}: ${error.message}`);
        continue;
      }
    }
    // A TMDB title without an IMDb ID wouldn't merge with titles you have: not found
    if (match.details && !match.details.imdbID && !row.imdb) match = { status: 'notFound', details: null, others: [match.details] };
    const { status, details, others } = match;
    if (status === 'skipped') { report.skipped.push(label(row)); continue; }

    const base = details || { title: row.title, year: row.year, imdbID: row.imdb, type: /series|tv/i.test(row.type) ? 'series' : type || 'movie' };
    const date = Date.parse(row.date);
    const record = app.Title.sanitize({
      ...base,
      tags: row.tag, platform: row.platform, review: row.review,
      priority: ['watching', 'high', 'medium', 'low'].includes(row.priority) ? row.priority : '',
      ...(kind === 'watchlist'
        ? { want: true }
        // Seen: a rating of its own (dated) or, with none, the default 👍 of a watched title
        // Stars without a thumb take the app's rule: 1-2 stars 👎, otherwise 👍
        : { want: false, ...(rating || {}), verdict: (rating && rating.verdict) || (rating && rating.stars ? app.Title.impliedThumb(rating.stars) : 'up'),
          rewatch: Boolean((rating && rating.rewatch) || row.rewatch),
          ...(rating ? { reviewDate: new Date(Number.isNaN(date) ? Date.now() : date).toISOString() } : {}) })
    });
    if (!record) {
      // The app's checks turn down a record without a title: an IMDb ID needs a lookup for one
      report.untitled.push(label(row));
      continue;
    }
    // Without an IMDb ID (no lookup, or not found) the same title and year is the same line
    const id = record.imdbID ? `imdb:${record.imdbID}` : `${record.title.toLowerCase()}|${record.year || ''}|${record.type}`;
    if (seen.has(id)) {
      report.duplicates.push(`${label(row)}: the same title as "${seen.get(id)}", which came first and is kept`);
      continue;
    }
    seen.set(id, label(row));
    records.push(record);
    // Counted once written, so a duplicate isn't counted twice
    if (status === 'matched') report.matched++;
    if (status === 'chosen') report.chosen++;
    if (status === 'ambiguous') report.ambiguous.push({ title: label(row), picked: details, others });
    if (status === 'unsure') report.unsure.push({ title: label(row), picked: details, others });
    if (status === 'notFound') report.notFound.push({ title: label(row), others });
    if (status === 'unmatched') report.unmatched.push(label(row));
    if (record.imdbID) taken.add(record.imdbID);
    if (details && details.tmdbId) taken.add(`tmdb:${details.type}:${details.tmdbId}`);
    report.kinds[record.type === 'series' ? 'series' : 'movie']++;
    if (kind === 'reviewed') {
      const tally = record.verdict === 'pass' ? 'notInterested' : !record.reviewDate ? 'unrated' : app.Title.isLoved(record) ? 'loved' : record.verdict;
      if (tally in report.ratings) report.ratings[tally]++;
    }
  }
  report.requests = source.used || 0;
  report.fallbackStopped = source.fallbackStopped || '';
  return { text: app.Library.fileText(records, `make-import-${kind}`), count: records.length, report };
}

// ---- Command line -----------------------------------------------------------------

// A match in one line: "Dune (2021, film)"
const brief = item => `${item.title} (${[item.year, item.type === 'series' ? 'series' : 'film'].filter(Boolean).join(', ')})`;

// What was done, as lines of text
// Why a run stopped early, and how to go on
function stopNote(report, { ownKey }) {
  const { reason, message, done, next } = report.stopped;
  const left = report.rows - done;
  const where = `${done} of ${report.rows} rows done; the other ${left} (from "${next}" on) aren't in the file yet.`;
  const keys = ownKey
    ? 'This run used your OMDB_KEY only.'
    : 'This run used the app\'s own OMDb key, then OMDb\'s shared demo key; the app on your phone uses the same key, so what this spends, the app can\'t use for looking titles up until the quota resets.';
  const again = 'Run the same command again to carry on: titles already looked up come from the cache in tools/.cache/ and cost nothing, and the file is written again with everything done so far.';
  const other = 'Or look titles up on TMDB with --tmdb-key KEY (about 2 requests a title, no daily limit).';
  if (reason === 'limit') {
    return [
      `Stopped after ${report.requests} OMDb requests, the most one run makes (--limit). ${where}`,
      `  Why: a free OMDb key allows about 1,000 requests a day, and a title without a year costs 2-5. ${keys}`,
      `  ${again}`,
      `  To allow more in one run, add --limit N, or --no-limit to go on until the quota runs out${ownKey ? '' : ' (better with a key of your own: OMDB_KEY=yourkey)'}. ${other}`
    ];
  }
  if (reason === 'quota') {
    return [
      `Stopped: OMDb's daily quota ran out ("${message.replace(/^OMDb: /, '')}") after ${report.requests} requests this run. ${where}`,
      `  ${ownKey ? 'Your key is used up for today.' : 'The app\'s key and the demo key are both used up for today, so the app on your phone can\'t look titles up either until the quota resets.'}`,
      `  ${again.replace('again', 'again tomorrow')}`,
      `  ${other}`
    ];
  }
  if (reason === 'key') return [`Stopped: ${message}. ${where}`, '  Check the key, then run the same command again.'];
  return [`Stopped after ${MAX_ERRORS} lookups in a row failed (the last: ${message}). ${where}`, `  ${again}`];
}

function summary(kind, report, count, out, { lookup, interactive, type = '', ownKey = false }) {
  const lines = [];
  const section = (heading, items) => {
    if (!items.length) return;
    lines.push('', `${heading}: ${items.length}`, ...items.map(item => `  ${item}`));
  };
  const r = report.ratings;
  const tally = kind === 'reviewed'
    ? ` (${[[r.loved, '❤️'], [r.up, '👍'], [r.down, '👎'], [r.notInterested, 'not interested'], [r.unrated, 'with no rating, so 👍']].filter(([n]) => n).map(([n, what]) => `${n} ${what}`).join(' · ')})`
    : '';
  const of = report.stopped ? `titles from the first ${report.stopped.done} of ${report.rows} rows` : `of ${report.rows} titles`;
  lines.push(`Converted ${count} ${of}${count ? tally : ''} → ${out}`);
  if (report.stopped) lines.push('', ...stopNote(report, { ownKey }), '');
  if (lookup) {
    const found = report.matched + report.chosen + report.ambiguous.length + report.unsure.length;
    lines.push(`Matched on ${report.source || 'OMDb'}: ${found}${report.chosen ? ` (${report.chosen} chosen by you)` : ''}`);
    if (report.source === 'TMDB' && report.requests) {
      lines.push(`  OMDb was asked about ${report.requests} title${report.requests === 1 ? '' : 's'} TMDB had no clear match for${report.fallbackStopped ? `, until it stopped (${report.fallbackStopped}); the rest went without` : ''}`);
    }
    section('Ambiguous, kept the best-known match' + (interactive ? '' : ' (run with -i to choose, or add a year or "(TV)"/"(film)")'),
      report.ambiguous.map(a => `${a.title} → ${brief(a.picked)}${a.others.length ? ` · also: ${a.others.map(brief).join(', ')}` : ''}`));
    section('Unsure, kept the closest match (check these' + (interactive ? ')' : ', or run with -i to choose)'),
      report.unsure.map(a => `${a.title} → ${brief(a.picked)}${a.others.length ? ` · also: ${a.others.map(brief).join(', ')}` : ''}`));
    // A list of films: --type movie settles films that share a name with a show
    const k = report.kinds;
    if (!type && k.movie >= 10 && k.movie >= 9 * k.series && report.ambiguous.some(a => [a.picked, ...a.others].some(o => o.type === 'series'))) {
      lines.push('  Nearly all of these are films: run with --type movie to leave shows out of the matching (a ": Season 1" or "(TV)" title still matches a show)');
    }
    section('Not found, kept without an IMDb ID (they won\'t merge with titles you already have)',
      report.notFound.map(n => `${n.title}${n.others.length ? ` · closest: ${n.others.map(brief).join(', ')}` : ''}`));
    section('None of the matches, kept without an IMDb ID', report.unmatched);
    section('Left out, as you chose', report.skipped);
    section('Lookups failed, left out (run again to retry them)', report.lookupErrors);
  }
  section('Failed, rating unreadable (left out)', report.badRatings);
  section('Duplicates left out', report.duplicates);
  section('Left out, no title (an IMDb ID needs a lookup to get one: drop --no-lookup)', report.untitled);
  lines.push('', 'Import it in the app: Settings → Import.');
  return lines.join('\n');
}

// One match, for choosing: title, year and kind, who made it and who's in
// it, and what it's about
function describe(item, number) {
  const made = item.type === 'series' ? (item.writer ? `created by ${item.writer.split(',')[0].trim()}` : '') : (item.director ? `dir. ${item.director}` : '');
  const votes = item.votes >= 1e6 ? `${(item.votes / 1e6).toFixed(1)}M` : item.votes >= 1000 ? `${Math.round(item.votes / 1000)}k` : item.votes;
  const score = item.votesFrom === 'TMDB' ? (votes ? `${votes} TMDB votes` : '')
    : item.imdbRating ? `IMDb ${item.imdbRating}${votes ? ` (${votes} votes)` : ''}` : '';
  const head = [brief(item), made, score].filter(Boolean).join(' · ');
  const actors = (item.actors || '').split(',').map(a => a.trim()).filter(Boolean).slice(0, 3).join(', ');
  const plot = item.plot && item.plot.length > 180 ? `${item.plot.slice(0, 177).trimEnd()}…` : item.plot;
  return [`  ${number}) ${head}`, actors && `     ${actors}`, plot && `     ${plot}`, item.imdbID ? `     https://www.imdb.com/title/${item.imdbID}/`
    : item.tmdbId ? `     https://www.themoviedb.org/${item.type === 'series' ? 'tv' : 'movie'}/${item.tmdbId}` : '']
    .filter(Boolean).join('\n');
}

// Asks in the terminal which match a title means
function terminalChooser() {
  const readline = require('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Lines are queued as they come: piped answers arrive before they're asked for
  const lines = [];
  let closed = false;
  let waiting = null;
  const hand = line => {
    if (waiting) { const resolve = waiting; waiting = null; resolve(line); } else if (line !== null) lines.push(line);
  };
  rl.on('line', hand);
  rl.on('close', () => { closed = true; hand(null); });
  const ask = async prompt => {
    process.stdout.write(prompt);
    const line = lines.length ? lines.shift() : closed ? null : await new Promise(resolve => { waiting = resolve; });
    if (!process.stdin.isTTY) console.log(line === null ? '' : line);
    return line;
  };
  let asked = 0;
  const choose = async (row, options, { ambiguous, unsure, occurrence }) => {
    asked++;
    const again = occurrence ? ` (its ${occurrence + 1}${['', '', 'nd', 'rd'][occurrence + 1] || 'th'} time in your list)` : '';
    console.log(`\n[${asked}] "${label(row)}"${again} ${ambiguous ? `could be any of ${options.length}:` : unsure ? 'has no certain match. Closest:' : 'wasn\'t found exactly. Closest:'}`);
    options.forEach((option, i) => console.log(describe(option, i + 1)));
    const fallback = ambiguous || unsure ? '1' : 'n';
    console.log(`  1-${options.length} choose · n none of these (keep it unmatched) · s leave it out · or an IMDb ID (tt…) · Enter = ${fallback}`);
    for (;;) {
      const raw = await ask('> ');
      // Input ended (piped, or Ctrl-D): the default for this and the rest
      const answer = (raw === null ? fallback : raw.trim().toLowerCase()) || fallback;
      const number = Number(answer);
      if (Number.isInteger(number) && number >= 1 && number <= options.length) return options[number - 1].imdbID;
      if (answer === 'n') return null;
      if (answer === 's') return 'skip';
      const id = answer.match(/tt\d{7,10}/);
      if (id) return id[0];
      console.log(`  Type 1-${options.length}, n, s or an IMDb ID.`);
    }
  };
  return { choose, close: () => rl.close() };
}

const USAGE = `Usage: node tools/make-import.js watchlist|reviewed <list.txt|list.csv> [-o out.json] [-i [--ask-again]] [--limit N | --no-limit] [--tmdb-key KEY] [--no-lookup] [--type movie|series]

  -i, --interactive   for each title whose name several known films or shows share, or that
                      isn't found exactly, show the top ${CANDIDATES} matches and ask which it is.
                      Answers are remembered for later runs (with or without -i)
  --ask-again         forget earlier answers and ask again
  --limit N           OMDb lookups stop after N requests a run (default ${OMDB_LIMIT}), as a free key
                      allows about 1,000 a day and the app shares the app's key
  --no-limit          go on until OMDb's quota runs out
  --tmdb-key KEY      look titles up on TMDB instead of OMDb: about 2 requests a title
                      rather than 2-5, and no daily limit (or set TMDB_KEY)`;

async function main(argv) {
  const [kind, input, ...rest] = argv;
  if (!['watchlist', 'reviewed'].includes(kind) || !input) {
    console.error(USAGE);
    process.exit(1);
  }
  const option = name => { const i = rest.indexOf(name); return i === -1 ? undefined : rest[i + 1]; };
  const out = option('-o') || option('--out') || path.join(path.dirname(input), `${path.basename(input, path.extname(input))}-import.json`);
  const lookup = !rest.includes('--no-lookup');
  const interactive = rest.includes('-i') || rest.includes('--interactive');
  if (interactive && !lookup) {
    console.error('-i chooses between OMDb matches, so it needs lookups: drop --no-lookup.');
    process.exit(1);
  }
  const type = ['movie', 'series'].includes(option('--type')) ? option('--type') : '';
  const tmdbKey = (option('--tmdb-key') || process.env.TMDB_KEY || '').trim();
  // A v3 API key or a v4 read access token, as the app accepts (js/app/settings.js)
  if (tmdbKey && !/^(?:[0-9a-f]{32}|eyJ[\w-]{10,600}\.[\w-]{10,2000}\.[\w-]{10,600})$/i.test(tmdbKey)) {
    console.error('That doesn\'t look like a TMDB key: the 32-character API key, or the read access token starting "eyJ".');
    process.exit(1);
  }
  const asked = Number(option('--limit'));
  if (option('--limit') !== undefined && !(Number.isInteger(asked) && asked > 0)) {
    console.error('--limit takes a number of requests, such as --limit 300.');
    process.exit(1);
  }
  // (with a TMDB key, it limits the OMDb requests for titles TMDB has no clear match for)
  const limit = rest.includes('--no-limit') ? Infinity : asked || OMDB_LIMIT;
  const cache = loadCache();
  // Choices are remembered, so -i asks only about titles not answered before
  if (rest.includes('--ask-again')) for (const key of Object.keys(cache)) if (key.startsWith('choice:')) delete cache[key];
  const saveCache = () => {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(cache));
  };
  const text = fs.readFileSync(input, 'utf8');
  const chooser = interactive ? terminalChooser() : null;
  if (lookup) console.log(tmdbKey ? 'Looking titles up on TMDB (and OMDb for any it has no clear match for)…' : `Looking titles up on OMDb${limit < Infinity ? ` (at most ${limit} requests; --no-limit for more)` : ' until its quota runs out'}…`);
  try {
    const { count, report, text: file } = await build(kind, text, { lookup, type, cache, choose: chooser && chooser.choose, onChoice: saveCache, tmdbKey, limit });
    if (lookup) saveCache();
    fs.writeFileSync(out, file);
    console.log(`\n${summary(kind, report, count, out, { lookup, interactive, type, ownKey: Boolean(process.env.OMDB_KEY) })}`);
  } finally {
    if (chooser) chooser.close();
  }
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });

module.exports = { csvRows, columnsOf, parseLine, readInput, parseRating, sameTitle, extendsTitle, abbreviates, build, summary, describe, loadApp };
