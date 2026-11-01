// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Title search: forgiving, instant suggestions for both searches on the
// combined page (Choose a list in review mode, and the add sheet)
//
// OMDb only matches whole words (and with "*", the start of the last one),
// and neither OMDb nor TMDB forgives a typo. So suggestions come from titles
// the app already knows, matched on this device as you type:
//   - your own titles (first)
//   - TMDB's trending, now playing and popular films and shows, fetched about
//     weekly when this device has a TMDB key, so new releases are in reach
//   - the films bundled for review mode (data/categories.json, and
//     data/similar.json once loaded): about 5,000 well-known films
// A word matches if it's the same, the start of a title word (the word being
// typed), or within a letter or two of one: "bagonia" finds Bugonia.
//
// Suggestions without an IMDb ID (TMDB's, or recent films in the lists) get
// one when picked (resolve), since titles are kept by IMDb ID.
// ============================================================================

const TitleSearch = {
  RECENT_KEY: 'recent_titles_v1',
  RECENT_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
  RECENT_LISTS: [
    ['/trending/all/week', 3], ['/movie/now_playing', 2], ['/movie/popular', 3],
    ['/movie/upcoming', 1], ['/tv/popular', 3], ['/tv/on_the_air', 1]
  ],
  SOURCE_RANK: { yours: 3, recent: 2, lists: 1 },
  // TMDB's recent and popular titles: { fetchedDate, titles: [...] }
  recent: null,
  // The bundled film lists, if review mode hasn't loaded them yet
  lists: {},
  index: null,
  indexVersion: '',

  // Loads the saved recent titles (fetching them again when a week old) and
  // the bundled film lists. Read separately from Catalog's copy, so loading
  // them here can't race review mode's start-up.
  async init() {
    try {
      const saved = await Store.load(this.RECENT_KEY);
      if (saved && Array.isArray(saved.titles)) this.recent = saved;
    } catch (error) {
      // Suggestions work without them
    }
    this.refreshRecent();
    try {
      const response = await fetch(REVIEW.CATEGORIES_URL);
      if (response.ok) this.lists = (await response.json()).movies || {};
      this.index = null;
    } catch (error) {
      // Offline: your titles and recent ones still suggest
    }
  },

  async refreshRecent() {
    if (typeof TMDB === 'undefined' || !TMDB.hasKey()) return;
    if (this.recent && Date.now() - this.recent.fetchedDate < this.RECENT_MAX_AGE_MS) return;
    const titles = new Map();
    try {
      for (const [path, pages] of this.RECENT_LISTS) {
        for (let page = 1; page <= pages; page++) {
          const data = await TMDB.request(path, { page });
          for (const item of (data && Array.isArray(data.results) ? data.results : [])) {
            const parsed = this.parseTmdb(item, path.startsWith('/tv') ? 'tv' : path.startsWith('/movie') ? 'movie' : item.media_type);
            if (parsed && !titles.has(parsed.tmdb)) titles.set(parsed.tmdb, parsed);
          }
        }
      }
    } catch (error) {
      console.warn('Recent titles not refreshed:', error.message);
      if (!titles.size) return;
    }
    this.recent = { fetchedDate: Date.now(), titles: [...titles.values()].slice(0, 500) };
    this.index = null;
    Store.scheduleSave(this.RECENT_KEY, () => this.recent);
  },

  // A TMDB list entry, kept only if it's a film or show with a name
  parseTmdb(item, media) {
    if (!item || !Number.isInteger(item.id) || (media !== 'movie' && media !== 'tv')) return null;
    const title = typeof (item.title || item.name) === 'string' ? (item.title || item.name).slice(0, 300) : '';
    if (!title) return null;
    const date = String(item.release_date || item.first_air_date || '');
    const poster = typeof item.poster_path === 'string' && /^\/[\w.-]+$/.test(item.poster_path)
      ? `https://image.tmdb.org/t/p/w185${item.poster_path}` : '';
    return {
      tmdb: `${media}:${item.id}`, title, year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
      type: media === 'tv' ? 'series' : 'movie', poster,
      popularity: typeof item.popularity === 'number' ? item.popularity : 0
    };
  },

  // ---- Matching ----------------------------------------------------------------

  normalize(text) {
    return MovieAPI.normalizeTitle(String(text || ''));
  },

  // Everything suggestions can come from, rebuilt when a source changes
  entries() {
    const lists = typeof Catalog !== 'undefined' && Object.keys(Catalog.movies).length ? Catalog.movies : this.lists;
    const films = typeof Recommender !== 'undefined' ? Recommender.films : [];
    const recent = this.recent ? this.recent.titles : [];
    const version = [Library.all().length, Object.keys(lists).length, films.length, recent.length, Library.revision || 0].join('/');
    if (this.index && this.indexVersion === version) return this.index;

    const seen = new Set();
    const index = [];
    const add = (entry, source, popularity = 0) => {
      const words = this.normalize(entry.title).split(' ').filter(Boolean);
      // The same title from two sources (yours, and again from TMDB or the
      // lists without an IMDb ID) is one suggestion: the first source's
      const ids = [entry.imdbID, entry.year && `${words.join(' ')}|${entry.year}`].filter(Boolean);
      if (!words.length || ids.some(id => seen.has(id))) return;
      ids.forEach(id => seen.add(id));
      index.push({ ...entry, source, popularity, words });
    };
    for (const t of Library.all()) {
      if (t.type === 'youtube' || !t.imdbID) continue;
      add({ imdbID: t.imdbID, title: t.title, year: t.year, type: t.type, poster: t.poster }, 'yours', 1e9);
    }
    for (const r of recent) add(r, 'recent', r.popularity);
    for (const f of films) add({ imdbID: f.imdbID, title: f.title, year: f.year, type: 'movie' }, 'lists', f.count || 0);
    for (const [key, [title, year, , , , count]] of Object.entries(lists)) {
      if (key.startsWith('tv:')) continue;
      add(key.startsWith('tt') ? { imdbID: key, title, year, type: 'movie' } : { listKey: key, title, year, type: 'movie' }, 'lists', count || 0);
    }
    this.index = index;
    this.indexVersion = version;
    return index;
  },

  // Optimal string alignment distance (Damerau-Levenshtein with adjacent swaps)
  distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, prev2[j - 2] + 1);
        row.push(value);
        best = Math.min(best, value);
      }
      if (best > max) return max + 1;
      prev2 = prev;
      prev = row;
    }
    return prev[b.length];
  },

  // How well one typed word matches a title word: 3 exact, 2.5 the start of
  // it (the word being typed), up to 2 for a near miss, 0 for none
  wordScore(typed, word, typing) {
    if (typed === word) return 3;
    if (typing && typed.length >= 2 && word.startsWith(typed)) return 2.5;
    const allowed = typed.length >= 8 ? 2 : typed.length >= 4 ? 1 : 0;
    if (!allowed) return 0;
    let d = this.distance(typed, word, allowed);
    // Still typing: compare with the start of the word too ("bagon" ~ "bugon")
    if (typing && word.length > typed.length) d = Math.min(d, this.distance(typed, word.slice(0, typed.length), allowed));
    return d <= allowed ? 2 - d / (allowed + 1) : 0;
  },

  // Every typed word must match a different title word
  score(typedWords, entry) {
    const used = new Set();
    let total = 0;
    for (let k = 0; k < typedWords.length; k++) {
      const typing = k === typedWords.length - 1;
      let best = 0, bestAt = -1;
      entry.words.forEach((word, at) => {
        if (used.has(at)) return;
        const s = this.wordScore(typedWords[k], word, typing);
        if (s > best) { best = s; bestAt = at; }
      });
      if (!best) return 0;
      used.add(bestAt);
      total += best;
    }
    // Titles that are mostly what you typed beat long ones that merely contain it
    const ignored = entry.words.filter(w => !['the', 'a', 'an', 'of', 'and'].includes(w)).length - used.size;
    return total / typedWords.length - Math.max(0, ignored) * 0.05;
  },

  // Suggestions for what's typed so far: [{ title, year, type, poster,
  // imdbID | tmdb | listKey, source, near }], best first. near: a spelling match
  suggest(query, { limit = 6, type = '' } = {}) {
    const { title, year } = MovieAPI.parseQuery(query);
    const typed = this.normalize(title || '').split(' ').filter(Boolean);
    if (!typed.length || typed.join('').length < 2) return [];
    const wantYear = year ? Number(year) : null;
    return this.entries()
      .filter(entry => !type || entry.type === type)
      .map(entry => ({ entry, score: this.score(typed, entry) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score ||
        Number(b.entry.year === wantYear) - Number(a.entry.year === wantYear) ||
        this.SOURCE_RANK[b.entry.source] - this.SOURCE_RANK[a.entry.source] ||
        b.entry.popularity - a.entry.popularity)
      .slice(0, limit)
      .map(({ entry, score }) => {
        const { words, popularity, ...rest } = entry;
        return { ...rest, near: score < 2.4 };
      });
  },

  // ---- Searching as you type -----------------------------------------------------
  // One routine for both searches (review's Choose a list, and the add sheet):
  // suggestions at once, then OMDb's results once typing pauses (from
  // WILDCARD_MIN letters, or an IMDb link), without the ones already
  // suggested. update({ query, suggestions, results, state, tooMany }) is
  // called whenever there's more to show; state is '' (nothing typed),
  // 'short' (keep typing), 'searching', 'done', or an error message. A newer
  // search, or cancel(), drops what an older one would have shown.
  searcher(update) {
    let seq = 0;
    let timer = null;
    return {
      cancel() {
        seq++;
        clearTimeout(timer);
      },
      search: (raw, { type = '', delay = CONFIG.SEARCH.DELAY_MS } = {}) => {
        const query = raw.trim();
        const mine = ++seq;
        clearTimeout(timer);
        if (!query) return update({ query, suggestions: [], results: [], state: '' });
        const suggestions = this.suggest(query, { type });
        const enough = MovieAPI.parseQuery(query).imdbID || query.replace(/\s/g, '').length >= CONFIG.SEARCH.WILDCARD_MIN;
        update({ query, suggestions, results: [], state: enough ? 'searching' : 'short' });
        if (!enough) return;
        timer = setTimeout(async () => {
          try {
            const { results, tooMany } = await MovieAPI.search(query, type);
            if (mine !== seq) return;
            const shown = new Set(suggestions.map(r => r.imdbID).filter(Boolean));
            update({ query, suggestions, results: results.filter(r => r.imdbID && !shown.has(r.imdbID)), state: 'done', tooMany });
          } catch (error) {
            if (mine === seq) update({ query, suggestions, results: [], state: error.message });
          }
        }, delay);
      }
    };
  },

  // The IMDb ID for a suggestion, looking it up if the suggestion came
  // without one; null if it can't be found
  async resolve(suggestion) {
    if (suggestion.imdbID) return suggestion.imdbID;
    // TMDB knows its own titles' IMDb IDs; without a key, OMDb by title and year
    if (suggestion.tmdb && TMDB.hasKey()) {
      const [media, id] = suggestion.tmdb.split(':');
      const data = await TMDB.request(`/${media}/${id}/external_ids`);
      const imdbID = data && typeof data.imdb_id === 'string' && /^tt\d{7,10}$/.test(data.imdb_id) ? data.imdb_id : null;
      if (imdbID) suggestion.imdbID = imdbID;
      return imdbID;
    }
    const details = await OMDb.details({ t: suggestion.title, y: suggestion.year || '', type: suggestion.type === 'series' ? 'series' : 'movie' });
    return details ? details.imdbID : null;
  }
};
