// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Constants & Configuration
// ============================================================================

const CONFIG = {
  // Replaced with the commit hash at deploy time; see js/version-check.js
  APP_VERSION: '__APP_VERSION__',
  STORAGE: {
    // The app's database (app.html). Titles live under TITLES_KEY in the
    // shared record shape (js/title.js)
    APP: { name: 'TitlesDB', storeName: 'kv' },
    // The retired Watchlist and Ratings pages' databases, only ever read, to
    // bring their titles in (js/app/old-pages.js). legacyKey holds what their
    // earliest versions wrote, read if TITLES_KEY is empty
    WATCHLIST: { name: 'WatchlistDB', storeName: 'items', legacyKey: 'watchlist_v1' },
    RATINGS: { name: 'RatingsDB', storeName: 'kv', legacyKey: 'ratings_v1' },
    TITLES_KEY: 'titles_v2',
    SAVE_DELAY_MS: 300
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
    // SECURITY NOTE: API keys are visible in client-side code, so anyone can
    // read this key and use up its quota. The worst case is an outage, and
    // js/omdb.js then falls back to the shared demo key. See SECURITY.md.
    //
    OMDB_KEY: '12dec63b',
    OMDB_FALLBACK_KEY: 'trilogy',
    OMDB_URL: 'https://www.omdbapi.com/'
  },
  SEARCH: {
    MAX_PAGES: 3,        // OMDb returns 10 results per page
    MAX_RESULTS: 25,
    DETAIL_PREFETCH: 5,  // Top results get director/cast loaded for disambiguation
    // A last word this long is also searched as a prefix ("bugo*"); shorter
    // ones bring back too many results for OMDb to answer
    WILDCARD_MIN: 3,
    // Searching OMDb waits this long after the last key; suggestions don't wait
    DELAY_MS: 400
  },
  UNDO_TIMEOUT: 6000,
  BATCH_DELAY_MS: 250, // Pause between titles in batch upload to stay under OMDb rate limits
  LIMITS: {
    MAX_TITLE_LENGTH: 500,
    MAX_TAG_LENGTH: 100,
    MAX_PLATFORM_LENGTH: 100,
    MAX_REVIEW_LENGTH: 1000,
    MAX_FILE_SIZE: 20 * 1024 * 1024,
    MAX_IMPORT: 20000
  },
  // Display order; 'watching' sits above the real priorities as its own group
  PRIORITIES: ['watching', 'high', 'medium', 'low'],
  PRIORITY_LABELS: {
    watching: 'Watching Now',
    high: 'High',
    medium: 'Medium',
    low: 'Low'
  },
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
