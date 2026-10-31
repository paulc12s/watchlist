// Tests the recommender two ways.
//
//   node tools/eval-similar.js movielens path/to/ml-32m holdout.json
//     Predicts the held-out 20% of MovieLens ratings (build holdout.json with
//     tools/build-similar.js --holdout) and compares like/dislike accuracy with
//     the simple baseline: overall average + film's and person's tendencies.
//
//   node tools/eval-similar.js personal ratings-export.json
//     Hides each of your films in turn and checks where the recommender ranks
//     it among everything you haven't rated, per lane. Then lists top picks.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { csvRows, loadMovies } = require('./build-categories.js');
const { isHoldout } = require('./build-similar.js');
const { Recommender } = require('../js/ratings/recommend.js');

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

function personal(exportFile) {
  Recommender.use(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'similar.json'), 'utf8')));
  const entries = JSON.parse(fs.readFileSync(exportFile, 'utf8')).ratings;
  const inPool = e => Recommender.index.has(e.imdbID);
  const top = entries.filter(e => e.verdict === 'up' && (e.stars === 5 || e.rewatch) && inPool(e));
  const likes = entries.filter(e => e.verdict === 'up' && inPool(e));
  const panned = likes.filter(e => Recommender.films[Recommender.index.get(e.imdbID)].likeRate < 0.5);
  const candidates = Recommender.films.length - entries.filter(e => e.verdict || e.want).length;

  const lanes = ['crowd', 'flat', 'great', 'fun'];
  const report = (label, films) => {
    console.log(`\n${label} (${films.length} films, each hidden in turn, ranked among ~${candidates} unrated)`);
    console.log('  lane    median rank   in top 50   in top 200');
    for (const lane of lanes) {
      const ranks = films.map(f => Recommender.rankOf(f.imdbID, entries.filter(e => e !== f), lane)).sort((a, b) => a - b);
      const within = k => `${ranks.filter(r => r <= k).length}/${ranks.length}`;
      console.log(`  ${lane.padEnd(7)} ${String(ranks[ranks.length >> 1]).padStart(11)}   ${within(50).padStart(9)}   ${within(200).padStart(10)}`);
    }
  };
  report('Your 5-star and rewatch films', top);
  report('All your thumbs up', likes);
  report('Thumbs up the MovieLens crowd panned', panned);

  for (const lane of ['great', 'fun']) {
    console.log(`\nTop picks, ${lane} lane:`);
    for (const film of Recommender.recommend(entries, lane, 12)) {
      console.log(`  ${film.title} (${film.year}) · ${Math.round(film.likeRate * 100)}% liked · because: ${film.because.join(', ')}`);
    }
  }
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'movielens' && args.length === 2) movielens(...args);
else if (mode === 'personal' && args.length === 1) personal(...args);
else {
  console.error('Usage: node tools/eval-similar.js movielens path/to/ml-32m holdout.json\n' +
    '       node tools/eval-similar.js personal ratings-export.json');
  process.exit(1);
}
