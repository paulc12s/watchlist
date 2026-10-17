// ============================================================================
// Movie Search API
// ============================================================================

const MovieAPI = {
  // Identical requests share one response, so retyping a query or prefetching
  // details for a result doesn't spend the daily OMDb quota twice
  responseCache: new Map(),
  detailsCache: new Map(),

  request(params) {
    const url = new URL(CONFIG.API.OMDB_URL);
    url.searchParams.set('apikey', CONFIG.API.OMDB_KEY);
    Object.entries(params).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });

    const key = url.toString();
    if (!this.responseCache.has(key)) {
      const pending = this.fetchJSON(key).catch(error => {
        this.responseCache.delete(key);
        throw error;
      });
      this.responseCache.set(key, pending);
    }
    return this.responseCache.get(key);
  },

  async fetchJSON(url) {
    // Add timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let data;

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        mode: 'cors',
        cache: 'default'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      data = await response.json();
    } catch (error) {
      console.error('OMDb request error:', error);
      throw new Error(error.name === 'AbortError'
        ? 'Search timed out. Please try again.'
        : 'Search failed. Check your internet connection.');
    } finally {
      clearTimeout(timeoutId);
    }

    // Quota and key problems break every request, so report them instead of "no results"
    if (data.Response === 'False' && /limit|api key/i.test(data.Error || '')) {
      throw new Error(`OMDb: ${data.Error}`);
    }

    return data;
  },

  // Splits a query into the parts OMDb can filter on:
  //   "tt31450459" or an IMDb URL -> direct lookup
  //   "dune 1984" / "dune (1984)" -> title "dune", year 1984
  parseQuery(rawQuery) {
    const query = rawQuery.trim().replace(/\s+/g, ' ');

    const imdbMatch = query.match(/\btt\d{7,10}\b/);
    if (imdbMatch) {
      return { imdbID: imdbMatch[0] };
    }

    // Cap the year so titles like "Blade Runner 2049" aren't treated as a year filter
    const maxYear = new Date().getFullYear() + 3;
    const yearMatch = query.match(/^(.+?)[\s(]+((?:19|20)\d{2})\)?$/);
    if (yearMatch && parseInt(yearMatch[2], 10) <= maxYear) {
      return { title: yearMatch[1], year: yearMatch[2], fullQuery: query };
    }

    return { title: query };
  },

  async search(rawQuery, type = '') {
    const parsed = this.parseQuery(rawQuery);

    if (parsed.imdbID) {
      const details = await this.getDetails(parsed.imdbID);
      return { results: details ? [details] : [], tooMany: false };
    }

    const { title, year, fullQuery } = parsed;
    if (title.length < 2) {
      return { results: [], tooMany: false };
    }

    // OMDb's exact-title lookup finds titles its fuzzy search buries many pages deep
    const exactLookups = [this.lookupTitle(title, year, type)];
    const pageLookups = [this.searchPage(title, year, type, 1)];

    if (fullQuery) {
      // The trailing number may belong to the title ("Death Race 2000"), so also search it literally
      exactLookups.push(this.lookupTitle(fullQuery, '', type));
      pageLookups.push(this.searchPage(fullQuery, '', type, 1));
    } else {
      // New releases sort behind decades of older matches; ask for this year's directly
      pageLookups.push(this.searchPage(title, String(new Date().getFullYear()), type, 1));
    }

    const [exact, pages] = await Promise.all([
      Promise.all(exactLookups),
      Promise.all(pageLookups)
    ]);

    // Broad queries: pull a few more pages so ranking has more to choose from
    const pageCount = Math.min(CONFIG.SEARCH.MAX_PAGES, Math.ceil(pages[0].total / 10));
    const extraPages = [];
    for (let page = 2; page <= pageCount; page++) {
      extraPages.push(this.searchPage(title, year, type, page));
    }
    pages.push(...await Promise.all(extraPages));

    const candidates = [...exact.filter(Boolean), ...pages.flatMap(p => p.items)];

    return {
      results: this.rank(candidates, parsed).slice(0, CONFIG.SEARCH.MAX_RESULTS),
      tooMany: pages[0].tooMany
    };
  },

  async searchPage(query, year, type, page) {
    const data = await this.request({ s: query, y: year, type, page: String(page) });

    if (data.Response !== 'True' || !Array.isArray(data.Search)) {
      return { items: [], total: 0, tooMany: data.Error === 'Too many results.' };
    }

    return {
      items: data.Search
        .filter(item => item.imdbID && item.Type !== 'game')
        .map(item => ({
          imdbID: item.imdbID,
          title: item.Title || 'Unknown',
          year: item.Year || '',
          type: this.normalizeType(item.Type),
          poster: this.clean(item.Poster)
        })),
      total: parseInt(data.totalResults, 10) || 0,
      tooMany: false
    };
  },

  async lookupTitle(title, year, type) {
    const data = await this.request({ t: title, y: year, type });
    if (data.Response !== 'True' || data.Type === 'game') {
      return null;
    }

    const details = this.toDetails(data);
    this.detailsCache.set(details.imdbID, details);
    return details;
  },

  // Order: how closely the title matches, then the requested year, then recent
  // releases, then OMDb's own order (which roughly tracks popularity)
  rank(candidates, { title, year }) {
    const query = this.normalizeTitle(title);
    const recentYear = new Date().getFullYear() - 1;

    const unique = new Map();
    candidates.forEach((item, order) => {
      if (!unique.has(item.imdbID)) {
        unique.set(item.imdbID, { item, order });
      }
    });

    return [...unique.values()]
      .map(({ item, order }) => {
        const startYear = parseInt(item.year, 10) || 0;
        return {
          item,
          order,
          score: this.matchScore(this.normalizeTitle(item.title), query),
          yearMatch: year && startYear === parseInt(year, 10) ? 1 : 0,
          recent: startYear >= recentYear ? 1 : 0
        };
      })
      .sort((a, b) =>
        b.score - a.score ||
        b.yearMatch - a.yearMatch ||
        b.recent - a.recent ||
        a.order - b.order)
      .map(entry => entry.item);
  },

  matchScore(title, query) {
    const stripArticle = s => s.replace(/^(the|a|an) /, '');

    if (title === query || stripArticle(title) === stripArticle(query)) return 3;
    if (title.startsWith(query) || stripArticle(title).startsWith(stripArticle(query))) return 2;

    const titleWords = title.split(' ');
    if (query.split(' ').every(word => titleWords.includes(word))) return 1;

    return 0;
  },

  normalizeTitle(title) {
    return title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  },

  normalizeType(omdbType) {
    // OMDb returns: "movie", "series", "episode", "game"
    const type = (omdbType || '').toLowerCase();

    if (type === 'series' || type === 'episode') {
      return 'series';
    }

    // Default to movie for "movie" or unknown types
    return 'movie';
  },

  clean(value) {
    return value && value !== 'N/A' ? value : '';
  },

  toDetails(data) {
    return {
      imdbID: data.imdbID,
      title: data.Title || 'Unknown',
      type: this.normalizeType(data.Type),
      year: data.Year || '',
      genre: this.clean(data.Genre),
      rating: this.clean(data.imdbRating),
      plot: this.clean(data.Plot),
      poster: this.clean(data.Poster),
      director: this.clean(data.Director),
      writer: this.clean(data.Writer),
      actors: this.clean(data.Actors)
    };
  },

  async getDetails(imdbID) {
    if (!imdbID) {
      throw new Error('Invalid IMDB ID');
    }

    if (this.detailsCache.has(imdbID)) {
      return this.detailsCache.get(imdbID);
    }

    const data = await this.request({ i: imdbID, plot: 'short' });
    if (data.Response !== 'True') {
      if (data.Error) console.warn('API error:', data.Error);
      return null;
    }

    const details = this.toDetails(data);
    this.detailsCache.set(imdbID, details);
    return details;
  }
};
