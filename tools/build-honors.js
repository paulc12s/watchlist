// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Builds data/honors.json: the Oscar, Golden Globe and Primetime Emmy categories
// each film or show was nominated in or won, and the prizes it won at Cannes,
// Venice and Berlin, for the icons on a title's details.
//
//   node tools/build-honors.js
//
// Two sources, as neither is enough alone:
//   Wikidata records every Oscar category, on the title or on the person with
//   the title as "for work"; both are read. It has under half the Globes, few
//   Emmys, and its songs lead to the song, not the film.
//   Wikipedia's category tables fill those: every Globe and Emmy category, Best
//   Original Song and the festivals' top prizes. Their titles link to Wikidata
//   for IMDb IDs.
// Festivals are wins only: their competition lineups are barely recorded, so
// "nominated" would appear on a few films and not on the rest.
// A nomination tied to no title (a person alone, as for an honorary award) is
// left out. Years aren't kept: sources often differ by one, so the same
// nomination would show twice.
//
// Each category's rows are kept in tools/.cache/honors/ as it finishes, so a run
// that's stopped carries on where it was; delete that folder for fresh data.
//
// Output: { awards: [[group, category], ...], titles: { ttID: [won, nominated] } },
// where won and nominated are lists of indexes into awards. A category won
// isn't also listed as nominated.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseNominees, wikipedia, articleItems } = require('./build-awards');

const OUTPUT = path.join(__dirname, '..', 'data', 'honors.json');
const CACHE = path.join(__dirname, '.cache', 'honors');
const REQUEST_TIMEOUT_MS = 60000;
const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'watchlist-build/1.0 (https://github.com/paulc12s/watchlist)';
const PAUSE_MS = 1500;
const GROUPS = [
  { name: 'Oscars', root: 'Q19020', prefix: /^Academy Award (of|for) /, tables: label => label === 'Academy Award for Best Original Song' },
  { name: 'Golden Globes', root: 'Q1011547', prefix: /^Golden Globe( Award)? for /, tables: () => true },
  { name: 'Emmys', root: 'Q1044427', prefix: /^Primetime Emmy Award for /, tables: () => true }
];
const FESTIVAL_PRIZES = [
  ['Q179808', 'Cannes Palme d’Or', "Palme d'Or"],
  ['Q844804', 'Cannes Grand Prix'],
  ['Q164200', 'Cannes Jury Prize'],
  ['Q510175', 'Cannes Best Director'],
  ['Q586140', 'Cannes Best Actor'],
  ['Q840286', 'Cannes Best Actress'],
  ['Q978420', 'Cannes Best Screenplay'],
  ['Q775091', 'Cannes Caméra d’Or'],
  ['Q209459', 'Venice Golden Lion', 'Golden Lion'],
  ['Q944480', 'Venice Grand Jury Prize'],
  ['Q1337827', 'Venice Silver Lion'],
  ['Q2089923', 'Venice Volpi Cup for Best Actor'],
  ['Q2089918', 'Venice Volpi Cup for Best Actress'],
  ['Q3405119', 'Venice Best Screenplay'],
  ['Q154590', 'Berlin Golden Bear', 'Golden Bear'],
  ['Q664212', 'Berlin Silver Bear Grand Jury Prize'],
  ['Q321207', 'Berlin Silver Bear Jury Prize'],
  ['Q706031', 'Berlin Silver Bear for Best Director'],
  ['Q819973', 'Berlin Silver Bear for Best Actor'],
  ['Q376834', 'Berlin Silver Bear for Best Actress'],
  ['Q110961984', 'Berlin Silver Bear for Best Leading Performance'],
  ['Q2285851', 'Berlin Silver Bear for Best Screenplay']
].map(([id, category, page]) => ({ id, group: 'Festivals', category, page: page || null, winsOnly: true }));
// Honours for people or technology, not for a title
const NOT_FOR_A_TITLE = /Technical Achievement|Merit|Commendation/;
const displayName = name => {
  const short = name.replace(/^Outstanding /, '');
  const category = short[0].toUpperCase() + short.slice(1);
  return SHORTER[category] || category;
};
const SHORTER = { 'Best Writing, Original Screenplay': 'Best Original Screenplay', 'Best Writing, Adapted Screenplay': 'Best Adapted Screenplay' };

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const qid = uri => uri.split('/').pop();

async function sparql(query) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (response.ok) return (await response.json()).results.bindings;
      throw new Error(`Wikidata ${response.status}: ${(await response.text()).slice(0, 200)}`);
    } catch (error) {
      if (attempt >= 4) throw error;
      await pause(10000 * attempt);
    }
  }
}

// A group's categories, leaving out honours given to people, not titles
async function categories(group) {
  const rows = await sparql(`
    SELECT DISTINCT ?award ?label WHERE {
      { ?award wdt:P31/wdt:P279* wd:${group.root} } UNION { ?award wdt:P279 wd:${group.root} } UNION { ?award wdt:P361 wd:${group.root} }
      ?award rdfs:label ?label . FILTER(LANG(?label) = "en")
    }`);
  return rows.map(r => ({ id: qid(r.award.value), label: r.label.value }))
    .filter(c => group.prefix.test(c.label) && !NOT_FOR_A_TITLE.test(c.label))
    .map(c => {
      return { id: c.id, group: group.name, prefix: group.prefix, category: displayName(c.label.replace(group.prefix, '')), page: group.tables(c.label) ? c.label : null };
    });
}

// One category's statements: [{ work, won }], on the title or its person
async function statements(award, winsOnly) {
  const rows = await sparql(`
    SELECT ?work ?won WHERE {
      ${winsOnly ? '' : `{ ?st ps:P1411 wd:${award} . ?who p:P1411 ?st . BIND(false AS ?won) }
      UNION`}
      { ?st ps:P166 wd:${award} . ?who p:P166 ?st . BIND(true AS ?won) }
      OPTIONAL { ?st pq:P1686 ?for }
      BIND(COALESCE(?for, ?who) AS ?work)
    }`);
  return rows.map(r => ({ work: qid(r.work.value), won: r.won.value === 'true' }));
}

// Tries a Wikipedia step a few times; a run shouldn't lose a table to one dropped request
async function retried(step) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step();
    } catch (error) {
      if (attempt >= 4) throw error;
      console.log(`  retrying: ${error.message}`);
      await pause(10000 * attempt);
    }
  }
}

// One category's rows on Wikipedia, [{ work, won }]. A page that doesn't exist
// adds nothing, and Wikidata's rows stand. Any other failure stops the run,
// rather than quietly writing a file with a table missing
async function tableRows(page, winsOnly) {
  const data = await retried(() => wikipedia({ action: 'parse', page, prop: 'text', redirects: '1' }));
  if (!data.parse) {
    console.log(`  no page: ${page}`);
    return [];
  }
  const rows = parseNominees(data.parse.text, { winners: winsOnly });
  const linked = rows.filter(row => row.article);
  const items = await retried(() => articleItems(linked.map(row => row.article)));
  return linked.filter(row => items.has(row.article)).map(row => ({ work: items.get(row.article), won: row.won }));
}

// A category's rows from both sources, from the cache if this run or an earlier one finished it
async function categoryRows(award) {
  const file = path.join(CACHE, `${award.id}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = await statements(award.id, award.winsOnly);
  const fromTables = award.page ? await tableRows(award.page, award.winsOnly) : [];
  console.log(`${award.group}: ${award.category}: ${rows.length} from Wikidata, ${fromTables.length} from Wikipedia`);
  const all = [...rows, ...fromTables];
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all));
  await pause(PAUSE_MS);
  return all;
}

// The name each category goes by now: Wikipedia redirects a renamed category's
// old name to its current page, whose table covers both. Without this, a recent
// nomination could show under a retired name, or one award under two names
async function currentNames(awards) {
  const pages = awards.filter(award => award.page && award.prefix);
  for (let i = 0; i < pages.length; i += 50) {
    const batch = pages.slice(i, i + 50);
    const data = await retried(() => wikipedia({ action: 'query', redirects: '1', titles: batch.map(award => award.page).join('|') }));
    const step = new Map([...(data.query.normalized || []), ...(data.query.redirects || [])].map(r => [r.from, r.to]));
    for (const award of batch) {
      let name = award.page;
      while (step.has(name)) name = step.get(name);
      if (award.prefix.test(name)) award.category = displayName(name.replace(award.prefix, ''));
    }
  }
}

// IMDb title IDs for works; people and anything else have none
async function imdbIds(works) {
  const ids = new Map();
  const list = [...works];
  for (let i = 0; i < list.length; i += 200) {
    const rows = await sparql(`
      SELECT ?work ?imdb WHERE {
        VALUES ?work { ${list.slice(i, i + 200).map(id => `wd:${id}`).join(' ')} }
        ?work wdt:P345 ?imdb . FILTER(STRSTARTS(?imdb, "tt"))
      }`);
    for (const r of rows) if (!ids.has(qid(r.work.value))) ids.set(qid(r.work.value), r.imdb.value);
    await pause(PAUSE_MS);
  }
  return ids;
}

async function main() {
  const awards = [];
  for (const group of GROUPS) {
    awards.push(...await categories(group));
    await pause(PAUSE_MS);
  }
  awards.push(...FESTIVAL_PRIZES);
  await currentNames(awards);
  console.log(`${awards.length} categories`);

  // Categories of one name are one award from here on
  const names = [...new Set(awards.map(award => `${award.group}\n${award.category}`))];
  const found = [];
  for (const award of awards) {
    const index = names.indexOf(`${award.group}\n${award.category}`);
    for (const row of await categoryRows(award)) found.push({ ...row, award: index });
  }

  const ids = await imdbIds(new Set(found.map(row => row.work)));
  const byTitle = new Map();
  for (const row of found) {
    const imdb = ids.get(row.work);
    if (!imdb) continue;
    if (!byTitle.has(imdb)) byTitle.set(imdb, new Map());
    const entries = byTitle.get(imdb);
    entries.set(row.award, row.won || Boolean(entries.get(row.award)));
  }

  const titles = {};
  for (const imdb of [...byTitle.keys()].sort()) {
    const entries = [...byTitle.get(imdb)].sort((a, b) => a[0] - b[0]);
    titles[imdb] = [entries.filter(([, won]) => won).map(([award]) => award), entries.filter(([, won]) => !won).map(([award]) => award)];
  }

  fs.writeFileSync(OUTPUT, JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    source: 'Wikidata (CC0) and Wikipedia (CC BY-SA).',
    awards: names.map(name => name.split('\n')),
    titles
  }));
  console.log(`${Object.keys(titles).length} titles, ${Math.round(fs.statSync(OUTPUT).size / 1024)}KB`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
