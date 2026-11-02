// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Fake OMDb and TMDB for end-to-end tests of tools/make-import.js, loaded
// before it with `node --require tests/fixtures/fake-services.js`. Replaces
// fetch, so the real script runs unchanged and nothing leaves the machine.
//
// Every title asked for exists, as one film, except:
//   - those in SHARED below, several titles of one name (ambiguity, repeats)
//   - titles containing "Zzz", which nothing matches
// Environment:
//   FAKE_LOG        a file to append each request to ("omdb <params>" or "tmdb <path>")
//   FAKE_QUOTA      OMDb requests that succeed before "Request limit reached!"
//   FAKE_TMDB_KEY   the TMDB key accepted (others get a 401); default FAKE_KEY below
'use strict';

const fs = require('node:fs');

// Shaped like a real TMDB key, so the script's own check accepts it
const FAKE_KEY = '0123456789abcdef0123456789abcdef';

const SHARED = {
  'the office': [
    { title: 'The Office', year: 2005, type: 'series', imdb: 'tt0386676', tmdb: 2316, votes: 760000, tmdbVotes: 4300, director: 'Greg Daniels', actors: 'Steve Carell, Jenna Fischer, John Krasinski' },
    { title: 'The Office', year: 2001, type: 'series', imdb: 'tt0290978', tmdb: 2996, votes: 110000, tmdbVotes: 900, director: 'Ricky Gervais', actors: 'Ricky Gervais, Martin Freeman' },
    { title: 'The Office', year: 2014, type: 'series', imdb: 'tt3476540', tmdb: 9001, votes: 12, tmdbVotes: 3 }
  ],
  insomnia: [
    { title: 'Insomnia', year: 2002, type: 'movie', imdb: 'tt0278504', tmdb: 320, votes: 330000, tmdbVotes: 4000, director: 'Christopher Nolan' },
    { title: 'Insomnia', year: 1997, type: 'movie', imdb: 'tt0119375', tmdb: 26610, votes: 60000, tmdbVotes: 600, director: 'Erik Skjoldbjærg' }
  ],
  scarface: [
    { title: 'Scarface', year: 1983, type: 'movie', imdb: 'tt0086250', tmdb: 111, votes: 900000, tmdbVotes: 11000 },
    { title: 'Scarface', year: 1932, type: 'movie', imdb: 'tt0023427', tmdb: 877, votes: 30000, tmdbVotes: 500 }
  ],
  // Names the services write differently: an article, punctuation, spacing, a symbol
  'hunger games': [{ title: 'The Hunger Games', year: 2012, type: 'movie', imdb: 'tt1392170', tmdb: 70160, votes: 1000000, tmdbVotes: 22000 }],
  'bourne legacy': [{ title: 'The Bourne Legacy', year: 2012, type: 'movie', imdb: 'tt1194173', tmdb: 49040, votes: 300000, tmdbVotes: 7000 }],
  'wall-e': [], // found only searched without the hyphen
  'wall e': [{ title: 'WALL·E', year: 2008, type: 'movie', imdb: 'tt0910970', tmdb: 10681, votes: 1200000, tmdbVotes: 18000 }],
  'the taking of pelham 123': [
    { title: 'The Taking of Pelham 1 2 3', year: 2009, type: 'movie', imdb: 'tt1111422', tmdb: 18487, votes: 380000, tmdbVotes: 4000 },
    { title: 'The Taking of Pelham One Two Three', year: 1974, type: 'movie', imdb: 'tt0072251', tmdb: 8333, votes: 60000, tmdbVotes: 700 }
  ],
  'i heart huckabees': [{ title: 'I ♥ Huckabees', year: 2004, type: 'movie', imdb: 'tt0356721', tmdb: 1599, votes: 70000, tmdbVotes: 900 }],
  '(500) days of summer': [
    { title: 'Not a Love Story: Making (500) Days of Summer', year: 2009, type: 'movie', imdb: 'tt1572162', tmdb: 70002, votes: 40, tmdbVotes: 2 },
    { title: '500 Days of Summer', year: 2009, type: 'movie', imdb: 'tt1022603', tmdb: 19913, votes: 560000, tmdbVotes: 12000 }
  ],
  // TMDB names it differently ("Se7en") or its search doesn't show it: OMDb finds it
  seven: [
    { title: 'Seven', tmdbTitle: 'Se7en', year: 1995, type: 'movie', imdb: 'tt0114369', tmdb: 807, votes: 2066262, tmdbVotes: 21000, tmdbHidden: true },
    { title: 'Seven Pounds', year: 2008, type: 'movie', imdb: 'tt0814314', tmdb: 11321, votes: 340000, tmdbVotes: 7441 }
  ],
  scratch: [
    { title: 'Scratch', year: 2001, type: 'movie', imdb: 'tt0143861', tmdb: 32526, votes: 2931, tmdbVotes: 30, tmdbHidden: true },
    { title: 'Scratch', year: 2024, type: 'movie', imdb: '', tmdb: 1264244, votes: 0, tmdbVotes: 1 } // no IMDb page
  ],
  // Number words, numerals, "Part", capitals for words
  'two guns': [
    { title: '2 Guns', year: 2013, type: 'movie', imdb: 'tt1272878', tmdb: 136400, votes: 300000, tmdbVotes: 4677 },
    { title: 'Two Guns', year: 2005, type: 'movie', imdb: '', tmdb: 294985, votes: 0, tmdbVotes: 0 }
  ],
  'hangover 2': [{ title: 'The Hangover Part II', year: 2011, type: 'movie', imdb: 'tt1411697', tmdb: 45243, votes: 600000, tmdbVotes: 12000 }],
  'mi ghost protocol': [{ title: 'Mission: Impossible - Ghost Protocol', year: 2011, type: 'movie', imdb: 'tt1229238', tmdb: 56292, votes: 600000, tmdbVotes: 10000 }],
  // The start of a longer title
  'aziz ansari: intimate moments': [{ title: 'Aziz Ansari: Intimate Moments for a Sensual Evening', year: 2010, type: 'movie', imdb: 'tt1594985', tmdb: 49009, votes: 9000, tmdbVotes: 150 }],
  'born into brothels': [{ title: "Born into Brothels: Calcutta's Red Light Kids", year: 2004, type: 'movie', imdb: 'tt0388789', tmdb: 14275, votes: 13000, tmdbVotes: 80 }],
  // Obscure on both, and the only title of its name
  'raising victor vargas': [{ title: 'Raising Victor Vargas', year: 2002, type: 'movie', imdb: 'tt0300214', tmdb: 9083, votes: 900, tmdbVotes: 60 }],
  // Known titles that share a name
  // "Nine" and "9" are two films: each as written
  // (TMDB's search of everything shows "9" for "Nine", and only its film search shows "Nine")
  nine: [
    { title: 'Nine', year: 2009, type: 'movie', imdb: 'tt0875034', tmdb: 10197, votes: 50000, tmdbVotes: 900, multiHidden: true },
    { title: '9', year: 2009, type: 'movie', imdb: 'tt0472033', tmdb: 12244, votes: 150000, tmdbVotes: 3000, omdbHidden: true }
  ],
  9: [{ title: '9', year: 2009, type: 'movie', imdb: 'tt0472033', tmdb: 12244, votes: 150000, tmdbVotes: 3000 }],
  // A rare film with the name as written mustn't hide the famous one with "The"
  'black dahlia': [
    { title: 'Black Dahlia', year: 2006, type: 'movie', imdb: 'tt0839990', tmdb: 300001, votes: 300, tmdbVotes: 5 },
    { title: 'The Black Dahlia', year: 2006, type: 'movie', imdb: 'tt0387877', tmdb: 9676, votes: 80000, tmdbVotes: 2000 }
  ],
  heat: [ // "The Heat" isn't "Heat": not a rival
    { title: 'Heat', year: 1995, type: 'movie', imdb: 'tt0113277', tmdb: 949, votes: 700000, tmdbVotes: 7000 },
    { title: 'The Heat', year: 2013, type: 'movie', imdb: 'tt2404463', tmdb: 136795, votes: 200000, tmdbVotes: 4000 }
  ],
  muppets: [
    { title: 'The Muppets', year: 2011, type: 'movie', imdb: 'tt1204342', tmdb: 64328, votes: 90000, tmdbVotes: 1500 },
    { title: 'The Muppets', year: 2015, type: 'series', imdb: 'tt4730002', tmdb: 62716, votes: 5000, tmdbVotes: 150 }
  ],
  monster: [
    { title: 'Monster', year: 2003, type: 'movie', imdb: 'tt0340855', tmdb: 504, votes: 150000, tmdbVotes: 3000 },
    { title: 'Monster', year: 2023, type: 'movie', imdb: 'tt24075572', tmdb: 1050035, votes: 40000, tmdbVotes: 900 }
  ],
  crash: [
    { title: 'Crash', year: 2004, type: 'movie', imdb: 'tt0375679', tmdb: 1640, votes: 450000, tmdbVotes: 4000 },
    { title: 'Crash', year: 1996, type: 'movie', imdb: 'tt0115964', tmdb: 884, votes: 70000, tmdbVotes: 900 }
  ],
  fargo: [
    { title: 'Fargo', year: 1996, type: 'movie', imdb: 'tt0116282', tmdb: 275, votes: 700000, tmdbVotes: 9000 },
    { title: 'Fargo', year: 2014, type: 'series', imdb: 'tt2802850', tmdb: 60622, votes: 450000, tmdbVotes: 3000 }
  ],
  'hearts of darkness': [
    { title: 'Hearts of Darkness', year: 2020, type: 'movie', imdb: 'tt11089600', tmdb: 70001, votes: 15, tmdbVotes: 2 },
    { title: "Hearts of Darkness: A Filmmaker's Apocalypse", year: 1991, type: 'movie', imdb: 'tt0102015', tmdb: 4539, votes: 26000, tmdbVotes: 300 }
  ]
};

// Any other title: one film (or show, when only shows are asked for), with IDs from its name
const hash = text => Math.abs([...text].reduce((h, c) => (h * 31 + c.codePointAt(0)) | 0, 7));
const generated = (name, type = 'movie') => ({ title: name, year: 2000 + (hash(name) % 20), type, imdb: `tt${String(hash(name)).padStart(8, '0').slice(0, 8)}`, tmdb: 100000 + (hash(name) % 800000), votes: 50000, tmdbVotes: 1000, director: 'A Director', actors: 'A, B, C' });

const byId = new Map();
// tmdbTitle: TMDB's name for it; tmdbHidden: TMDB's search doesn't show it
// (multiHidden: only its search of everything doesn't); omdbHidden: OMDb's doesn't;
// no imdb: OMDb doesn't have it, and TMDB has no IMDb ID for it
const index = t => { if (t.imdb) byId.set(t.imdb, t); byId.set(`tmdb:${t.tmdb}`, t); };
for (const list of Object.values(SHARED)) list.forEach(index);
// A name as asked for, or without its punctuation (the script also searches that way)
const loose = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const LOOSE = new Map(Object.entries(SHARED).map(([key, list]) => [loose(key), list]));
function titlesFor(name, type) {
  const key = name.toLowerCase().trim();
  if (/zzz/i.test(key)) return [];
  const list = SHARED[key] || LOOSE.get(loose(key)) || [generated(name.trim(), type)];
  list.forEach(index);
  return list;
}

let omdbUsed = 0;
const log = line => { if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, `${line}\n`); };
const reply = (body, status = 200) => ({ status, ok: status < 400, json: async () => body });
const omdbRecord = t => ({
  Response: 'True', imdbID: t.imdb, Title: t.title, Year: String(t.year), Type: t.type, Genre: 'Drama',
  Director: t.type === 'movie' ? t.director || 'N/A' : 'N/A', Writer: t.type === 'series' ? t.director || 'N/A' : 'N/A',
  Actors: t.actors || 'N/A', Plot: `About ${t.title}.`, imdbRating: '7.5', imdbVotes: t.votes.toLocaleString('en'), Poster: 'https://example.com/p.jpg'
});

function omdb(url) {
  const p = Object.fromEntries(url.searchParams);
  log(`omdb ${['i', 't', 'y', 's', 'type'].filter(k => p[k]).map(k => `${k}=${p[k]}`).join(' ')}`);
  if (++omdbUsed > Number(process.env.FAKE_QUOTA || Infinity)) return reply({ Response: 'False', Error: 'Request limit reached!' }, 401);
  const none = { Response: 'False', Error: 'Movie not found!' };
  const kind = t => t.imdb && !t.omdbHidden && (!p.type || t.type === p.type);
  if (p.i) return reply(byId.has(p.i) ? omdbRecord(byId.get(p.i)) : { Response: 'False', Error: 'Incorrect IMDb ID.' });
  if (p.s) {
    const hits = titlesFor(p.s, p.type).filter(kind);
    return reply(hits.length ? { Response: 'True', totalResults: String(hits.length), Search: hits.map(t => ({ imdbID: t.imdb, Title: t.title, Year: String(t.year), Type: t.type })) } : none);
  }
  // OMDb's guess: the most-voted title of that name (and year, and kind)
  const hit = titlesFor(p.t, p.type).filter(t => t.title.toLowerCase() === p.t.toLowerCase() && kind(t) && (!p.y || t.year === Number(p.y)))
    .sort((a, b) => b.votes - a.votes)[0];
  return reply(hit ? omdbRecord(hit) : none);
}

function tmdb(url, options) {
  const path = url.pathname.replace(/^\/3/, '');
  log(`tmdb ${path}`);
  const key = url.searchParams.get('api_key') || String((options.headers || {}).Authorization || '').replace(/^Bearer /, '');
  if (key !== (process.env.FAKE_TMDB_KEY || FAKE_KEY)) return reply({ status_message: 'Invalid API key' }, 401);
  const brief = t => ({ id: t.tmdb, media_type: t.type === 'series' ? 'tv' : 'movie', vote_count: t.tmdbVotes, overview: `About ${t.title}.`, poster_path: '/p.jpg',
    ...(t.type === 'series' ? { name: t.tmdbTitle || t.title, first_air_date: `${t.year}-01-01` } : { title: t.tmdbTitle || t.title, release_date: `${t.year}-01-01` }) });
  const search = path.match(/^\/search\/(multi|movie|tv)$/);
  if (search) {
    const want = { multi: null, movie: 'movie', tv: 'series' }[search[1]];
    return reply({ results: titlesFor(url.searchParams.get('query'), want || undefined).filter(t => !t.tmdbHidden && !(t.multiHidden && !want) && (!want || t.type === want)).map(brief) });
  }
  const find = path.match(/^\/find\/(tt\d+)$/);
  if (find) {
    const t = byId.get(find[1]);
    return reply({ movie_results: t && t.type === 'movie' ? [brief(t)] : [], tv_results: t && t.type === 'series' ? [brief(t)] : [] });
  }
  const one = path.match(/^\/(movie|tv)\/(\d+)$/);
  const t = one && byId.get(`tmdb:${one[2]}`);
  if (!t) return reply({ status_message: 'Not found' }, 404);
  const people = list => (list || '').split(',').map(name => name.trim()).filter(Boolean).map(name => ({ name }));
  return reply({
    ...brief(t), imdb_id: t.type === 'movie' ? t.imdb || null : undefined, external_ids: { imdb_id: t.imdb || null }, genres: [{ name: 'Drama' }],
    ...(t.type === 'series'
      ? { created_by: people(t.director), aggregate_credits: { cast: people(t.actors) } }
      : { runtime: 110, credits: { cast: people(t.actors), crew: people(t.director).map(d => ({ ...d, job: 'Director' })) } })
  });
}

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.hostname.includes('omdbapi.com')) return omdb(url);
  if (url.hostname === 'api.themoviedb.org') return tmdb(url, options);
  throw new Error(`The fake services don't answer ${url.hostname}`);
};
