// ============================================================================
// Catalog
// The film lists from data/categories.json (built from MovieLens by
// tools/build-categories.js), plus OMDb details for each card.
//
// Films are keyed by IMDb ID. Recent films MovieLens doesn't have are keyed
// "title:Name (Year)" and matched on OMDb by title the first time they're dealt.
//
// TV lists come live from TMDB (js/ratings/tmdb.js), keyed "tv:<TMDB id>",
// and are fetched when first opened, then kept for a week.
// ============================================================================

const MIX_ID = 'mix';

const MovieInfo = {
  // key -> details, or { missing: true } when OMDb has no such film
  cache: new Map(),
  pending: new Map(),
  onChange() {},

  get(key) {
    return this.cache.get(key);
  },

  imdbID(key) {
    if (key.startsWith('tt')) return key;
    const info = this.cache.get(key);
    return info && info.imdbID ? info.imdbID : null;
  },

  // What a key should turn out to be: shows from TV lists, or a show you've
  // already rated; everything else is a film
  expectedType(key) {
    if (TMDB.isShowKey(key)) return 'series';
    const entry = key.startsWith('tt') ? Ratings.get(key) : null;
    return entry && entry.type === 'series' ? 'series' : 'movie';
  },

  // Series that sneak into the film lists, and titles nobody can find, are passed over
  isUsable(info, key) {
    return Boolean(info && !info.missing && info.type === this.expectedType(key));
  },

  // Shares one request per key; throws on network, key or quota problems
  fetch(key) {
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    if (!this.pending.has(key)) {
      const request = this.request(key)
        .then(info => {
          this.cache.set(key, info);
          // Films found by title can then be looked up by ID too
          if (info.imdbID && info.imdbID !== key) this.cache.set(info.imdbID, info);
          this.onChange();
          return info;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, request);
    }
    return this.pending.get(key);
  },

  async request(key) {
    if (TMDB.isShowKey(key)) return TMDB.details(key);
    const url = new URL(CONFIG.API.OMDB_URL);
    url.searchParams.set('apikey', CONFIG.API.OMDB_KEY);
    if (key.startsWith('tt')) {
      url.searchParams.set('i', key);
    } else {
      const { title, year } = Catalog.basics(key);
      url.searchParams.set('t', title);
      if (year) url.searchParams.set('y', year);
      url.searchParams.set('type', 'movie');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let data;
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
    } catch (error) {
      throw new Error(error.name === 'AbortError' ? 'OMDb timed out' : 'Could not reach OMDb');
    } finally {
      clearTimeout(timeoutId);
    }

    if (data.Response === 'False') {
      if (/limit|api key/i.test(data.Error || '')) throw new Error(`OMDb: ${data.Error}`);
      return { missing: true };
    }
    return this.parse(data);
  },

  parse(data) {
    const value = field => (data[field] && data[field] !== 'N/A' ? String(data[field]) : '');
    const year = parseInt(value('Year'), 10);
    return {
      imdbID: value('imdbID'),
      title: value('Title'),
      year: Number.isInteger(year) ? year : null,
      type: value('Type'),
      genres: value('Genre').split(',').map(g => g.trim()).filter(Boolean),
      director: value('Director'),
      actors: value('Actors'),
      plot: value('Plot'),
      runtime: value('Runtime'),
      imdbRating: value('imdbRating'),
      poster: Security.isSafeUrl(value('Poster')) ? value('Poster') : ''
    };
  },

  load(entries) {
    this.cache = new Map(Array.isArray(entries) ? entries : []);
  },

  dump() {
    return [...this.cache.entries()];
  }
};

const Catalog = {
  movies: {},
  categories: [],
  // TV list id -> { fetchedDate, shows: [{ key, title, year }] }
  tvLists: {},
  onTvListsChange() {},

  async load() {
    const response = await fetch(RATINGS.CATEGORIES_URL);
    if (!response.ok) throw new Error('Could not load the film lists');
    this.use(await response.json());
  },

  use(data) {
    this.movies = data.movies || {};
    const mix = {
      id: MIX_ID, group: 'Start here', name: 'Mix of everything',
      note: 'Every list shuffled together', keys: Object.keys(this.movies)
    };
    const films = [...(data.categories || []), mix].map(category => ({ ...category, media: 'film', loaded: true }));
    const tv = TV_LISTS.map(list => ({ ...list, media: 'tv', keys: [], loaded: false }));
    this.categories = [...films, ...tv];
  },

  // Snapshots saved by an earlier visit
  restoreTvLists(saved) {
    if (!saved || typeof saved !== 'object') return;
    for (const [id, snapshot] of Object.entries(saved)) {
      if (!snapshot || !Number.isFinite(snapshot.fetchedDate) || !Array.isArray(snapshot.shows)) continue;
      this.tvLists[id] = snapshot;
      this.useShows(id, snapshot.shows);
    }
  },

  isTv(id) {
    return this.get(id).media === 'tv';
  },

  // TV lists: from the week-old snapshot if there is one, otherwise from TMDB
  async prepare(id) {
    const category = this.get(id);
    if (category.media !== 'tv') return;
    const snapshot = this.tvLists[category.id];
    if (category.loaded && snapshot && Date.now() - snapshot.fetchedDate < TMDB_CONFIG.LIST_MAX_AGE_MS) return;
    const shows = await TMDB.listShows(category);
    this.tvLists[category.id] = { fetchedDate: Date.now(), shows };
    this.useShows(category.id, shows);
    this.onTvListsChange();
  },

  useShows(id, shows) {
    const category = this.categories.find(c => c.id === id && c.media === 'tv');
    if (!category || !Array.isArray(shows)) return;
    category.keys = [];
    for (const show of shows) {
      if (!show || typeof show.key !== 'string' || !TMDB.isShowKey(show.key)) continue;
      if (!this.movies[show.key]) this.movies[show.key] = [String(show.title || ''), show.year || null, ''];
      category.keys.push(show.key);
    }
    category.loaded = true;
  },

  get(id) {
    return this.categories.find(c => c.id === id) || this.categories[0];
  },

  groups() {
    const groups = new Map();
    for (const category of this.categories) {
      if (!groups.has(category.group)) groups.set(category.group, []);
      groups.get(category.group).push(category);
    }
    return groups;
  },

  // What the lists know about a film: title, year and genres for showing a card
  // before OMDb answers, plus MovieLens tags and the share of raters who liked
  // it (likeRate 0-1, null when MovieLens doesn't have the film)
  basics(key) {
    const [title, year, genres, tags, likePct, crowdCount] = this.movies[key] || [];
    const split = value => (value ? value.split('|') : []);
    if (title) {
      return {
        title, year, genres: split(genres), tags: split(tags),
        likeRate: typeof likePct === 'number' ? likePct / 100 : null, crowdCount: crowdCount || 0
      };
    }
    const match = key.match(/^title:(.*) \((\d{4})\)$/);
    return {
      title: match ? match[1] : key, year: match ? Number(match[2]) : null,
      genres: [], tags: [], likeRate: null, crowdCount: 0
    };
  },

  // A film or show is out of the running once rated, skipped or wanted, or
  // once its details say it isn't what the list expected
  isDone(key) {
    const imdbID = MovieInfo.imdbID(key);
    if (imdbID && Ratings.isDone(imdbID)) return true;
    const info = MovieInfo.get(key);
    return Boolean(info && !MovieInfo.isUsable(info, key));
  },

  remaining(id) {
    return this.get(id).keys.filter(key => !this.isDone(key)).length;
  },

  // Keys to deal, in list order or shuffled; the mix is always shuffled
  queue(id, order) {
    const keys = this.get(id).keys.filter(key => !this.isDone(key));
    if (order === 'learn' && !this.isTv(id) && this.learnScore) {
      const score = this.learnScore();
      return keys.map(key => [key, score(key)]).sort((a, b) => b[1] - a[1]).map(([key]) => key);
    }
    return order === 'shuffled' || id === MIX_ID ? shuffle(keys) : keys;
  },

  // Set once the recommender is ready: returns key -> how much rating it would
  // teach (widely seen, and little you've rated is similar to it)
  learnScore: null,

  // The next list of the same kind (films or TV) with anything left in it,
  // wrapping round; a TV list not fetched yet might have, so it counts
  nextId(id) {
    const current = this.get(id);
    const index = this.categories.indexOf(current);
    for (let step = 1; step <= this.categories.length; step++) {
      const next = this.categories[(index + step) % this.categories.length];
      if (next.media !== current.media) continue;
      if (!next.loaded || this.remaining(next.id) > 0) return next.id;
    }
    return null;
  }
};

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
