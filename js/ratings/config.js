// ============================================================================
// Ratings page settings
// Shares CONFIG (OMDb key, app version, limits) from js/config.js; its own
// storage is separate so the watchlist and ratings never touch each other's data.
// ============================================================================

const RATINGS = {
  STORAGE: {
    DB_NAME: 'RatingsDB',
    DB_VERSION: 1,
    STORE_NAME: 'kv',
    RATINGS_KEY: 'ratings_v1',
    INFO_KEY: 'movie_info_v1',
    PREFS_KEY: 'prefs_v1'
  },
  CATEGORIES_URL: 'data/categories.json',
  VERDICTS: ['up', 'down', 'skip'],
  // Pixels, or a quick flick, to count a drag as a swipe
  SWIPE_DISTANCE: 90,
  SWIPE_VELOCITY: 0.5,
  PREFETCH: 2,
  SAVE_DELAY_MS: 300,
  // Profile rows need at least this many rated films behind them
  MIN_PROFILE_FILMS: 3,
  MAX_IMPORT: 20000,
  RELOAD_KEY: 'ratings_reloaded_for'
};
