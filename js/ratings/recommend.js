// ============================================================================
// Recommender
// Scores films you haven't rated from data/similar.json (each film's most
// similar films, built from MovieLens by tools/build-similar.js) and your own
// ratings: a film scores well when it sits near films you rated highly.
//
// Your ratings count by strength, not just direction:
//   thumbs down -2 · thumbs up +1 · 4★ +1.5 · 5★ +2.5 · rewatch +1 on top
//   skipping a widely seen film counts slightly against (you passed on it)
//
// Two lanes, because quality and enjoyment are different things:
//   great - near your best-rated films, nudged up by MovieLens quality
//   fun   - likes the crowd panned count extra, since they say the most about
//           you; no quality nudge
// ============================================================================

const REC = {
  DOWN: -2,
  UP: 1,
  FOUR_STARS: 1.5,
  FIVE_STARS: 2.5,
  REWATCH: 1,
  // Skips: from SKIP_MIN for obscure films to SKIP_MIN + SKIP_POPULAR for the most watched
  SKIP_MIN: -0.2,
  SKIP_POPULAR: -0.3,
  // A like counts up to 1 + SURPRISE extra in the fun lane the further the
  // crowd's like-rate falls below SURPRISE_BELOW
  SURPRISE: 2,
  SURPRISE_BELOW: 0.65,
  // Similarity mass that a score is shrunk toward zero by, so one weak link isn't enough
  EVIDENCE_PRIOR: 0.5,
  // How much a film's MovieLens average (damped, out of 5) adds in the great lane,
  // in full once its links to your liked films reach QUALITY_EVIDENCE of
  // similarity; less before that, so reputation alone can't make a pick
  QUALITY: 1.5,
  QUALITY_EVIDENCE: 1,
  GREAT_MIN_LIKE_RATE: 0.6,
  REASONS: 2
};

const Recommender = {
  films: [],
  index: new Map(),
  links: [],
  popularity: [],

  // data: the parsed contents of data/similar.json
  use(data) {
    this.films = data.films.map(([imdbID, title, year, genres, tags, likePct, count, avgX100]) => ({
      imdbID, title, year, genres: genres ? genres.split('|') : [], tags: tags ? tags.split('|') : [],
      likeRate: likePct / 100, count, average: avgX100 / 100
    }));
    this.index = new Map(this.films.map((film, i) => [film.imdbID, i]));

    // Similarity both ways: B may be among A's closest films without A being among B's
    this.links = this.films.map(() => new Map());
    data.neighbors.forEach((list, i) => {
      for (let k = 0; k < list.length; k += 2) {
        const j = list[k];
        const sim = list[k + 1] / 1000;
        if ((this.links[i].get(j) || 0) < sim) this.links[i].set(j, sim);
        if ((this.links[j].get(i) || 0) < sim) this.links[j].set(i, sim);
      }
    });

    // Popularity as a 0-1 percentile of number of ratings
    const order = this.films.map((film, i) => [film.count, i]).sort((a, b) => a[0] - b[0]);
    this.popularity = new Array(this.films.length);
    order.forEach(([, i], rank) => { this.popularity[i] = rank / Math.max(1, order.length - 1); });
  },

  // How strongly one of your ratings pulls similar films up (or down)
  weight(entry, lane) {
    const i = this.index.get(entry.imdbID);
    if (entry.verdict === 'down') return REC.DOWN;
    if (entry.verdict === 'skip') {
      return i === undefined ? 0 : REC.SKIP_MIN + REC.SKIP_POPULAR * this.popularity[i];
    }
    const liked = entry.verdict === 'up' || entry.stars >= 4 || entry.rewatch;
    if (!liked) return 0;

    let weight = lane === 'flat' ? REC.UP
      : entry.stars === 5 ? REC.FIVE_STARS : entry.stars === 4 ? REC.FOUR_STARS : REC.UP;
    if (entry.rewatch && lane !== 'flat') weight += REC.REWATCH;
    if (lane === 'fun' && i !== undefined) {
      const below = Math.max(0, REC.SURPRISE_BELOW - this.films[i].likeRate) / REC.SURPRISE_BELOW;
      weight *= 1 + REC.SURPRISE * below;
    }
    return weight;
  },

  // Every film you haven't dealt with, scored for a lane:
  // 'great', 'fun', 'flat' (all likes equal, for comparison) or 'crowd' (MovieLens only)
  score(entries, lane) {
    const touched = new Set(entries.filter(e => e.verdict || e.want).map(e => e.imdbID));
    const sums = new Float64Array(this.films.length);
    const mass = new Float64Array(this.films.length);
    // Similarity to films you liked, as opposed to skipped or disliked
    const positive = new Float64Array(this.films.length);
    const reasons = new Map();

    if (lane !== 'crowd') {
      for (const entry of entries) {
        const j = this.index.get(entry.imdbID);
        const w = j === undefined ? 0 : this.weight(entry, lane);
        if (!w) continue;
        for (const [c, sim] of this.links[j]) {
          sums[c] += sim * w;
          mass[c] += sim;
          if (w > 0) {
            positive[c] += sim;
            if (!reasons.has(c)) reasons.set(c, []);
            reasons.get(c).push([j, sim]);
          }
        }
      }
    }

    const results = [];
    this.films.forEach((film, i) => {
      if (touched.has(film.imdbID)) return;
      let score = lane === 'crowd'
        ? film.average
        : sums[i] / (mass[i] + REC.EVIDENCE_PRIOR);
      if (lane === 'great') {
        const evidence = Math.min(1, positive[i] / REC.QUALITY_EVIDENCE);
        score += REC.QUALITY * (film.average - 3.5) * evidence;
      }
      results.push({ film, score, i });
    });
    results.sort((a, b) => b.score - a.score);
    return { results, reasons };
  },

  // Top picks for a lane, each with the liked films most similar to it
  recommend(entries, lane, limit = 20) {
    const { results, reasons } = this.score(entries, lane);
    const fits = lane === 'great'
      ? r => r.film.likeRate >= REC.GREAT_MIN_LIKE_RATE
      : () => true;
    return results.filter(fits).slice(0, limit).map(({ film, score, i }) => ({
      ...film,
      score,
      because: (reasons.get(i) || [])
        .sort((a, b) => b[1] - a[1])
        .slice(0, REC.REASONS)
        .map(([j]) => this.films[j].title)
    }));
  },

  // Both lanes, with the fun lane leaving out films already in the great lane
  lanes(entries, limit = 20) {
    const great = this.recommend(entries, 'great', limit);
    const shown = new Set(great.map(film => film.imdbID));
    const fun = this.recommend(entries, 'fun', limit * 2).filter(film => !shown.has(film.imdbID)).slice(0, limit);
    return { great, fun };
  },

  // Where a film lands among everything unrated: 1 = top pick. For testing.
  rankOf(imdbID, entries, lane) {
    const { results } = this.score(entries, lane);
    return results.findIndex(r => r.film.imdbID === imdbID) + 1;
  }
};

if (typeof module !== 'undefined') module.exports = { Recommender, REC };
