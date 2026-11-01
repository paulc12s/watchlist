// Copyright (c) 2026 Paul Constantinides. Licensed under the MIT License; see LICENSE.
// ============================================================================
// Ratings app start-up (see js/ratings/boot.js for ratings.html)
// ============================================================================

const RatingsApp = {
  // ratings.html: the page on its own database (js/ratings/boot.js calls this)
  async init() {
    RatingsUI.init();
    Store.onError = error => {
      console.error('Save failed:', error);
      RatingsUI.toast('Could not save. Export a backup to be safe.');
    };
    try {
      // Titles are kept by the shared Library (js/library.js) in this page's database
      await Library.open(CONFIG.STORAGE.RATINGS);
      await this.start();
    } catch (error) {
      console.error('Start-up failed:', error);
      RatingsUI.toast(`Could not start: ${error.message}`);
    }
    VersionCheck.start();
  },

  // The feed, once the Library is open: loads the catalog, cached details,
  // preferences and TV lists from the same database, then deals the first card.
  // The combined page calls this the first time you switch to review mode.
  async start() {
    const { INFO_KEY, TV_LISTS_KEY, TV_RECS_KEY } = RATINGS.STORAGE;
    const [info, tvLists, tvRecs] = await Promise.all([
      Store.load(INFO_KEY), Store.load(TV_LISTS_KEY), Store.load(TV_RECS_KEY), Catalog.load(), this.loadPrefs()
    ]);
    MovieInfo.load(info);
    Catalog.restoreTvLists(tvLists);
    TvRecs.load(tvRecs);

    MovieInfo.onChange = () => Store.scheduleSave(INFO_KEY, () => MovieInfo.dump());
    Catalog.onTvListsChange = () => Store.scheduleSave(TV_LISTS_KEY, () => Catalog.tvLists);
    TvRecs.onChange = () => Store.scheduleSave(TV_RECS_KEY, () => TvRecs.cache);
    this.loadRecommender();

    RatingsUI.switchCategory(this.savedCategoryId || 'popular', { announce: false });
  },

  // Order, TMDB key and last list. Loaded before anything can save them, so
  // settings changed before the feed starts don't wipe the rest
  savedCategoryId: '',
  prefsLoaded: null,
  loadPrefs() {
    this.prefsLoaded = this.prefsLoaded || Store.load(RATINGS.STORAGE.PREFS_KEY).then(prefs => {
      Feed.order = prefs && RATINGS.ORDERS.includes(prefs.order) ? prefs.order : 'ranked';
      TMDB.key = prefs && typeof prefs.tmdbKey === 'string' ? prefs.tmdbKey : '';
      this.savedCategoryId = prefs && typeof prefs.categoryId === 'string' ? prefs.categoryId : '';
    });
    return this.prefsLoaded;
  },

  // The film similarity data is large, so it loads alongside the first card
  // rather than before it; guesses and For you's film picks start once it's in
  async loadRecommender() {
    try {
      const response = await fetch(RATINGS.SIMILAR_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      Recommender.use(await response.json());
      Catalog.learnScore = () => Guesses.learnScore();
      if (Feed.order === 'learn') Feed.start(Feed.categoryId);
      if (RatingsUI.els.forYouSheet.open) ForYou.render();
    } catch (error) {
      console.error('Could not load recommendations:', error);
    }
  },

  savePrefs() {
    Store.scheduleSave(RATINGS.STORAGE.PREFS_KEY, () => ({
      categoryId: Feed.categoryId || this.savedCategoryId, order: Feed.order, tmdbKey: TMDB.key
    }));
  }
};

