// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Ratings page settings
// Shares CONFIG (OMDb key, app version, limits, its database) from
// js/config.js. Titles are kept by js/library.js; these are the page's other
// stored keys, in the same database.
// ============================================================================

const RATINGS = {
  STORAGE: {
    INFO_KEY: 'movie_info_v1',
    PREFS_KEY: 'prefs_v1',
    TV_LISTS_KEY: 'tv_lists_v1',
    TV_RECS_KEY: 'tv_recs_v1'
  },
  CATEGORIES_URL: 'data/categories.json',
  SIMILAR_URL: 'data/similar.json',
  ORDERS: ['ranked', 'shuffled', 'learn'],
  // Films or shows with a thumb before For you has much to go on
  MIN_FOR_YOU: 10,
  FOR_YOU_PICKS: 12,
  // OMDb lookups for posters in For you, per lane
  FOR_YOU_POSTERS: 8,
  // Guesses about cards, revealed after you swipe. Only the top 1% is called
  // a match: below it, the ranking barely beat chance (tools/eval-similar.js)
  GUESS_LABELS: { strong: 'a strong pick for you', top: 'a likely match', rest: 'not one of our picks' },
  MIN_GUESSES: 10,
  // Pixels, or a quick flick, to count a drag as a swipe
  SWIPE_DISTANCE: 90,
  SWIPE_VELOCITY: 0.5,
  PREFETCH: 2,
  // Profile rows need at least this many rated films behind them
  MIN_PROFILE_FILMS: 3
};

// ============================================================================
// TV lists, browsed live from TMDB (themoviedb.org) with your own free key.
// Each list is a TMDB query; shows are dealt like films. Genre and network
// IDs are TMDB's. News, talk, reality and soaps are left out of every list
// except where a list asks for that genre.
// ============================================================================

const TMDB_CONFIG = {
  API_URL: 'https://api.themoviedb.org/3',
  IMAGE_URL: 'https://image.tmdb.org/t/p/w780',
  KEY_HELP_URL: 'https://www.themoviedb.org/settings/api',
  // Pages of 20 shows fetched per list
  PAGES: 5,
  // Lists are fetched again after this long
  LIST_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
  EXCLUDED_GENRES: '10763,10764,10766,10767'
};

const TV_LISTS = (() => {
  const known = { sort_by: 'vote_count.desc', without_genres: TMDB_CONFIG.EXCLUDED_GENRES };
  const best = { sort_by: 'vote_average.desc', 'vote_count.gte': 1500, without_genres: TMDB_CONFIG.EXCLUDED_GENRES };
  const discover = (id, group, name, params, note) => ({ id, group, name, note, path: '/discover/tv', params });
  const genre = (id, name, genreId) => discover(id, 'TV genres', `${name} TV`, { ...known, with_genres: genreId });
  const network = (id, name, networkId) => discover(id, 'TV networks', name, { ...known, with_networks: networkId });
  const since = (id, name, from, to) => discover(id, 'TV decades', name, {
    ...known, 'first_air_date.gte': from, ...(to ? { 'first_air_date.lte': to } : {})
  });
  return [
    discover('tv-most-watched', 'TV', 'Most watched TV', known, 'Shows most people have seen: the quickest way to start'),
    discover('tv-top-rated', 'TV', 'Top rated TV', best),
    { id: 'tv-trending', group: 'TV', name: 'Trending TV', path: '/trending/tv/week', params: {}, note: 'What people are watching now' },
    genre('tv-drama', 'Drama', 18),
    genre('tv-comedy', 'Comedy', 35),
    genre('tv-crime', 'Crime', 80),
    genre('tv-scifi', 'Sci-fi & fantasy', 10765),
    genre('tv-action', 'Action & adventure', 10759),
    genre('tv-mystery', 'Mystery', 9648),
    genre('tv-animation', 'Animation', 16),
    genre('tv-documentary', 'Documentary', 99),
    genre('tv-war', 'War & politics', 10768),
    network('tv-hbo', 'HBO', 49),
    network('tv-netflix', 'Netflix', 213),
    network('tv-fx', 'FX', 88),
    network('tv-amc', 'AMC', 174),
    network('tv-apple', 'Apple TV+', 2552),
    since('tv-2020s', '2020s TV', '2020-01-01'),
    since('tv-2010s', '2010s TV', '2010-01-01', '2019-12-31'),
    since('tv-2000s', '2000s TV', '2000-01-01', '2009-12-31'),
    since('tv-older', 'TV before 2000', null, '1999-12-31')
  ].map(list => ({
    ...list,
    params: Object.fromEntries(Object.entries(list.params).filter(([, v]) => v !== null && v !== undefined))
  }));
})();
