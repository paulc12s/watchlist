// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Builds data/awards.json: review lists of award nominees.
//   Oscars: from Wikidata (CC0), with Best Picture's newest ceremonies also
//     taken from the hand-curated lists in data/categories.json
//   Golden Globe TV: from the nominee tables on Wikipedia, whose shows link
//     to Wikidata for their IMDb IDs (Wikidata's own Golden Globe TV data is
//     too sparse). Only titles and IDs are kept, which are facts.
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
    id: 'awards-globes-tv', name: 'Golden Globe TV nominees', type: 'series', on: 'wikipedia',
    note: 'Drama, musical or comedy, and limited series',
    pages: {
      'Golden Globe Award for Best Television Series – Drama': 'Drama series',
      'Golden Globe Award for Best Television Series – Musical or Comedy': 'Musical or comedy series',
      'Golden Globe Award for Best Limited or Anthology Series or Television Film': 'Limited series or TV film'
    }
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
function parseNominees(page) {
  const rows = [];
  const articleFor = new Map();
  for (const table of page.split(/<table/).slice(1)) {
    let year = null;
    for (const tr of table.split(/<tr[\s>]/).slice(1)) {
      const cells = tr.split(/<td/).slice(1);
      const first = cells.length ? decode(cells[0].replace(/^[^>]*>/, '')) : '';
      const yearCell = first.match(/^((?:19|20)\d{2})(?:\b|$)/);
      if (yearCell && !/<i>/.test(cells[0])) year = Number(yearCell[1]);
      const cell = cells.find(td => /<i>/.test(td));
      if (!cell || !year) continue;
      const italic = cell.match(/<i>([\s\S]*?)<\/i>/)[1];
      const link = italic.match(/<a href="\/wiki\/[^"]+" title="([^"]+)"/);
      const title = decode(italic);
      if (!title) continue;
      if (link) articleFor.set(title, decode(link[1]));
      rows.push({ title, article: link ? decode(link[1]) : null, year, won: /<b>/.test(italic) || /^[^>]*background/i.test(tr) });
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

async function wikipediaNominations(pages) {
  const all = [];
  for (const [page, label] of Object.entries(pages)) {
    const data = await wikipedia({ action: 'parse', page, prop: 'text', redirects: '1' });
    const rows = parseNominees(data.parse.text);
    console.log(`  ${label}: ${rows.length} nominations from Wikipedia, ${rows.filter(r => !r.article).length} without an article`);
    all.push(...rows);
  }
  const items = await articleItems(all.filter(r => r.article).map(r => r.article));
  return all.filter(r => r.article && items.has(r.article)).map(r => ({ work: items.get(r.article), year: r.year, won: r.won }));
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

async function build(years) {
  const titles = {};
  const lists = [];
  for (const list of LISTS) {
    const found = new Map(); // work -> { year, won }
    const sources = list.on === 'wikipedia'
      ? [['Wikipedia', await wikipediaNominations(list.pages)]]
      : [];
    // One query at a time: Wikidata asks for no more than a few at once
    for (const [award, label] of Object.entries(list.awards || {})) sources.push([label, await nominations(award, list.on)]);
    for (const [label, rows] of sources) {
      const newest = Math.max(...rows.map(r => r.year));
      for (const r of rows) {
        if (r.year <= newest - years) continue;
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

module.exports = { LISTS };
