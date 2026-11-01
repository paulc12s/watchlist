// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Builds data/awards.json: review lists of award nominees.
//   Oscars: from Wikidata (CC0), with Best Picture's newest ceremonies also
//     taken from the hand-curated lists in data/categories.json
//   Golden Globe and Emmy TV, festival winners: from the tables on
//     Wikipedia, whose titles link to Wikidata for their IMDb IDs (Wikidata's
//     own data for these is too sparse)
//   Sight and Sound poll: from the BFI's page, matched through Wikipedia's
//     search to Wikidata for IMDb IDs
// Only titles, years, ranks and IDs are kept, which are facts.
//
//   node tools/build-awards.js            last 10 ceremonies (the default)
//   node tools/build-awards.js --years 15
//
// Each list combines several award categories, so there are few lists but
// long ones. Titles are keyed by IMDb ID, newest ceremony first, winners
// first within a year. The ratings page fetches the file only when one of
// these lists is opened (Catalog.prepare).
//
// Wikidata records some categories on the film or show itself (Best Picture,
// the Golden Globe series awards) and others on the person, with the film as
// "for work" (acting, directing, cinematography). Its newest ceremony is
// often incomplete for a while; the build reports how many titles each year
// has, so gaps show.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'watchlist-build/1.0 (https://github.com/paulc12s/watchlist)';

const LISTS = [
  {
    id: 'awards-best-picture', name: 'Best Picture nominees', type: 'movie', on: 'work', curated: true,
    note: 'Oscar nominees, newest first; winners first each year',
    awards: { Q102427: 'Best Picture' }
  },
  {
    id: 'awards-acting', name: 'Oscar acting nominees', type: 'movie', on: 'person',
    note: 'Films with a nominated lead or supporting performance',
    awards: { Q103916: 'Actor', Q103618: 'Actress', Q106291: 'Supporting Actor', Q106301: 'Supporting Actress' }
  },
  {
    id: 'awards-craft', name: 'Oscar directing, writing & cinematography', type: 'movie', on: 'any',
    note: 'Films nominated for Best Director, either screenplay award, or Best Cinematography',
    awards: { Q103360: 'Director', Q41417: 'Original Screenplay', Q107258: 'Adapted Screenplay', Q131520: 'Cinematography' }
  },
  {
    id: 'awards-international', name: 'International feature nominees', type: 'movie', on: 'any',
    note: 'Oscar nominees for Best International Feature',
    awards: { Q105304: 'International Feature' }
  },
  {
    id: 'awards-documentary', name: 'Documentary feature nominees', type: 'movie', on: 'any',
    note: 'Oscar nominees for Best Documentary Feature',
    awards: { Q111332: 'Documentary Feature' }
  },
  {
    id: 'awards-animated', name: 'Animated feature nominees', type: 'movie', on: 'any',
    note: 'Oscar nominees for Best Animated Feature',
    awards: { Q106800: 'Animated Feature' }
  },
  {
    // The ID predates the Emmys joining it, and is kept so saved choices still find it
    id: 'awards-globes-tv', name: 'Golden Globe & Emmy TV nominees', type: 'series', on: 'wikipedia',
    note: 'Drama, comedy and limited series',
    pages: {
      'Golden Globe Award for Best Television Series – Drama': 'Globes drama series',
      'Golden Globe Award for Best Television Series – Musical or Comedy': 'Globes musical or comedy series',
      'Golden Globe Award for Best Limited or Anthology Series or Television Film': 'Globes limited series or TV film',
      'Primetime Emmy Award for Outstanding Drama Series': 'Emmy drama series',
      'Primetime Emmy Award for Outstanding Comedy Series': 'Emmy comedy series',
      'Primetime Emmy Award for Outstanding Limited or Anthology Series': 'Emmy limited series'
    }
  },
  {
    id: 'awards-festivals', name: 'Festival top prizes', type: 'movie', on: 'wikipedia', winners: true, years: 25,
    note: 'Cannes Palme d’Or, Venice Golden Lion and Berlin Golden Bear winners',
    pages: { "Palme d'Or": 'Cannes Palme d’Or', 'Golden Lion': 'Venice Golden Lion', 'Golden Bear': 'Berlin Golden Bear' }
  },
  {
    id: 'awards-sight-sound', name: 'Sight and Sound critics’ poll', type: 'movie', on: 'poll',
    note: 'The 2022 critics’ top 100 greatest films, in poll order',
    url: 'https://www.bfi.org.uk/sight-and-sound/greatest-films-all-time', top: 100
  }
];

const WIKIPEDIA = 'https://en.wikipedia.org/w/api.php';

async function wikipedia(params) {
  const url = `${WIKIPEDIA}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`Wikipedia ${response.status}`);
  return response.json();
}

const decode = text => text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\[[^\]]*\]/g, '').trim();

// Nominees from one award page's tables: [{ article, title, year, won }].
// Each table is read on its own, so a summary table at the end (most wins,
// and so on) never picks up the last year seen. A row's year is a first
// cell holding just a year, linked to its ceremony or not; the nominee is the
// first cell in italics; the winner is shaded and in bold. A show named again
// in a later year is often not linked, so it takes the link from its first
// mention.
// winners: a page listing only winners (the festivals). Every row is a
// winner, and a row counts only if it states its own year, which keeps out
// side tables that carry a year down from an earlier row.
function parseNominees(page, { winners = false } = {}) {
  const rows = [];
  const articleFor = new Map();
  for (const table of page.split(/<table/).slice(1)) {
    let year = null;
    for (const tr of table.split(/<tr[\s>]/).slice(1)) {
      const cells = tr.split(/<t[dh][\s>]/).slice(1);
      const first = cells.length ? decode(cells[0].replace(/^[^>]*>/, '')) : '';
      const yearCell = first.match(/^((?:19|20)\d{2})(?:\b|$)/);
      const ownYear = yearCell && !/<i>/.test(cells[0]);
      if (ownYear) year = Number(yearCell[1]);
      const cell = cells.find(td => /<i>/.test(td));
      if (!cell || !year || (winners && !ownYear)) continue;
      const italic = cell.match(/<i>([\s\S]*?)<\/i>/)[1];
      const link = italic.match(/<a href="\/wiki\/[^"]+" title="([^"]+)"/);
      const title = decode(italic);
      if (!title) continue;
      if (link) articleFor.set(title, decode(link[1]));
      rows.push({ title, article: link ? decode(link[1]) : null, year, won: winners || /<b>/.test(italic) || /^[^>]*background/i.test(tr) });
    }
  }
  return rows.map(r => ({ ...r, article: r.article || articleFor.get(r.title) || null }));
}

// Wikidata IDs for Wikipedia articles (redirects followed)
async function articleItems(articles) {
  const items = new Map();
  const list = [...new Set(articles)];
  for (let i = 0; i < list.length; i += 50) {
    const data = await wikipedia({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1', titles: list.slice(i, i + 50).join('|') });
    const renamed = new Map([...(data.query.normalized || []), ...(data.query.redirects || [])].map(r => [r.to, r.from]));
    for (const page of data.query.pages || []) {
      if (!page.pageprops || !page.pageprops.wikibase_item) continue;
      let name = page.title;
      const names = [name];
      while (renamed.has(name)) { name = renamed.get(name); names.push(name); }
      for (const n of names) items.set(n, page.pageprops.wikibase_item);
    }
  }
  return items;
}

async function wikipediaNominations(pages, options = {}) {
  const all = [];
  for (const [page, label] of Object.entries(pages)) {
    const data = await wikipedia({ action: 'parse', page, prop: 'text', redirects: '1' });
    const rows = parseNominees(data.parse.text, options);
    console.log(`  ${label}: ${rows.length} nominations from Wikipedia, ${rows.filter(r => !r.article).length} without an article`);
    all.push(...rows);
  }
  const items = await articleItems(all.filter(r => r.article).map(r => r.article));
  return all.filter(r => r.article && items.has(r.article)).map(r => ({ work: items.get(r.article), year: r.year, won: r.won }));
}

// The Sight and Sound poll from the BFI's own page (Wikipedia has only its
// top 10): each entry's rank and "Title (Year)" from the data the page
// carries, top places only, in rank order (ties share a rank)
async function pollEntries(url, top) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`BFI ${response.status}`);
  const page = await response.text();
  const entries = [];
  for (const match of page.matchAll(/"nameAndYear":"([^"]+)"/g)) {
    const ranks = [...page.slice(Math.max(0, match.index - 6000), match.index).matchAll(/"rank":"?(\d+)/g)];
    const named = decode(match[1]).replace(/\s+/g, ' ').match(/^(.*) \((\d{4})\)$/);
    if (!ranks.length || !named) continue;
    entries.push({ rank: Number(ranks[ranks.length - 1][1]), title: named[1], year: Number(named[2]) });
  }
  return entries.filter(e => e.rank <= top).sort((a, b) => a.rank - b.rank);
}

// Wikidata IDs for films by title and year, through Wikipedia: first the
// article names Wikipedia gives films ("8½", "Vertigo (film)", "Earth (1930
// film)"), then its search. A candidate counts only if Wikidata dates it
// within two years of the poll (so "Vertigo", the condition, doesn't).
// No OMDb requests, so building never spends the app's daily OMDb quota.
async function findFilms(entries) {
  const candidates = new Map(entries.map(e => [e, [`${e.title} (${e.year} film)`, `${e.title} (film)`, e.title]]));
  const items = await articleItems([...candidates.values()].flat());
  const years = await details(new Set(items.values()));
  const fits = (entry, item) => {
    const found = item && years.get(item);
    return Boolean(found && found.year && Math.abs(found.year - entry.year) <= 2);
  };
  const found = new Map();
  for (const entry of entries) {
    let item = candidates.get(entry).map(name => items.get(name)).find(id => fits(entry, id));
    if (!item) {
      const data = await wikipedia({ action: 'query', list: 'search', srsearch: `${entry.title} ${entry.year} film`, srlimit: '1' });
      const hit = data.query && data.query.search && data.query.search[0];
      if (hit) item = (await articleItems([hit.title])).get(hit.title);
    }
    if (item) found.set(entry, item);
  }
  return found;
}

// Retries busy or dropped requests a couple of times
async function sparql(query) {
  for (let attempt = 1; ; attempt++) {
    try {
      const url = `${ENDPOINT}?query=${encodeURIComponent(query)}`;
      const response = await fetch(url, { headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT } });
      if (response.ok) return (await response.json()).results.bindings;
      throw new Error(`Wikidata ${response.status}: ${(await response.text()).slice(0, 200)}`);
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
    }
  }
}

const qid = uri => uri.split('/').pop();

// Nominations (and wins, which Wikidata sometimes records only as an award
// received) for one category: [{ work, year, won }]
// on: 'work' (recorded on the film), 'person' (on a person, with the film as
// "for work"), or 'any' (either; Wikidata mixes the two for some categories,
// and a person's ID is dropped later, having no IMDb title ID)
async function nominations(award, on) {
  const statement = on === 'work' ? '?work' : '?who';
  const forWork = on === 'person' ? '?st pq:P1686 ?work .'
    : on === 'any' ? 'OPTIONAL { ?st pq:P1686 ?for } BIND(COALESCE(?for, ?who) AS ?work)' : '';
  // The statement first, and the date optional: written otherwise, Wikidata
  // times out
  const rows = await sparql(`
    SELECT ?work ?time ?won WHERE {
      { ?st ps:P1411 wd:${award} . ${statement} p:P1411 ?st . BIND(false AS ?won) }
      UNION
      { ?st ps:P166 wd:${award} . ${statement} p:P166 ?st . BIND(true AS ?won) }
      ${forWork}
      OPTIONAL { ?st pq:P585 ?time }
    }`);
  // Undated nominations can't be placed in a year, so they're left out
  return rows.filter(r => r.time && r.work)
    .map(r => ({ work: qid(r.work.value), year: Number(r.time.value.slice(0, 4)), won: r.won.value === 'true' }));
}

// IMDb ID, English title and first release year for each work
async function details(works) {
  const out = new Map();
  const ids = [...works];
  for (let i = 0; i < ids.length; i += 150) {
    const rows = await sparql(`
      SELECT ?work ?imdb (SAMPLE(?en) AS ?label) (SAMPLE(?mul) AS ?other) (MIN(?date) AS ?first) WHERE {
        VALUES ?work { ${ids.slice(i, i + 150).map(id => `wd:${id}`).join(' ')} }
        ?work wdt:P345 ?imdb .
        OPTIONAL { ?work rdfs:label ?en . FILTER(LANG(?en) = "en") }
        # Some titles are named only in the language-neutral label
        OPTIONAL { ?work rdfs:label ?mul . FILTER(LANG(?mul) = "mul") }
        OPTIONAL { ?work wdt:P577 ?date }
        OPTIONAL { ?work wdt:P580 ?date }
      } GROUP BY ?work ?imdb`);
    for (const r of rows) {
      const imdb = r.imdb.value;
      if (!/^tt\d{7,10}$/.test(imdb) || out.has(qid(r.work.value))) continue;
      out.set(qid(r.work.value), {
        imdb,
        title: r.label ? r.label.value : r.other ? r.other.value : '',
        year: r.first ? Number(r.first.value.slice(0, 4)) : null
      });
    }
  }
  return out;
}

// Best Picture's newest ceremonies, curated by hand (tools/oscars.json, built
// into data/categories.json as the "oscars-<year>" lists, winner first). They
// fill what Wikidata hasn't caught up with yet. A curated film that's
// already there (same title, year within one) isn't added twice.
function addCurated(entries) {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'categories.json'), 'utf8'));
  const norm = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let added = 0;
  for (const list of catalog.categories.filter(c => /^oscars-\d{4}$/.test(c.id))) {
    const ceremony = Number(list.id.slice(7));
    list.keys.forEach((key, i) => {
      const [title, year] = catalog.movies[key] || [];
      if (!title) return;
      const same = entries.find(e => e.key === key || (norm(e.title) === norm(title) && Math.abs((e.year || 0) - (year || 0)) <= 1));
      if (same) {
        same.ceremony = Math.max(same.ceremony, ceremony);
        same.won = same.won || i === 0;
        return;
      }
      entries.push({ key, imdb: key.startsWith('tt') ? key : '', title, year, ceremony, won: i === 0 });
      added++;
    });
  }
  console.log(`  + ${added} from the curated Best Picture lists`);
}

// A poll in its own order; no years or winners. A match must be a film
// from within two years of the poll's date for it, or it's left out.
async function buildPoll(list, titles) {
  const entries = await pollEntries(list.url, list.top);
  const works = await findFilms(entries);
  const info = await details(new Set(works.values()));
  const keys = [];
  const missing = [];
  for (const entry of entries) {
    const found = info.get(works.get(entry));
    if (!found || !found.year || Math.abs(found.year - entry.year) > 2) { missing.push(`${entry.title} (${entry.year})`); continue; }
    if (keys.includes(found.imdb)) continue;
    keys.push(found.imdb);
    if (!titles[found.imdb]) titles[found.imdb] = [entry.title, entry.year, list.type];
  }
  console.log(`${list.name}: ${keys.length} titles${missing.length ? `; not matched: ${missing.join(', ')}` : ''}\n`);
  return { id: list.id, group: 'Awards', name: list.name, note: list.note, type: list.type, keys };
}

async function build(years) {
  const titles = {};
  const lists = [];
  for (const list of LISTS) {
    if (list.on === 'poll') {
      lists.push(await buildPoll(list, titles));
      continue;
    }
    const found = new Map(); // work -> { year, won }
    const window = list.years || years;
    const sources = list.on === 'wikipedia'
      ? [['Wikipedia', await wikipediaNominations(list.pages, { winners: list.winners })]]
      : [];
    // One query at a time: Wikidata asks for no more than a few at once
    for (const [award, label] of Object.entries(list.awards || {})) sources.push([label, await nominations(award, list.on)]);
    for (const [label, rows] of sources) {
      const newest = Math.max(...rows.map(r => r.year));
      for (const r of rows) {
        if (r.year <= newest - window) continue;
        const seen = found.get(r.work);
        // A title nominated in several categories or years keeps its newest year
        if (!seen || r.year > seen.year || (r.year === seen.year && r.won && !seen.won)) found.set(r.work, { year: r.year, won: r.won || (seen && seen.year === r.year && seen.won) });
      }
      console.log(`${list.name} · ${label}: ${rows.length} nominations, newest ceremony ${newest}`);
    }
    const info = await details(found.keys());
    const entries = [...found]
      // A title with no name in either label is left out rather than shown blank
      .filter(([work]) => info.has(work) && info.get(work).title)
      .map(([work, { year, won }]) => ({ ...info.get(work), key: info.get(work).imdb, ceremony: year, won }));
    if (list.curated) addCurated(entries);
    entries.sort((a, b) => b.ceremony - a.ceremony || Number(b.won) - Number(a.won) || a.title.localeCompare(b.title));
    const perYear = {};
    for (const e of entries) {
      perYear[e.ceremony] = (perYear[e.ceremony] || 0) + 1;
      if (!titles[e.key]) titles[e.key] = [e.title, e.year, list.type];
    }
    console.log(`  → ${entries.length} titles; per ceremony: ${Object.entries(perYear).sort().reverse().map(([y, n]) => `${y}: ${n}`).join(', ')}\n`);
    lists.push({ id: list.id, group: 'Awards', name: list.name, note: list.note, type: list.type, keys: [...new Set(entries.map(e => e.key))] });
  }
  return {
    generated: new Date().toISOString().slice(0, 10),
    source: 'Wikidata (CC0). Years are ceremony years; the newest ceremony can be incomplete until Wikidata catches up.',
    lists,
    titles
  };
}

if (require.main === module) {
  const at = process.argv.indexOf('--years');
  const years = at > 0 ? Number(process.argv[at + 1]) : 10;
  build(years)
    .then(data => {
      const file = path.join(__dirname, '..', 'data', 'awards.json');
      fs.writeFileSync(file, JSON.stringify(data));
      console.log(`Wrote ${file}: ${data.lists.length} lists, ${Object.keys(data.titles).length} titles, ${fs.statSync(file).size} bytes`);
    })
    .catch(error => { console.error(error); process.exit(1); });
}

module.exports = { LISTS, parseNominees, wikipedia };
