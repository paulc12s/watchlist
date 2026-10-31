// ============================================================================
// TMDB client, for TV
// Browses TV lists and fetches show details from themoviedb.org with the key
// you enter in Settings (kept on this device only). Shows are keyed
// "tv:<TMDB id>" until their details give an IMDb ID, which is what ratings
// are stored under, the same as films and the watchlist's TV items.
//
// This product uses the TMDB API but is not endorsed or certified by TMDB.
// ============================================================================

const TV_KEY_PREFIX = 'tv:';

const TMDB = {
  key: '',

  hasKey() {
    return Boolean(this.key);
  },

  isShowKey(key) {
    return key.startsWith(TV_KEY_PREFIX);
  },

  // Accepts either kind of TMDB credential: the short v3 API key, or the long
  // v4 read access token (a JWT, starting "eyJ")
  async request(path, params = {}) {
    if (!this.key) throw new Error('Add your TMDB key in Settings to rate TV');
    const url = new URL(TMDB_CONFIG.API_URL + path);
    const bearer = this.key.startsWith('eyJ');
    if (!bearer) url.searchParams.set('api_key', this.key);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: bearer ? { Authorization: `Bearer ${this.key}` } : {}
      });
    } catch (error) {
      throw new Error(error.name === 'AbortError' ? 'TMDB timed out' : 'Could not reach TMDB');
    } finally {
      clearTimeout(timeoutId);
    }
    if (response.status === 401) throw new Error('TMDB didn’t accept the key. Check it in Settings');
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`TMDB error ${response.status}`);
    return response.json();
  },

  // One list's shows: [{ key, title, year }], in TMDB's order
  async listShows(list) {
    const shows = [];
    for (let page = 1; page <= TMDB_CONFIG.PAGES; page++) {
      const data = await this.request(list.path, { ...list.params, page });
      const results = (data && Array.isArray(data.results)) ? data.results : [];
      for (const show of results) {
        if (!Number.isInteger(show.id) || !show.name) continue;
        shows.push({ key: TV_KEY_PREFIX + show.id, title: String(show.name), year: yearOf(show.first_air_date) });
      }
      if (!data || page >= (data.total_pages || 1)) break;
    }
    return shows;
  },

  async details(key) {
    const id = key.slice(TV_KEY_PREFIX.length);
    const data = await this.request(`/tv/${encodeURIComponent(id)}`, { append_to_response: 'external_ids,aggregate_credits' });
    return data ? this.parse(data) : { missing: true };
  },

  // Into the same shape OMDb details take for films (see MovieInfo.parse)
  parse(data) {
    const names = list => (Array.isArray(list) ? list.map(item => item && item.name).filter(Boolean) : []);
    const imdbID = data.external_ids && /^tt\d{7,10}$/.test(data.external_ids.imdb_id || '') ? data.external_ids.imdb_id : '';
    const seasons = Number.isInteger(data.number_of_seasons) ? data.number_of_seasons : 0;
    const cast = data.aggregate_credits ? names(data.aggregate_credits.cast).slice(0, 3) : [];
    const poster = typeof data.poster_path === 'string' && /^\/[\w.-]+$/.test(data.poster_path)
      ? TMDB_CONFIG.IMAGE_URL + data.poster_path : '';
    return {
      // Without an IMDb ID a show can't be stored, so it's passed over like a missing film
      ...(imdbID ? {} : { missing: true }),
      imdbID,
      tmdbId: Number.isInteger(data.id) ? data.id : null,
      title: String(data.name || ''),
      year: yearOf(data.first_air_date),
      type: 'series',
      genres: names(data.genres),
      director: names(data.created_by).join(', '),
      actors: cast.join(', '),
      plot: String(data.overview || ''),
      runtime: seasons ? `${seasons} season${seasons > 1 ? 's' : ''}` : '',
      tmdbRating: typeof data.vote_average === 'number' && data.vote_count >= 20 ? Math.round(data.vote_average * 10) / 10 : null,
      tmdbVotes: Number.isInteger(data.vote_count) ? data.vote_count : 0,
      poster
    };
  }
};

function yearOf(date) {
  const year = parseInt(String(date || '').slice(0, 4), 10);
  return Number.isInteger(year) ? year : null;
}
