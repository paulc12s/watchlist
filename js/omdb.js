// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// OMDb: every request to OMDb and every parse of its answers, for all pages
//
// Keys: uses the app's own key, and falls back to the shared demo key if OMDb
// rejects it or its daily quota is used up. Once a key fails, the rest of the
// visit uses the next one, so each failure costs one extra request at most.
//
// Identical requests share one response, so retyping a query or looking up
// the same film twice doesn't spend the daily quota twice.
//
// Responses are untrusted: parsing keeps strings only, capped, requires real
// IMDb IDs and keeps a poster only if it's an http(s) URL.
// ============================================================================

const OMDb = {
  keys: [CONFIG.API.OMDB_KEY, CONFIG.API.OMDB_FALLBACK_KEY].filter(Boolean),
  keyIndex: 0,
  responses: new Map(),
  TIMEOUT_MS: 10000,

  // Film or show details: { imdbID, title, year, type, genres, director,
  // writer, actors, plot, runtime, imdbRating, poster }, or null if OMDb has
  // no such title. params: { i: imdbID } or { t: title, y: year, type }
  async details(params) {
    const data = await this.request({ plot: 'short', ...params });
    return data.Response === 'True' ? this.parseDetails(data) : null;
  },

  // One page of search results: { items: [{ imdbID, title, year, type, poster }], total, tooMany }
  async search(params) {
    const data = await this.request(params);
    if (data.Response !== 'True' || !Array.isArray(data.Search)) {
      return { items: [], total: 0, tooMany: data.Error === 'Too many results.' };
    }
    return {
      items: data.Search
        .filter(item => item && this.isImdbID(item.imdbID) && item.Type !== 'game')
        .map(item => ({
          imdbID: item.imdbID,
          title: this.text(item.Title, 500) || 'Unknown',
          // Kept as text: series give a range ("2008–2013")
          year: this.text(item.Year, 20),
          type: this.type(item.Type),
          poster: this.url(item.Poster)
        })),
      total: parseInt(data.totalResults, 10) || 0,
      tooMany: false
    };
  },

  // OMDb's JSON for params, shared between identical requests. Throws a
  // readable error on timeouts, network failures and key or quota problems.
  request(params) {
    const cacheKey = JSON.stringify(Object.entries(params).filter(([, value]) => value).sort());
    if (!this.responses.has(cacheKey)) {
      const pending = this.timed(params).catch(error => {
        this.responses.delete(cacheKey);
        throw error;
      });
      this.responses.set(cacheKey, pending);
    }
    return this.responses.get(cacheKey);
  },

  async timed(params) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);
    let data;
    try {
      data = await this.fetch(params, { signal: controller.signal });
    } catch (error) {
      console.error('OMDb request error:', error);
      throw new Error(error.name === 'AbortError'
        ? 'OMDb timed out. Please try again.'
        : 'Could not reach OMDb. Check your internet connection.');
    } finally {
      clearTimeout(timeoutId);
    }
    // Quota and key problems break every request, so report them instead of "not found"
    if (data.Response === 'False' && /limit|api key/i.test(data.Error || '')) {
      throw new Error(`OMDb: ${data.Error}`);
    }
    return data;
  },

  // Resolves to OMDb's JSON (which may be { Response: 'False', Error }), or
  // throws on network errors, aborts and unexpected HTTP errors
  async fetch(params, { signal } = {}) {
    for (;;) {
      const index = this.keyIndex;
      const url = new URL(CONFIG.API.OMDB_URL);
      url.searchParams.set('apikey', this.keys[index]);
      for (const [name, value] of Object.entries(params)) {
        if (value) url.searchParams.set(name, value);
      }

      const response = await fetch(url, { signal });
      const data = await response.json().catch(() => null);
      if (this.isKeyProblem(response, data) && index < this.keys.length - 1) {
        // Other requests may already have moved on; never move back
        this.keyIndex = Math.max(this.keyIndex, index + 1);
        continue;
      }
      if (data && data.Response) return data;
      throw new Error(`HTTP ${response.status}`);
    }
  },

  isKeyProblem(response, data) {
    return response.status === 401 ||
      Boolean(data && data.Response === 'False' && /limit|api key/i.test(data.Error || ''));
  },

  // ---- Parsing ---------------------------------------------------------------

  parseDetails(data) {
    if (!data || !this.isImdbID(data.imdbID) || data.Type === 'game') return null;
    const year = parseInt(this.text(data.Year, 20), 10);
    const rating = Number(this.text(data.imdbRating, 10));
    return {
      imdbID: data.imdbID,
      title: this.text(data.Title, 500) || 'Unknown',
      year: Number.isInteger(year) ? year : null,
      type: this.type(data.Type),
      genres: this.text(data.Genre, 200).split(',').map(g => g.trim()).filter(Boolean),
      director: this.text(data.Director, 200),
      writer: this.text(data.Writer, 300),
      actors: this.text(data.Actors, 300),
      plot: this.text(data.Plot, 1000),
      runtime: this.text(data.Runtime, 20),
      imdbRating: rating > 0 && rating <= 10 ? rating : null,
      poster: this.url(data.Poster)
    };
  },

  // Strings only, capped, and without OMDb's "N/A"
  text(value, max) {
    return typeof value === 'string' && value !== 'N/A' ? value.substring(0, max) : '';
  },

  url(value) {
    const url = this.text(value, 2000);
    return Security.isSafeUrl(url) ? url : '';
  },

  isImdbID(value) {
    return typeof value === 'string' && /^tt\d{7,10}$/.test(value);
  },

  // OMDb says "movie", "series", "episode" or "game"
  type(value) {
    const type = String(value || '').toLowerCase();
    return type === 'series' || type === 'episode' ? 'series' : 'movie';
  }
};
