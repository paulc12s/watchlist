// Builds data/similar.json: for each of the most-rated MovieLens films (plus
// every film in data/categories.json), its most similar films, judged by how
// the same people rated both. The ratings page scores unseen films from these
// lists and your own ratings (js/ratings/recommend.js).
//
//   node tools/build-similar.js path/to/ml-32m
//   node tools/build-similar.js path/to/ml-32m --holdout out.json
//
// --holdout leaves out the test ratings that tools/eval-similar.js predicts,
// so the evaluation never sees its own answers. That file is for testing only.
//
// Similarity is the adjusted cosine: each rating minus that person's average,
// so a harsh rater's 3 and a generous rater's 4.5 both read as "liked it less
// than usual". Pairs few people rated together are shrunk toward zero.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { csvRows, loadMovies, addRatings, addTags } = require('./build-categories.js');

const POOL_SIZE = 5000;
const NEIGHBORS = 30;
// Films need this many people in common before a similarity counts at all,
// and SHRINK more before it counts in full
const MIN_COMMON = 20;
const SHRINK = 100;
// Heavy raters are sampled so one person's 10,000 ratings can't dominate
const MAX_PER_USER = 500;

// The 20% of ratings held out for testing; tools/eval-similar.js uses the same split
function isHoldout(userId, movieId) {
  return ((userId * 2654435761 + movieId * 40503) >>> 0) % 5 === 0;
}

function choosePool(movies) {
  const catalog = require('../data/categories.json');
  const listed = new Set(Object.keys(catalog.movies).filter(key => key.startsWith('tt')));
  // MovieLens lists a few films twice; keep the copy with more ratings
  const byImdb = new Map();
  for (const [id, m] of movies) {
    if (!m.imdbID || !m.count || !m.year || m.series) continue;
    const kept = byImdb.get(m.imdbID);
    if (!kept || kept[1].count < m.count) byImdb.set(m.imdbID, [id, m]);
  }
  const rated = [...byImdb.values()].sort((a, b) => b[1].count - a[1].count);
  const pool = new Map(rated.slice(0, POOL_SIZE));
  for (const [id, m] of rated) if (listed.has(m.imdbID)) pool.set(id, m);
  return [...pool.entries()];
}

// Deterministic sample, so rebuilds give the same lists
function sample(list, size, seed) {
  let state = seed || 1;
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, size);
}

async function similarities(dir, pool, holdout) {
  const n = pool.length;
  const indexOf = new Map(pool.map(([movieId], i) => [movieId, i]));
  const dot = new Float64Array(n * n);
  const common = new Uint32Array(n * n);
  const norm = new Float64Array(n);

  let user = null;
  let ratings = [];
  let previous = -1;
  let users = 0;
  const flush = () => {
    if (ratings.length < 2) return;
    const mean = ratings.reduce((s, r) => s + r[1], 0) / ratings.length;
    let list = ratings.length > MAX_PER_USER ? sample(ratings, MAX_PER_USER, user) : ratings;
    list = list.map(([i, r]) => [i, r - mean]).sort((a, b) => a[0] - b[0]);
    for (let a = 0; a < list.length; a++) {
      const [i, di] = list[a];
      norm[i] += di * di;
      const row = i * n;
      for (let b = a + 1; b < list.length; b++) {
        const [j, dj] = list[b];
        dot[row + j] += di * dj;
        common[row + j]++;
      }
    }
    if (++users % 50000 === 0) console.error(`  ${users} people`);
  };

  for await (const [userField, movieId, rating] of csvRows(path.join(dir, 'ratings.csv'))) {
    const userId = Number(userField);
    if (userId !== user) {
      if (userId < previous) throw new Error('ratings.csv is not grouped by user');
      flush();
      previous = user = userId;
      ratings = [];
    }
    const i = indexOf.get(movieId);
    if (i === undefined || (holdout && isHoldout(userId, Number(movieId)))) continue;
    ratings.push([i, Number(rating)]);
  }
  flush();

  // Each film's closest films, as [index, similarity x 1000, ...]
  return pool.map((_, i) => {
    const best = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const [a, b] = i < j ? [i, j] : [j, i];
      const k = common[a * n + b];
      if (k < MIN_COMMON || !norm[i] || !norm[j]) continue;
      const sim = (dot[a * n + b] / Math.sqrt(norm[i] * norm[j])) * (k / (k + SHRINK));
      if (sim > 0) best.push([j, sim]);
    }
    best.sort((x, y) => y[1] - x[1]);
    return best.slice(0, NEIGHBORS).flatMap(([j, sim]) => [j, Math.round(sim * 1000)]);
  });
}

async function main() {
  const [dir, flag, holdoutOut] = process.argv.slice(2);
  if (!dir || (flag && (flag !== '--holdout' || !holdoutOut))) {
    console.error('Usage: node tools/build-similar.js path/to/ml-32m [--holdout out.json]');
    process.exit(1);
  }
  const holdout = flag === '--holdout';
  console.error('Reading movies, ratings and tags');
  const movies = await loadMovies(dir);
  await addRatings(dir, movies);
  await addTags(dir, movies);
  const pool = choosePool(movies);
  console.error(`Comparing ${pool.length} films${holdout ? ' (test ratings held out)' : ''}`);
  const neighbors = await similarities(dir, pool, holdout);

  const data = {
    generated: new Date().toISOString().split('T')[0],
    source: 'MovieLens 32M (GroupLens Research, University of Minnesota), used under its license: non-commercial, no endorsement implied.',
    // [imdbID, title, year, 'Genre|Genre', 'tag|tag', % who liked it, ratings, damped average x 100]
    films: pool.map(([, m]) => [
      m.imdbID, m.title, m.year, m.genres.join('|'), m.tags.join('|'),
      Math.round(100 * m.likes / m.count), m.count, Math.round(m.score * 100)
    ]),
    neighbors
  };
  const outFile = holdout ? holdoutOut : path.join(__dirname, '..', 'data', 'similar.json');
  fs.writeFileSync(outFile, JSON.stringify(data));
  console.error(`Wrote ${pool.length} films to ${outFile} (${Math.round(fs.statSync(outFile).size / 1024)} KB)`);
}

if (require.main === module) main();

module.exports = { isHoldout };
