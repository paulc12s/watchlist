// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Recommender
// Scores titles you haven't rated from a similarity graph and your own
// ratings: a title scores well when it sits near titles you rated highly.
//
// Films use data/similar.json (each film's most similar films, built from
// MovieLens by tools/build-similar.js). TV uses TMDB's recommended shows for
// each show you've rated (js/review/tvrecs.js). Both go through the same
// scoring, so a 5-star show counts like a 5-star film.
//
// Your ratings count by strength, not just direction:
//   thumbs down -2 · thumbs up +1 · 4★ +1.5 · 5★ +2.5 (❤️) · rewatch +1 on top
//   not interested -1 · on your list to watch +0.5
//   a skip counts for nothing: it means "not seen", and counting it against
//   films ranked your own likes lower (measured with tools/eval-similar.js)
//
// Strong picks are the few titles worth calling out: in your top 1%, and
// linked closely to at least three titles you liked. In testing, below the
// top 1% the ranking barely separated films you'd seen from the rest.
//
// Two lanes, because quality and enjoyment are different things:
//   great - near your best-rated titles, nudged up by the crowd's verdict
//   fun   - likes the crowd panned count extra, since they say the most about
//           you; no quality nudge
// ============================================================================

const REC = {
  DOWN: -2,
  UP: 1,
  FOUR_STARS: 1.5,
  FIVE_STARS: 2.5,
  REWATCH: 1,
  NOT_INTERESTED: -1,
  WANT: 0.5,
  // A like counts up to 1 + SURPRISE extra in the fun lane the further the
  // crowd's like-rate falls below SURPRISE_BELOW
  SURPRISE: 2,
  SURPRISE_BELOW: 0.65,
  // Similarity mass that a score is shrunk toward zero by, so one weak link isn't enough
  EVIDENCE_PRIOR: 0.5,
  // How much a title's crowd average (out of 5) adds in the great lane, in
  // full once its links to your liked titles reach QUALITY_EVIDENCE of
  // similarity; less before that, so reputation alone can't make a pick
  QUALITY: 1.5,
  QUALITY_EVIDENCE: 1,
  GREAT_MIN_LIKE_RATE: 0.6,
  REASONS: 2,
  // Strong picks: the top STRONG_SHARE of titles (never fewer than
  // STRONG_MIN_RANK places), each with STRONG_LINKS or more liked titles at
  // STRONG_LINK similarity or above (about the top 3% of film links)
  STRONG_SHARE: 0.01,
  STRONG_MIN_RANK: 5,
  STRONG_LINK: 0.15,
  STRONG_LINKS: 3
};

// A similarity graph: items to recommend, and links between them.
//   items: [{ id, title, year, genres, likeRate 0-1, average 0-5, popularity 0-1, ... }]
//   keyOf(entry): the item id a rating refers to, or null
function makeGraph(items, keyOf) {
  return {
    items,
    index: new Map(items.map((item, i) => [item.id, i])),
    links: items.map(() => new Map()),
    keyOf,
    // Keeps the stronger link if one is added twice
    link(i, j, sim) {
      if (i === j || !(sim > 0)) return;
      if ((this.links[i].get(j) || 0) < sim) this.links[i].set(j, sim);
    }
  };
}

const Recommender = {
  // The film graph, also reachable as films / index / links / popularity
  filmGraph: makeGraph([], entry => entry.imdbID),

  get films() { return this.filmGraph.items; },
  get index() { return this.filmGraph.index; },
  get links() { return this.filmGraph.links; },
  get popularity() { return this.filmGraph.items.map(item => item.popularity); },

  // data: the parsed contents of data/similar.json
  use(data) {
    const items = data.films.map(([imdbID, title, year, genres, tags, likePct, count, avgX100]) => ({
      id: imdbID, imdbID, title, year, genres: genres ? genres.split('|') : [], tags: tags ? tags.split('|') : [],
      likeRate: likePct / 100, count, average: avgX100 / 100, popularity: 0
    }));
    const graph = makeGraph(items, entry => entry.imdbID);

    // Similarity both ways: B may be among A's closest films without A being among B's
    data.neighbors.forEach((list, i) => {
      for (let k = 0; k < list.length; k += 2) {
        graph.link(i, list[k], list[k + 1] / 1000);
        graph.link(list[k], i, list[k + 1] / 1000);
      }
    });

    // Popularity as a 0-1 percentile of number of ratings
    const order = items.map((item, i) => [item.count, i]).sort((a, b) => a[0] - b[0]);
    order.forEach(([, i], rank) => { items[i].popularity = rank / Math.max(1, order.length - 1); });
    this.filmGraph = graph;
  },

  ready() {
    return this.filmGraph.items.length > 0;
  },

  // How strongly one of your ratings pulls similar titles up (or down)
  weight(entry, lane, graph = this.filmGraph) {
    const key = graph.keyOf(entry);
    const i = key ? graph.index.get(key) : undefined;
    if (entry.verdict === 'down') return REC.DOWN;
    if (entry.verdict === 'pass') return REC.NOT_INTERESTED;
    if (entry.verdict === 'skip') return 0;
    if (!entry.verdict && entry.want) return REC.WANT;
    if (!this.isLike(entry)) return 0;

    let weight = lane === 'flat' ? REC.UP
      : entry.stars === 5 ? REC.FIVE_STARS : entry.stars === 4 ? REC.FOUR_STARS : REC.UP;
    if (entry.rewatch && lane !== 'flat') weight += REC.REWATCH;
    if (lane === 'fun' && i !== undefined) {
      const below = Math.max(0, REC.SURPRISE_BELOW - graph.items[i].likeRate) / REC.SURPRISE_BELOW;
      weight *= 1 + REC.SURPRISE * below;
    }
    return weight;
  },

  // A title you've seen and liked: the only ratings that explain a pick
  isLike(entry) {
    return entry.verdict === 'up' || entry.stars >= 4 || Boolean(entry.rewatch);
  },

  // How many places count as the top for a list of n titles
  strongCut(n) {
    return Math.max(REC.STRONG_MIN_RANK, Math.round(n * REC.STRONG_SHARE));
  },

  // Every title you haven't dealt with, scored for a lane:
  // 'great', 'fun', 'flat' (all likes equal, for comparison) or 'crowd' (crowd only).
  // evidence is how strongly each title links to titles you liked, and
  // strong how many of those links are close ones (STRONG_LINK).
  score(entries, lane, graph = this.filmGraph) {
    const n = graph.items.length;
    const touched = new Set(entries.filter(e => e.verdict || e.want).map(e => graph.keyOf(e)).filter(Boolean));
    const sums = new Float64Array(n);
    const mass = new Float64Array(n);
    // Similarity to titles you liked, as opposed to skipped or disliked
    const positive = new Float64Array(n);
    const strong = new Uint16Array(n);
    const reasons = new Map();

    if (lane !== 'crowd') {
      for (const entry of entries) {
        const key = graph.keyOf(entry);
        const j = key ? graph.index.get(key) : undefined;
        const w = j === undefined ? 0 : this.weight(entry, lane, graph);
        if (!w) continue;
        const like = w > 0 && this.isLike(entry);
        for (const [c, sim] of graph.links[j]) {
          sums[c] += sim * w;
          mass[c] += sim;
          if (like) {
            positive[c] += sim;
            if (sim >= REC.STRONG_LINK) strong[c]++;
            if (!reasons.has(c)) reasons.set(c, []);
            reasons.get(c).push([j, sim]);
          }
        }
      }
    }

    const results = [];
    graph.items.forEach((item, i) => {
      if (touched.has(item.id)) return;
      let score = lane === 'crowd'
        ? item.average
        : sums[i] / (mass[i] + REC.EVIDENCE_PRIOR);
      if (lane === 'great') {
        const evidence = Math.min(1, positive[i] / REC.QUALITY_EVIDENCE);
        score += REC.QUALITY * (item.average - 3.5) * evidence;
      }
      results.push({ film: item, score, i, evidence: positive[i], strong: strong[i] });
    });
    results.sort((a, b) => b.score - a.score);
    return { results, reasons };
  },

  // Top picks for a lane, each with the liked titles most similar to it
  recommend(entries, lane, limit = 20, graph = this.filmGraph) {
    const { results, reasons } = this.score(entries, lane, graph);
    return results.filter(r => this.fits(r, lane)).slice(0, limit).map(r => this.pick(r, reasons, graph));
  },

  fits(r, lane) {
    return r.evidence > 0 && (lane !== 'great' || !(r.film.likeRate < REC.GREAT_MIN_LIKE_RATE));
  },

  pick({ film, score, i, strong }, reasons, graph) {
    return {
      ...film,
      score,
      strong,
      because: (reasons.get(i) || [])
        .sort((a, b) => b[1] - a[1])
        .slice(0, REC.REASONS)
        .map(([j]) => graph.items[j].title)
    };
  },

  // The standouts: great-lane titles in your top 1% with at least
  // STRONG_LINKS close links to titles you liked. Often none; never padded.
  strongPicks(entries, graph = this.filmGraph) {
    const { results, reasons } = this.score(entries, 'great', graph);
    return results.slice(0, this.strongCut(results.length))
      .filter(r => r.strong >= REC.STRONG_LINKS && this.fits(r, 'great'))
      .map(r => this.pick(r, reasons, graph));
  },

  // Both lanes, with the fun lane leaving out titles already in the great lane
  lanes(entries, limit = 20, graph = this.filmGraph) {
    const great = this.recommend(entries, 'great', limit, graph);
    const shown = new Set(great.map(item => item.id));
    const fun = this.recommend(entries, 'fun', limit * 2, graph).filter(item => !shown.has(item.id)).slice(0, limit);
    return { great, fun };
  },

  // How a title you haven't rated ranks for you, as a guess to reveal after
  // you've given your own verdict: percentile 1 = our top pick, 0 = bottom;
  // rank 1 = top; strong when it would be a strong pick.
  // null when the title isn't in the graph or nothing you've liked links to it.
  guess(id, entries, graph = this.filmGraph) {
    const i = graph.index.get(id);
    if (i === undefined) return null;
    const { results } = this.score(entries.filter(e => graph.keyOf(e) !== id), 'great', graph);
    const at = results.findIndex(r => r.i === i);
    if (at === -1 || !results[at].evidence) return null;
    const top = at < this.strongCut(results.length);
    return {
      percentile: 1 - at / Math.max(1, results.length - 1),
      rank: at + 1,
      top,
      strong: top && results[at].strong >= REC.STRONG_LINKS,
      evidence: results[at].evidence
    };
  },
};

if (typeof module !== 'undefined') module.exports = { Recommender, REC, makeGraph };
