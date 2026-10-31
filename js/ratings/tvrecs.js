// ============================================================================
// TV recommendations
// There's no public "people who liked X also liked Y" data for TV, so the
// similarity graph is built live from TMDB: for each show you've rated, its
// list of recommended shows, ranked. Rank stands in for similarity (first
// ~0.4, twentieth ~0.07, the same range as the film data), and the graph is
// scored by the same Recommender as films.
//
// Before you've rated many shows, a bridge lane matches TV to your film taste:
// the themes you lean toward in films (MovieLens tags such as "dystopia") are
// looked up as TMDB keywords, and well-known shows with those keywords are
// ranked by how many of your themes they share.
//
// Everything fetched is cached (see RATINGS.STORAGE.TV_RECS_KEY) and refreshed
// after TMDB_CONFIG.LIST_MAX_AGE_MS.
// ============================================================================

const TV_REC = {
  // Similarity for the show at position rank (0-based) in a recommendation list
  RANK_SIM: rank => 0.4 / (1 + rank / 4),
  // TMDB scores are damped toward PRIOR_SCORE by PRIOR_VOTES imaginary votes
  PRIOR_SCORE: 6.8,
  PRIOR_VOTES: 200,
  // A show's TMDB vote count that counts as "everyone's seen it"
  POPULAR_VOTES: 20000,
  CONCURRENCY: 4,
  BRIDGE_THEMES: 8,
  // Small next to theme matches: a tiebreak toward better-rated shows
  BRIDGE_QUALITY: 0.05,
  // Enough rated shows that the bridge lane steps aside
  BRIDGE_UNTIL_RATED: 15
};

const TvRecs = {
  // recs: tmdbId -> { fetchedAt, shows }, find: imdbID -> tmdbId (0 = none),
  // keywords: theme -> keyword id (0 = none), discover: keyword id -> { fetchedAt, shows }
  cache: { recs: {}, find: {}, keywords: {}, discover: {} },
  onChange() {},

  load(saved) {
    const ok = value => value && typeof value === 'object';
    if (!ok(saved)) return;
    for (const part of Object.keys(this.cache)) {
      if (ok(saved[part])) this.cache[part] = saved[part];
    }
  },

  fresh(record) {
    return Boolean(record && Date.now() - record.fetchedAt < TMDB_CONFIG.LIST_MAX_AGE_MS);
  },

  tmdbIdOf(entry) {
    return entry.tmdbId || this.cache.find[entry.imdbID] || null;
  },

  isSeed(entry) {
    return entry.type === 'series' &&
      (entry.verdict === 'up' || entry.verdict === 'down' || entry.stars > 0 || entry.rewatch);
  },

  ratedShows(entries) {
    return entries.filter(e => e.type === 'series' && (e.verdict === 'up' || e.verdict === 'down')).length;
  },

  // Fetch what's missing or stale; returns how many requests were made
  async refresh(entries) {
    let requests = 0;
    const shows = entries.filter(e => this.isSeed(e));

    // Shows imported from the watchlist only have an IMDb ID
    const unresolved = shows.filter(e => !e.tmdbId && !(e.imdbID in this.cache.find));
    await pool(unresolved, async entry => {
      const data = await TMDB.request(`/find/${encodeURIComponent(entry.imdbID)}`, { external_source: 'imdb_id' });
      requests++;
      const match = data && Array.isArray(data.tv_results) ? data.tv_results[0] : null;
      this.cache.find[entry.imdbID] = match && Number.isInteger(match.id) ? match.id : 0;
    });

    const stale = [...new Set(shows.map(e => this.tmdbIdOf(e)).filter(Boolean))]
      .filter(id => !this.fresh(this.cache.recs[id]));
    await pool(stale, async id => {
      let data = await TMDB.request(`/tv/${id}/recommendations`);
      requests++;
      if (!data || !Array.isArray(data.results) || !data.results.length) {
        data = await TMDB.request(`/tv/${id}/similar`);
        requests++;
      }
      this.cache.recs[id] = { fetchedAt: Date.now(), shows: parseShows(data) };
    });

    if (requests) this.onChange();
    return requests;
  },

  // The similarity graph of your rated shows and everything TMDB recommends from them
  graph(entries) {
    const items = new Map();
    const add = (id, show) => {
      if (!items.has(id)) items.set(id, showItem(id, show));
      return items.get(id);
    };
    const edges = [];
    for (const entry of entries) {
      const id = this.isSeed(entry) ? this.tmdbIdOf(entry) : null;
      const record = id && this.cache.recs[id];
      if (!record) continue;
      const info = MovieInfo.get(`${TV_KEY_PREFIX}${id}`) || {};
      add(id, { name: entry.title, year: entry.year, vote_average: info.tmdbRating, vote_count: info.tmdbVotes });
      record.shows.forEach((show, rank) => {
        add(show.id, show);
        edges.push([id, show.id, TV_REC.RANK_SIM(rank)]);
      });
    }
    // Skipped shows only count against what they're linked to if they're in the graph anyway
    const graph = makeGraph([...items.values()], entry => {
      if (entry.type !== 'series') return null;
      const id = this.tmdbIdOf(entry);
      return id ? `${TV_KEY_PREFIX}${id}` : null;
    });
    for (const [from, to, sim] of edges) {
      graph.link(graph.index.get(`${TV_KEY_PREFIX}${from}`), graph.index.get(`${TV_KEY_PREFIX}${to}`), sim);
    }
    return graph;
  },

  // Bridge: shows matching the themes you like in films. themes: [{ name, lift }]
  async bridge(entries, themes) {
    let requests = 0;
    const picked = themes.filter(t => t.lift > 0).slice(0, TV_REC.BRIDGE_THEMES);

    const unknown = picked.filter(t => !(t.name in this.cache.keywords));
    await pool(unknown, async theme => {
      const data = await TMDB.request('/search/keyword', { query: theme.name });
      requests++;
      const results = data && Array.isArray(data.results) ? data.results : [];
      const exact = results.find(k => String(k.name).toLowerCase() === theme.name.toLowerCase());
      this.cache.keywords[theme.name] = exact && Number.isInteger(exact.id) ? exact.id : 0;
    });

    const withIds = picked.map(t => ({ ...t, keyword: this.cache.keywords[t.name] })).filter(t => t.keyword);
    const stale = withIds.filter(t => !this.fresh(this.cache.discover[t.keyword]));
    await pool(stale, async theme => {
      const data = await TMDB.request('/discover/tv', {
        with_keywords: theme.keyword, sort_by: 'vote_count.desc', without_genres: TMDB_CONFIG.EXCLUDED_GENRES
      });
      requests++;
      this.cache.discover[theme.keyword] = { fetchedAt: Date.now(), shows: parseShows(data) };
    });
    if (requests) this.onChange();

    const rated = new Set(entries.filter(e => e.type === 'series').map(e => this.tmdbIdOf(e)).filter(Boolean));
    const scores = new Map();
    for (const theme of withIds) {
      (this.cache.discover[theme.keyword] || { shows: [] }).shows.forEach((show, rank) => {
        if (rated.has(show.id)) return;
        if (!scores.has(show.id)) scores.set(show.id, { show, score: 0, themes: [] });
        const s = scores.get(show.id);
        s.score += theme.lift * TV_REC.RANK_SIM(rank);
        s.themes.push(theme.name);
      });
    }
    return [...scores.values()]
      .map(({ show, score, themes: matched }) => {
        const item = showItem(show.id, show);
        return { ...item, score: score + TV_REC.BRIDGE_QUALITY * (item.average - 3.5), because: matched.slice(0, REC.REASONS) };
      })
      .sort((a, b) => b.score - a.score);
  }
};

// TMDB list results, kept small: [{ id, name, year, poster, vote_average, vote_count }]
function parseShows(data) {
  const results = data && Array.isArray(data.results) ? data.results : [];
  return results
    .filter(show => Number.isInteger(show.id) && show.name)
    .map(show => ({
      id: show.id,
      name: String(show.name),
      year: yearOf(show.first_air_date),
      poster: typeof show.poster_path === 'string' && /^\/[\w.-]+$/.test(show.poster_path) ? show.poster_path : '',
      vote_average: typeof show.vote_average === 'number' ? show.vote_average : null,
      vote_count: Number.isInteger(show.vote_count) ? show.vote_count : 0
    }));
}

// A graph item for a show, with TMDB's score turned into the same scales as
// films: average out of 5, likeRate 0-1, popularity 0-1
function showItem(id, show) {
  const votes = show.vote_count || 0;
  const score = typeof show.vote_average === 'number' ? show.vote_average : TV_REC.PRIOR_SCORE;
  const damped = (votes * score + TV_REC.PRIOR_VOTES * TV_REC.PRIOR_SCORE) / (votes + TV_REC.PRIOR_VOTES);
  return {
    id: `${TV_KEY_PREFIX}${id}`,
    tmdbId: id,
    type: 'series',
    title: show.name || '',
    year: show.year || null,
    poster: show.poster ? TMDB_CONFIG.IMAGE_URL + show.poster : '',
    average: damped / 2,
    likeRate: Math.min(1, Math.max(0, (damped - 5) / 4)),
    popularity: Math.min(1, Math.log10(1 + votes) / Math.log10(TV_REC.POPULAR_VOTES)),
    tmdbRating: show.vote_average
  };
}

// Runs task over items, a few at a time
async function pool(items, task) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(TV_REC.CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await task(queue.shift());
  });
  await Promise.all(workers);
}
