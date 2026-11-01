// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// Tests the recommender two ways.
//
//   node tools/eval-similar.js movielens path/to/ml-32m holdout.json
//     Predicts the held-out 20% of MovieLens ratings (build holdout.json with
//     tools/build-similar.js --holdout) and compares like/dislike accuracy with
//     the simple baseline: overall average + film's and person's tendencies.
//
//   node tools/eval-similar.js personal your-export.json
//     Takes any export the app makes. Hides each title you were dealt in turn
//     and checks where the recommender ranks it, per lane; how often strong
//     picks and the rest turned out to be films you'd seen and loved; how the
//     guesses saved before each swipe held up; then lists today's strong picks.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { csvRows, loadMovies } = require('./build-categories.js');
const { isHoldout } = require('./build-similar.js');
const { Recommender, REC } = require('../js/ratings/recommend.js');

// Damping for the baseline's film and person tendencies, as in the earlier measurement
const BIAS_DAMPING = 10;
const LIKE_THRESHOLD = 3.75;

async function movielens(dir, holdoutFile) {
  Recommender.use(JSON.parse(fs.readFileSync(holdoutFile, 'utf8')));
  const movies = await loadMovies(dir);
  const poolIndex = new Map();
  for (const [movieId, m] of movies) {
    const i = Recommender.index.get(m.imdbID);
    if (i !== undefined) poolIndex.set(movieId, i);
  }
  const ratingsFile = path.join(dir, 'ratings.csv');

  // Training averages
  let sum = 0, n = 0;
  const filmSum = new Float64Array(Recommender.films.length);
  const filmCount = new Float64Array(Recommender.films.length);
  for await (const [u, movieId, r] of csvRows(ratingsFile)) {
    const i = poolIndex.get(movieId);
    if (i === undefined || isHoldout(Number(u), Number(movieId))) continue;
    sum += Number(r); n++;
    filmSum[i] += Number(r); filmCount[i]++;
  }
  const mu = sum / n;
  const filmBias = i => (filmSum[i] - mu * filmCount[i]) / (filmCount[i] + BIAS_DAMPING);

  const tally = { base: 0, knn: 0, total: 0, baseSq: 0, knnSq: 0 };
  let user = null, train = new Map(), test = [];
  const flush = () => {
    if (!test.length) return;
    let residual = 0;
    for (const [i, r] of train) residual += r - mu - filmBias(i);
    const userBias = residual / (train.size + BIAS_DAMPING);
    const base = i => mu + filmBias(i) + userBias;
    for (const [i, r] of test) {
      let num = 0, den = 0;
      for (const [j, sim] of Recommender.links[i]) {
        if (!train.has(j)) continue;
        num += sim * (train.get(j) - base(j));
        den += sim;
      }
      const b = base(i);
      const k = den ? b + num / (den + 0.05) : b;
      const liked = r >= 4;
      tally.total++;
      if ((b >= LIKE_THRESHOLD) === liked) tally.base++;
      if ((k >= LIKE_THRESHOLD) === liked) tally.knn++;
      tally.baseSq += (b - r) ** 2;
      tally.knnSq += (k - r) ** 2;
    }
  };
  for await (const [u, movieId, r] of csvRows(ratingsFile)) {
    if (u !== user) { flush(); user = u; train = new Map(); test = []; }
    const i = poolIndex.get(movieId);
    if (i === undefined) continue;
    if (isHoldout(Number(u), Number(movieId))) test.push([i, Number(r)]);
    else train.set(i, Number(r));
  }
  flush();

  const pct = x => `${(100 * x / tally.total).toFixed(1)}%`;
  console.log(`Held-out ratings of the ${Recommender.films.length} films: ${tally.total}`);
  console.log(`  baseline (averages)      like/dislike ${pct(tally.base)}  RMSE ${Math.sqrt(tally.baseSq / tally.total).toFixed(3)}`);
  console.log(`  similar films (item kNN) like/dislike ${pct(tally.knn)}  RMSE ${Math.sqrt(tally.knnSq / tally.total).toFixed(3)}`);
}

// Reads any export the app accepts (titles, ratings or watchlist files) with
// the app's own code, so the evaluation sees exactly what the app would
function readExport(file) {
  const vm = require('node:vm');
  const context = vm.createContext({ console, crypto });
  const source = ['js/config.js', 'js/security.js', 'js/title.js', 'js/library.js']
    .map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
  vm.runInContext(`${source}\nthis.app = { Library, Title };`, context);
  const { Library, Title } = context.app;
  return Library.recordsIn(JSON.parse(fs.readFileSync(file, 'utf8'))).map(raw => Title.sanitize(raw)).filter(Boolean);
}

// How the recommender does on your own ratings. Every title the lists dealt
// you is hidden in turn and scored from everything else, so no title helps
// rank itself. Your file stays on your computer; nothing here is saved.
function personal(exportFile) {
  Recommender.use(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'similar.json'), 'utf8')));
  const entries = readExport(exportFile).filter(e => e.imdbID);
  const graph = Recommender.filmGraph;
  const inGraph = e => graph.index.has(e.imdbID);
  const seen = e => e.verdict === 'up' || e.verdict === 'down';
  const loved = e => e.verdict === 'up' && (e.stars === 5 || e.rewatch);
  const dealt = entries.filter(e => inGraph(e) && (seen(e) || e.verdict === 'skip' || e.verdict === 'pass'));
  const likes = dealt.filter(e => e.verdict === 'up');
  const films = entries.filter(e => e.type === 'movie' && seen(e));
  const missing = films.filter(e => !inGraph(e));

  console.log(`${entries.length} titles: ${likes.length} likes, ${likes.filter(loved).length} loved, ` +
    `${dealt.filter(e => e.verdict === 'skip').length} skips, ${dealt.filter(e => e.verdict === 'pass').length} not interested in the film data`);
  console.log(`Rated films missing from the film data: ${missing.length} of ${films.length}` +
    (missing.length ? ` (${missing.slice(0, 12).map(e => `${e.title}${e.year ? ` ${e.year}` : ''}`).join('; ')}${missing.length > 12 ? '; …' : ''})` : ''));

  // Each dealt title scored with its own entry removed
  const hidden = (entry, lane) => {
    const { results } = Recommender.score(entries.filter(e => e !== entry), lane);
    const at = results.findIndex(r => r.film.id === entry.imdbID);
    return { rank: at + 1, of: results.length, strong: results[at].strong };
  };
  const median = list => [...list].sort((a, b) => a - b)[list.length >> 1];
  const within = (list, k) => list.filter(r => r <= k).length;

  console.log(`\nWhere your likes rank when hidden, among ~${graph.items.length - dealt.length} unrated films (1 = top)`);
  console.log('  lane     likes: median  top 50  top 200   loved: median  top 50');
  const great = new Map();
  for (const lane of ['crowd', 'flat', 'great', 'fun']) {
    const result = new Map(dealt.map(e => [e, hidden(e, lane)]));
    if (lane === 'great') result.forEach((v, k) => great.set(k, v));
    const ranks = list => list.map(e => result.get(e).rank);
    const l = ranks(likes), v = ranks(likes.filter(loved));
    console.log(`  ${lane.padEnd(7)} ${String(median(l)).padStart(14)} ${String(within(l, 50)).padStart(7)} ${String(within(l, 200)).padStart(8)}` +
      ` ${String(v.length ? median(v) : '-').padStart(15)} ${String(within(v, 50)).padStart(7)}`);
  }

  // Seen means "your kind of film": the best label a list of mostly unseen titles has
  console.log('\nTitles the lists dealt you, by where the great lane ranked them (hidden):');
  const band = (label, test) => {
    const rows = dealt.filter(e => test(great.get(e)));
    const share = f => (rows.length ? `${Math.round(100 * rows.filter(f).length / rows.length)}%` : '-');
    console.log(`  ${label.padEnd(40)} ${String(rows.length).padStart(4)} titles   seen ${share(seen).padStart(4)}   loved ${String(rows.filter(loved).length).padStart(3)}   not interested ${share(e => e.verdict === 'pass').padStart(4)}`);
  };
  const cut = g => Recommender.strongCut(g.of);
  band('everything', () => true);
  band('strong picks (top 1%, enough liked links)', g => g.rank <= cut(g) && g.strong >= REC.STRONG_LINKS);
  band('top 1%, fewer links', g => g.rank <= cut(g) && g.strong < REC.STRONG_LINKS);
  band('top 1–5%', g => g.rank > cut(g) && g.rank <= g.of * 0.05);
  band('the rest', g => g.rank > g.of * 0.05);

  // Guesses saved before you swiped: how each label held up
  const guessed = entries.filter(e => typeof e.guessPct === 'number' && e.verdict);
  if (guessed.length) {
    console.log(`\nGuesses saved before you swiped (${guessed.length}):`);
    const tiers = [['top 1%', p => p >= 1 - REC.STRONG_SHARE], ['top 1–5%', p => p < 1 - REC.STRONG_SHARE && p >= 0.95], ['below', p => p < 0.95]];
    for (const [label, test] of tiers) {
      const rows = guessed.filter(e => test(e.guessPct));
      const share = f => (rows.length ? `${Math.round(100 * rows.filter(f).length / rows.length)}%` : '-');
      console.log(`  ${label.padEnd(10)} ${String(rows.length).padStart(4)} titles   seen ${share(seen).padStart(4)}   liked ${share(e => e.verdict === 'up').padStart(4)}`);
    }
  }

  console.log('\nStrong picks now:');
  const picks = Recommender.strongPicks(entries);
  if (!picks.length) console.log('  none yet');
  for (const film of picks) {
    console.log(`  ${film.title} (${film.year}) · ${Math.round(film.likeRate * 100)}% liked · because: ${film.because.join(', ')}`);
  }
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'movielens' && args.length === 2) movielens(...args);
else if (mode === 'personal' && args.length === 1) personal(...args);
else {
  console.error('Usage: node tools/eval-similar.js movielens path/to/ml-32m holdout.json\n' +
    '       node tools/eval-similar.js personal your-export.json');
  process.exit(1);
}
