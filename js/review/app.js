// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Review mode's start-up: preferences, the lists and the recommender.
// js/app/main.js loads the preferences at once and starts the feed the
// first time review mode opens.
// ============================================================================

const ReviewApp = {
  // The feed, once the Library is open: loads the catalog, cached details,
  // preferences and TV lists from the same database, then deals the first card.
  // The combined page calls this the first time you switch to review mode.
  async start() {
    const { TV_LISTS_KEY, TV_RECS_KEY } = REVIEW.STORAGE;
    const [tvLists, tvRecs] = await Promise.all([
      Store.load(TV_LISTS_KEY), Store.load(TV_RECS_KEY), this.loadInfo(), Catalog.load(), this.loadPrefs()
    ]);
    Catalog.restoreTvLists(tvLists);
    TvRecs.load(tvRecs);

    Catalog.onTvListsChange = () => Store.scheduleSave(TV_LISTS_KEY, () => Catalog.tvLists);
    TvRecs.onChange = () => Store.scheduleSave(TV_RECS_KEY, () => TvRecs.cache);
    this.loadRecommender();

    ReviewUI.switchCategory(this.savedCategoryId || 'popular', { announce: false });
  },

  // The details of titles dealt before, each stored as its own record and
  // saved as it's looked up
  async loadInfo() {
    const { INFO_PREFIX, INFO_KEY } = REVIEW.STORAGE;
    const [records, oldList] = await Promise.all([Store.loadAll(INFO_PREFIX), Store.load(INFO_KEY)]);
    MovieInfo.cache = new Map();
    const expired = MovieInfo.load(records.map(([key, info]) => [key.slice(INFO_PREFIX.length), info]));
    // Earlier versions kept every title's details as one list: each becomes
    // its own record, and the list goes. If that can't be stored now, the list
    // stays and is moved next time
    if (Array.isArray(oldList)) {
      const stored = new Set(records.map(([key]) => key));
      MovieInfo.load(oldList);
      const moved = [...MovieInfo.cache].map(([key, info]) => [INFO_PREFIX + key, info]).filter(([key]) => !stored.has(key));
      await Store.batch({ put: moved, remove: [INFO_KEY, Store.revisionKey(INFO_KEY)] });
    }
    if (expired.length) await Store.batch({ remove: expired.map(key => INFO_PREFIX + key) });
    MovieInfo.onChange = (key, info) => Store.scheduleSave(INFO_PREFIX + key, () => info);
  },

  // Order, TMDB key and last list. Loaded before anything can save them, so
  // settings changed before the feed starts don't wipe the rest
  savedCategoryId: '',
  prefsLoaded: null,
  loadPrefs() {
    this.prefsLoaded = this.prefsLoaded || Store.load(REVIEW.STORAGE.PREFS_KEY).then(prefs => {
      Feed.order = prefs && REVIEW.ORDERS.includes(prefs.order) ? prefs.order : 'ranked';
      TMDB.key = prefs && typeof prefs.tmdbKey === 'string' ? prefs.tmdbKey : '';
      this.savedCategoryId = prefs && typeof prefs.categoryId === 'string' ? prefs.categoryId : '';
    });
    return this.prefsLoaded;
  },

  // The film similarity data is large, so it loads alongside the first card
  // rather than before it; guesses and For you's film picks start once it's in
  async loadRecommender() {
    try {
      const response = await fetch(REVIEW.SIMILAR_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      Recommender.use(await response.json());
      Catalog.learnScore = () => Guesses.learnScore();
      if (Feed.order === 'learn') Feed.start(Feed.categoryId);
      if (ReviewUI.els.forYouSheet.open) ForYou.render();
    } catch (error) {
      console.error('Could not load recommendations:', error);
    }
  },

  savePrefs() {
    Store.scheduleSave(REVIEW.STORAGE.PREFS_KEY, () => ({
      categoryId: Feed.categoryId || this.savedCategoryId, order: Feed.order, tmdbKey: TMDB.key
    }));
  }
};

