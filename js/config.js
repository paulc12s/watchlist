// ============================================================================
// Constants & Configuration
// ============================================================================

const CONFIG = {
  STORAGE: {
    KEY: 'watchlist_v1',
    DB_NAME: 'WatchlistDB',
    DB_VERSION: 1,
    STORE_NAME: 'items'
  },
  API: {
    // API OPTIONS FOR MOVIE DATA:
    //
    // 1. OMDb API (current) - http://www.omdbapi.com/
    //    - Pros: Simple, reliable, good basic data
    //    - Cons: No streaming platform data, 1000 requests/day on free tier
    //    - Get free key: http://www.omdbapi.com/apikey.aspx
    //
    // 2. TMDB API (recommended alternative) - https://www.themoviedb.org/
    //    - Pros: Free, 50 requests/sec, better data, some streaming info via "watch providers"
    //    - Cons: Streaming data limited to certain countries
    //    - Get free key: https://www.themoviedb.org/settings/api
    //
    // 3. Watchmode API - https://api.watchmode.com/
    //    - Pros: Dedicated streaming availability data
    //    - Cons: 1000 requests/month on free tier
    //
    // 4. Streaming Availability API - https://www.movieofthenight.com/about/api
    //    - Pros: Comprehensive streaming data
    //    - Cons: Paid only ($9.99/month)
    //
    // SECURITY NOTE: API keys are visible in client-side code. This is acceptable
    // for this local application since OMDb keys are rate-limited per key, not per
    // user. For production apps, API calls should be proxied through a backend.
    //
    OMDB_KEY: 'trilogy', // Replace with your own API key
    OMDB_URL: 'https://www.omdbapi.com/'
  },
  LIMITS: {
    MAX_TITLE_LENGTH: 500,
    MAX_TAG_LENGTH: 100,
    MAX_PLATFORM_LENGTH: 100,
    MAX_FILE_SIZE: 10 * 1024 * 1024
  },
  PRIORITIES: ['high', 'medium', 'low'],
  TYPES: ['movie', 'series', 'youtube'],
  PLATFORMS: [
    'Netflix',
    'Amazon Prime',
    'Disney+',
    'Hulu',
    'HBO Max',
    'Apple TV+',
    'Paramount+',
    'Peacock',
    'YouTube',
    'Theater',
    'Other'
  ]
};
